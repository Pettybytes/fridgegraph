#!/usr/bin/env node
/**
 * ops/voice-turn-server.mjs — GHL Custom Action → FridgeGraph (`voice-turn`).
 *
 * webhook.md §3b: the weaker, documented boundary. Static shared secret plus a timestamp, because
 * GHL Custom Actions may not be able to sign. Compensating controls, all enforced here:
 *
 *   - every request binds to an existing Attempt and that job's requestVersion
 *   - AVAILABILITY ONLY: the only write this endpoint can reach is accept_pickup_webhook (and, for
 *     a no-answer, record_no_answer). It has no route to approve_pickup and cannot create a
 *     confirmation. A replay's worst case is a false availability signal into the same
 *     deterministic ranking.
 *   - a ±300 s timestamp bounds replay; the secret is never logged
 *
 * Request  { attemptId, decision, declineReason?, eventId? }
 * Response { status, note, say }   — `say` is the single line Rosina speaks next (null when the
 *            turn is a system-observed call outcome rather than a live conversation).
 *
 * Decision statuses: CONTINUE | ACCEPTED | DECLINED | ESCALATE | END_CALL.
 * CONTINUE, ESCALATE and END_CALL change no state at all.
 *
 * NO_ANSWER (D4) is not a caregiver decision. It is the system's observation that an outbound call
 * was not answered. It routes to record_no_answer(), which stores source='no_answer' and writes
 * nothing to candidate_evaluations — a missed call is never shown as the person declining.
 *
 * Spoken lines follow docs/ghl/rosina-kb.md §16. Where the guide writes [Requester] the returned
 * line says "the family": the requester's display name is not stored on the job, and Rosina must
 * never read a placeholder aloud (§15).
 *
 * Usage: PORT=4118 node ops/voice-turn-server.mjs
 */
import http from 'node:http'
import { spawn } from 'node:child_process'
import pg from 'pg'
import crypto from 'node:crypto'
import { createVerifier } from './voice-auth.mjs'
import { createBrowserVoiceRoutes } from './voice-browser.mjs'

const PORT = Number(process.env.PORT || 4118)
const TOLERANCE_S = 300
const SECRET = process.env.N8N_WEBHOOK_SECRET
const BASE = (process.env.SUPABASE_URL || '').replace(/\/$/, '')
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY
const DB = process.env.SUPABASE_DB_URL

if (!SECRET || !BASE || !SVC || !DB) {
  console.error('voice-turn-server: missing secret / url / service key / db url')
  process.exit(2)
}

const DECISIONS = new Set(['CONTINUE', 'ACCEPTED', 'DECLINED', 'ESCALATE', 'END_CALL'])
const SYSTEM_OUTCOMES = new Set(['NO_ANSWER'])

// D5: say lines carry the requester's and the child's real first names, resolved SERVER-SIDE from
// the attempt. Never model-written, never taken from a GHL field. If a name cannot be resolved
// from data, the line says "the family" -- Rosina never reads a placeholder aloud.
const FAMILY = 'the family'
const LINE = {
  CONTINUE: "I'm calling on behalf of {requester} about a pickup for {child}. Is now a good time?",
  ACCEPTED: "Thank you. I've recorded that you're available for {child}'s pickup. {requester} still needs to approve the arrangement, and you'll hear back once it's decided.",
  DECLINED: 'No problem at all, thanks for letting me know. Have a good day.',
  DECLINED_NO_TRANSPORT: 'No problem at all, thanks for letting me know. Have a good day.',
  ESCALATE: "Thanks for your patience. I've passed this along.",
  END_CALL: 'Thanks for your time. Goodbye.',
  FAILED: "Thank you. I couldn't confirm your answer was recorded. If this is time-sensitive, please contact {requester} directly.",
}
const say = (key, names) => String(LINE[key] ?? '')
  .replace(/\{requester\}/g, names?.requester || FAMILY)
  .replace(/\{child\}/g, names?.child || FAMILY)

// SSL is on by default (Supabase requires it). PGSSL=disable is a local-rehearsal-only opt-out for a
// non-SSL disposable Postgres container; production never sets it, so the default is unchanged.
const db = new pg.Client({ connectionString: DB, ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false } })

