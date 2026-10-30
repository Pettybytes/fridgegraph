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
import pg from 'pg'

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
const SAY = {
  CONTINUE: "I'm calling on behalf of the family about a pickup. Is now a good time?",
  ACCEPTED: "Thank you. I've recorded that you're available. The family still needs to approve the arrangement, and you'll hear back once it's decided.",
  DECLINED: 'No problem at all, thanks for letting me know. Have a good day.',
  DECLINED_NO_TRANSPORT: 'No problem at all, thanks for letting me know. Have a good day.',
  ESCALATE: "Thanks for your patience. I've passed this along.",
  END_CALL: 'Thanks for your time. Goodbye.',
  FAILED: "Thank you. I couldn't confirm your answer was recorded. If this is time-sensitive, please contact the family directly.",
}

const db = new pg.Client({ connectionString: DB, ssl: { rejectUnauthorized: false } })
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
    `select a.id, a.job_id, j.request_version, j.status
       from attempts a join coordination_jobs j on j.id = a.job_id where a.id = $1`, [attemptId])
  if (!a.rowCount) return send(res, 404, { error: 'UNKNOWN_ATTEMPT' })
  const row = a.rows[0]
  if (row.status === 'confirmed' || row.status === 'failed')
    return send(res, 409, { status: 'END_CALL', note: 'terminal', say: SAY.END_CALL })

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
    return send(res, 200, { status: decision, note: 'no_state_change', say: SAY[decision] })

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
    if (msg === 'EVENT_ID_CONFLICT') return send(res, 409, { error: 'EVENT_ID_CONFLICT', say: SAY.FAILED })
    return send(res, 200, { status: decision, note: 'not_recorded', say: SAY.FAILED })
  }
  const outcome = (() => { try { return JSON.parse(text) } catch { return 'recorded' } })()
  const say = available ? SAY.ACCEPTED : (reason === 'NO_TRANSPORT' ? SAY.DECLINED_NO_TRANSPORT : SAY.DECLINED)
  console.log(`[voice-turn] ${decision} ${outcome} ${Date.now() - started}ms`)
  return send(res, 200, { status: decision, note: String(outcome), say })
}

const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || !req.url?.startsWith('/voice-turn')) return send(res, 404, { error: 'NOT_FOUND' })
  try { await handle(req, res) } catch (e) {
    console.log('[voice-turn] 500', e.message)
    if (!res.headersSent) send(res, 500, { error: 'INTERNAL', say: SAY.FAILED })
  }
})

await db.connect()
server.listen(PORT, '127.0.0.1', () => console.log(`voice-turn-server on 127.0.0.1:${PORT}`))
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, async () => { server.close(); await db.end().catch(() => {}); process.exit(0) })