// D5: resolve the requester and child first names from the attempt itself.
//   child     -- the job's child_id -> people.display_name
//   requester -- the parent scheduled for the job's as_of, the SAME rule _is_approver_for uses.
//                Only when exactly one parent is scheduled is there an unambiguous requester;
//                otherwise the honest answer is "the family".
// Every lookup is server-side; nothing here is caller-supplied or model-written.
const firstName = (s) => (typeof s === 'string' && s.trim() ? s.trim().split(/\s+/)[0] : null)
async function resolveNames(jobId) {
  const child = await db.query(
    `select p.display_name name
       from coordination_jobs j join people p on p.id = j.child_id
      where j.id = $1`, [jobId])
  const req = await db.query(
    `select p.display_name name
       from coordination_jobs j
       join parenting_schedules ps on ps.child_id = j.child_id
       join people p on p.id = ps.parent_id
      where j.id = $1
        and j.as_of is not null
        and upper(to_char(j.as_of, 'DY')) = any (ps.weekdays)`, [jobId])
  return {
    child: firstName(child.rows[0]?.name) || FAMILY,
    requester: req.rowCount === 1 ? (firstName(req.rows[0].name) || FAMILY) : FAMILY,
    requesterAmbiguous: req.rowCount !== 1,
  }
}
const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = []; let size = 0
  req.on('data', (c) => { size += c.length; if (size > 65536) { reject(new Error('too large')); req.destroy(); return } chunks.push(c) })
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  req.on('error', reject)
})

async function handle(req, res) {
  const started = Date.now()
  const secret = req.headers['x-fridgegraph-webhook-secret']
  const ts = req.headers['x-fridgegraph-timestamp']
  if (typeof secret !== 'string' || secret.length !== SECRET.length || secret !== SECRET)
    return send(res, 401, { error: 'UNAUTHORIZED' })
  const skew = Math.abs(Math.floor(Date.now() / 1000) - Number(ts))
  if (!Number.isFinite(skew) || skew > TOLERANCE_S) return send(res, 401, { error: 'UNAUTHORIZED' })

  let body
  try { body = JSON.parse(await readBody(req)) } catch { return send(res, 400, { error: 'MALFORMED' }) }
  const { attemptId, decision, declineReason = null, eventId } = body ?? {}
  if (typeof attemptId !== 'string' ||
      (!DECISIONS.has(String(decision)) && !SYSTEM_OUTCOMES.has(String(decision))))
    return send(res, 400, { error: 'MALFORMED' })

  const a = await db.query(
    `select a.id, a.job_id, a.closed_at, j.request_version, j.status
       from attempts a join coordination_jobs j on j.id = a.job_id where a.id = $1`, [attemptId])
  if (!a.rowCount) return send(res, 404, { error: 'UNKNOWN_ATTEMPT' })
  const row = a.rows[0]
  if (row.status === 'confirmed' || row.status === 'failed')
    return send(res, 409, { status: 'END_CALL', note: 'terminal', say: say('END_CALL', await resolveNames(row.job_id)) })

  // D5: resolved once per request, from the attempt's own job.
  const names = await resolveNames(row.job_id)

  // D3: a reply on a CLOSED attempt ends the conversation. It changes NO coordination state --
  // the attempt is already closed and accept_pickup_webhook would reject the event anyway -- but
  // Rosina must stop talking rather than ask more questions into a finished thread.
  if (row.closed_at) {
    console.log(`[voice-turn] ${decision} on closed attempt -> END_CALL`)
    return send(res, 200, { status: 'END_CALL', note: 'attempt_closed', say: say('END_CALL', names) })
  }

  // D4: a system-observed call outcome. Not a decline, and nothing is spoken.
  if (SYSTEM_OUTCOMES.has(String(decision))) {
    const neid = typeof eventId === 'string' && eventId ? eventId
      : `noanswer:${attemptId}:${row.request_version}`
    const nr = await fetch(`${BASE}/rest/v1/rpc/record_no_answer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: SVC },
      body: JSON.stringify({ p_attempt: attemptId, p_event_id: neid, p_payload_sha256: neid }),
    })
    const ntext = await nr.text()
    if (!nr.ok) {
      const msg = (() => { try { return JSON.parse(ntext || '{}').message } catch { return null } })()
      console.log(`[voice-turn] NO_ANSWER rejected ${msg} ${Date.now() - started}ms`)
      return send(res, 200, { status: 'NO_ANSWER', note: 'not_recorded', say: null })
    }
    const nout = (() => { try { return JSON.parse(ntext) } catch { return 'recorded' } })()
    console.log(`[voice-turn] NO_ANSWER ${nout} ${Date.now() - started}ms`)
    return send(res, 200, { status: 'NO_ANSWER', note: String(nout), say: null })
  }

  // Non-committal turns change nothing.
  if (decision !== 'ACCEPTED' && decision !== 'DECLINED')
    return send(res, 200, { status: decision, note: 'no_state_change', say: say(decision, names) })

  const available = decision === 'ACCEPTED'
  const reason = available ? null : (typeof declineReason === 'string' ? declineReason : 'OTHER')
  const eid = typeof eventId === 'string' && eventId ? eventId
    : `voice:${attemptId}:${decision}:${row.request_version}`

  const r = await fetch(`${BASE}/rest/v1/rpc/accept_pickup_webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: SVC },
    body: JSON.stringify({
      p_attempt: attemptId, p_available: available, p_decline: reason,
      p_request_version: Number(row.request_version), p_event_id: eid, p_payload_sha256: eid,
    }),
  })
  const text = await r.text()
  if (!r.ok) {
    const msg = (() => { try { return JSON.parse(text || '{}').message } catch { return null } })()
    console.log(`[voice-turn] ${decision} rejected ${msg} ${Date.now() - started}ms`)
    if (msg === 'EVENT_ID_CONFLICT') return send(res, 409, { error: 'EVENT_ID_CONFLICT', say: say('FAILED', names) })
    return send(res, 200, { status: decision, note: 'not_recorded', say: say('FAILED', names) })
  }
  const outcome = (() => { try { return JSON.parse(text) } catch { return 'recorded' } })()
  const line = say(available ? 'ACCEPTED'
    : (reason === 'NO_TRANSPORT' ? 'DECLINED_NO_TRANSPORT' : 'DECLINED'), names)
  console.log(`[voice-turn] ${decision} ${outcome} ${Date.now() - started}ms`)
  return send(res, 200, { status: decision, note: String(outcome), say: line })
}


// ---------------------------------------------------------------------------
// BROWSER VOICE (PR C) — audio in, the caller's OWN identity through, audio out.
//
// The flow is audio -> transcription -> the EXISTING Rosina turn -> speech. Nothing here is a
// second brain: /voice/turn forwards the caller's bearer to the Rosina service, which forwards the
// same bearer to the MCP server, so every read and every reviewed action happens as the signed-in
// caller. A GHL webhook credential is NOT a substitute for that identity and is never used on this
// path — the only credential this process holds for browser voice is the ElevenLabs key, and it
// never leaves the server.
//
// Both endpoints are rate limited per caller.
// ---------------------------------------------------------------------------
const AUTH_PREFIX = ['B', 'ear', 'er '].join('')
const ASR_URL = process.env.MUSE_ASR_URL
  || `${(process.env.META_BASE_URL || 'https://api.meta.ai/v1').replace(/\/$/, '')}/asr/transcribe`
const ASR_MODEL = process.env.MUSE_ASR_MODEL || 'muse-voice-transcribe-1.0'
const ASR_ENCODING = process.env.MUSE_ASR_ENCODING || 'WAV'
const ASR_MODE = process.env.MUSE_ASR_MODE || 'PUSH_TO_TALK'
const ASR_RATE = Number(process.env.MUSE_ASR_RATE || 16000)
const ROSINA_URL = process.env.ROSINA_URL || 'http://127.0.0.1:4200/api/rosina'
// Voice: ElevenLabs "Sarah". Default is the PUBLIC ElevenLabs prebuilt Sarah voice id
// (EXAVITQu4vr4xnSDxMaL, verifiable via the public voice library / GET /v1/voices/{id} → name
// "Sarah"). The previous default (uG1JFy6xppqckhHCs2KG) was NOT verified to be Sarah. Override with
// ELEVENLABS_VOICE_ID to point at the account's approved Sarah; live confirmation of the resolved
// voice's name is owed in Bentley's provider window.
const TTS_VOICE = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL'
const TTS_VOICE_NAME = process.env.ELEVENLABS_VOICE_NAME || (process.env.ELEVENLABS_VOICE_ID ? null : 'Sarah')
const TTS_MODEL = process.env.ELEVENLABS_TTS_MODEL || 'eleven_multilingual_v2'
const VOICE_LIMIT_PER_MIN = Number(process.env.VOICE_RATE_LIMIT_PER_MIN || 12)
const MAX_AUDIO_BYTES = 8 * 1024 * 1024

const buckets = new Map()
/** Per-caller limit, keyed by the VERIFIED person id (never a raw/length-checked token). The id is
 *  hashed only to keep bucket keys uniform; nothing sensitive is stored or logged. */
function allowVoice(identity) {
  const key = crypto.createHash('sha256').update(String(identity)).digest('hex').slice(0, 16)
  const now = Date.now()
  const windowStart = now - 60_000
  const hits = (buckets.get(key) ?? []).filter((t) => t > windowStart)
  if (hits.length >= VOICE_LIMIT_PER_MIN) { buckets.set(key, hits); return false }
  hits.push(now)
  buckets.set(key, hits)
  return true
}

/** True only for a genuine uncompressed PCM WAV the API accepts as-is. */
function isPcm16Wav(buf) {
  if (buf.length < 44) return false
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return false
  let off = 12
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    if (id === 'fmt ') {
      const format = buf.readUInt16LE(off + 8)
      const channels = buf.readUInt16LE(off + 10)
      const rate = buf.readUInt32LE(off + 12)
      const bits = buf.readUInt16LE(off + 22)
      return format === 1 && channels === 1 && bits === 16 && (rate === 16000 || rate === 24000)
    }
    off += 8 + size + (size % 2)
  }
  return false
}

/**
 * Convert whatever the browser recorded into a GENUINE mono PCM16 WAV.
 *
 * The API tells you the part names and then answers "Malformed request" for anything that is not
 * real PCM: relabelling MP3 bytes as audio/wav is not a conversion. ffmpeg does the conversion when
 * the clip arrives as anything else; if it is unavailable the route FAILS LOUDLY rather than
 * sending something the API will reject or, worse, pretending to have heard a sentence.
 */
async function toPcm16Wav(buf) {
  if (isPcm16Wav(buf)) return { ok: true, buf }
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg'
  const args = ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0',
    '-ac', '1', '-ar', String(ASR_RATE), '-acodec', 'pcm_s16le', '-f', 'wav', 'pipe:1']
  const out = await new Promise((resolve) => {
    let settled = false
    const done = (value) => { if (!settled) { settled = true; resolve(value) } }
    const child = spawn(ffmpeg, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    const chunks = []
    const errs = []
    child.stdout.on('data', (c) => chunks.push(c))
    child.stderr.on('data', (c) => errs.push(c))
    child.on('error', (e) => done({ ok: false, detail: `ffmpeg unavailable: ${e.message}` }))
    child.on('close', (code) => done(code === 0
      ? { ok: true, buf: Buffer.concat(chunks) }
      : { ok: false, detail: `ffmpeg exited ${code}: ${Buffer.concat(errs).toString('utf8').slice(0, 200)}` }))
    child.stdin.on('error', () => {})
    child.stdin.end(buf)
  })
  if (!out.ok) return out
  if (!out.buf || !isPcm16Wav(out.buf)) return { ok: false, detail: 'conversion did not produce a PCM16 mono WAV' }
  return out
}

async function transcribe(buf, contentType) {
  const wav = await toPcm16Wav(buf)
  if (!wav.ok) return { ok: false, status: 415, detail: wav.detail }

  const fd = new FormData()
  // Documented shape: the "request" part must be application/json, carry audioEncoding, and name the
  // mode. The boundary is generated by FormData — it is never set by hand.
  fd.append('request', new Blob([
    JSON.stringify({ model: ASR_MODEL, audioEncoding: ASR_ENCODING, mode: ASR_MODE })
  ], { type: 'application/json' }), 'request.json')
  fd.append('audio', new Blob([wav.buf], { type: 'audio/wav' }), 'clip.wav')

  const r = await fetch(ASR_URL, {
    method: 'POST',
    headers: { authorization: AUTH_PREFIX + (process.env.META_API_KEY || ''), accept: 'application/json' },
    body: fd,
  })
  const text = await r.text()
  if (!r.ok) {
    let detail = text.slice(0, 300)
    try { detail = JSON.parse(text)?.error?.message || detail } catch { /* keep raw */ }
    return { ok: false, status: r.status, detail }
  }
  const body = (() => { try { return JSON.parse(text) } catch { return null } })()
  const transcript = body?.transcript ?? body?.text
    ?? body?.results?.[0]?.alternatives?.[0]?.transcript ?? null
  return { ok: true, transcript, model: ASR_MODEL, contentType: contentType || null }
}

async function speak(text) {
  const key = process.env.ELEVENLABS_API_KEY
  if (!key) return { ok: false, detail: 'ELEVENLABS_API_KEY is not set' }
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${TTS_VOICE}`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: TTS_MODEL }),
  })
  if (!r.ok) return { ok: false, detail: `TTS ${r.status}: ${(await r.text()).slice(0, 200)}` }
  return { ok: true, audio: Buffer.from(await r.arrayBuffer()), mimeType: 'audio/mpeg', model: TTS_MODEL, voice: TTS_VOICE }
}

// Browser-voice routes. The caller's JWT is VERIFIED (voice-auth, the identity path) BEFORE the body
// is read and before any paid provider is touched, on every route including /voice/speak; the rate
// limit is keyed by the verified person id. The same verified bearer is forwarded to Rosina, which
// re-verifies and reads as the signed-in caller (downstream authorization preserved). No audio,
// transcript or token is ever logged — only metadata + stage timings.
const browserRoutes = createBrowserVoiceRoutes({
  verify: createVerifier(),
  allow: (personId) => allowVoice(personId),
  transcribe,
  speak,
  rosinaTurn: async ({ token, message, history }) => {
    let ros
    try {
      ros = await fetch(ROSINA_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: AUTH_PREFIX + token },
        body: JSON.stringify({ message, currentRoute: '/voice', history }),
      })
    } catch { return { ok: false, status: 0 } }
    const text = await ros.text()
    let body = null
    try { body = JSON.parse(text) } catch { /* leave null */ }
    if (!ros.ok || !body) return { ok: false, status: ros.status }
    return { ok: true, reply: body.reply, actions: body.actions, model: body.model }
  },
  log: (line) => console.log(`[voice-turn] ${line}`),
  maxAudioBytes: MAX_AUDIO_BYTES,
  asrModel: ASR_MODEL, ttsModel: TTS_MODEL, ttsVoice: TTS_VOICE, ttsVoiceName: TTS_VOICE_NAME,
})

const server = http.createServer(async (req, res) => {
  const url = req.url || ''

  // ---- browser voice: same process, same port. Verify-first routes own /voice/*.
  try {
    if (await browserRoutes.dispatch(req, res)) return
  } catch (e) {
    console.log('[voice-turn] voice 500', e.message)
    if (!res.headersSent) return send(res, e.status || 500, { error: 'INTERNAL' })
    return
  }

  if (req.method !== 'POST' || !url.startsWith('/voice-turn')) return send(res, 404, { error: 'NOT_FOUND' })
  try { await handle(req, res) } catch (e) {
    console.log('[voice-turn] 500', e.message)
    if (!res.headersSent) send(res, 500, { error: 'INTERNAL', say: say('FAILED', {}) })
  }
})

await db.connect()
server.listen(PORT, '127.0.0.1', () => console.log(`voice-turn-server on 127.0.0.1:${PORT}`))
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, async () => { server.close(); await db.end().catch(() => {}); process.exit(0) })
