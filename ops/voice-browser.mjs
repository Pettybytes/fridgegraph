/**
 * Browser-voice routes (/voice/turn, /voice/transcribe, /voice/speak), extracted so they can be
 * handler-tested without the server's DB/secret bootstrap, and so the SAME guard runs on every route.
 *
 * SECURITY: the caller's JWT is VERIFIED (deps.verify — the Supabase/identity path, see voice-auth.mjs)
 * BEFORE the request body is read and BEFORE any paid provider (ASR/Rosina/TTS) is touched, on all
 * three routes including /voice/speak. A missing, malformed or expired token triggers ZERO provider
 * calls. Rate limiting is keyed by the VERIFIED person id (not a token hash, not token length).
 * Downstream authorization is preserved: the same verified bearer is forwarded to Rosina, which
 * re-verifies and reads as the signed-in caller.
 */
import crypto from 'node:crypto'
import { parseHistory } from './voice-helpers.mjs'

function send(res, status, body) { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }

function readBinary(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error('TOO_LARGE'), { status: 413 })); req.destroy(); return } chunks.push(c) })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

const tokenOf = (req) => {
  const raw = String(req.headers.authorization || '').trim()
  return /^bearer\s+/i.test(raw) ? raw.replace(/^bearer\s+/i, '').trim() : ''
}

/** Keep the MOST RECENT messages whose combined UTF-8 size is within the byte budget. A multilingual
 *  history (CJK/emoji are 3–4 bytes/char) therefore cannot blow past request-header limits. */
export function boundHistoryBytes(history, maxBytes) {
  const out = []
  let bytes = 0
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const m = history[i]
    const b = Buffer.byteLength(m.content, 'utf8') + Buffer.byteLength(m.role, 'utf8') + 24 // + JSON overhead
    if (bytes + b > maxBytes) break
    out.unshift(m); bytes += b
  }
  return out
}

export function createBrowserVoiceRoutes(deps) {
  const {
    verify, transcribe, speak, rosinaTurn, allow,
    now = () => Date.now(), log = () => {},
    maxAudioBytes = 8 * 1024 * 1024, maxHistoryBytes = 6000,
    asrModel = null, ttsModel = null, ttsVoice = null, ttsVoiceName = null,
  } = deps

  // Verify FIRST (before body read / any provider), then rate-limit by verified identity.
  async function guard(req, res) {
    const id = await verify(req.headers.authorization)
    if (!id.ok) { send(res, 401, { error: 'UNAUTHENTICATED' }); return null }
    if (!allow(id.personId)) { send(res, 429, { error: 'RATE_LIMITED' }); return null }
    return id
  }

  async function turn(req, res) {
    const id = await guard(req, res); if (!id) return
    const token = tokenOf(req)
    const contentType = req.headers['content-type']
    const reqId = crypto.randomUUID().slice(0, 8)
    const t0 = now()
    const selectedChildId = req.headers['x-rosina-child']
    if (selectedChildId !== undefined && (typeof selectedChildId !== 'string' || !/^p_[a-z0-9_]{1,60}$/.test(selectedChildId))) { send(res, 400, { error: 'INVALID_CHILD_CONTEXT' }); return }
    let transcript, source = 'audio', history = [], asrMs = null

    if ((contentType || '').includes('application/json')) {
      const raw = await readBinary(req, maxAudioBytes)
      let payload = {}; try { payload = JSON.parse(raw.toString('utf8') || '{}') } catch { payload = {} }
      if (typeof payload.text !== 'string' || !payload.text.trim()) { send(res, 400, { error: 'TEXT_REQUIRED' }); return }
      transcript = payload.text.trim(); source = 'text'
      history = boundHistoryBytes(parseHistory(payload.history), maxHistoryBytes)
    } else {
      history = boundHistoryBytes(parseHistory(req.headers['x-rosina-history']), maxHistoryBytes)
      const raw = await readBinary(req, maxAudioBytes)
      const tAsr = now(); const asr = await transcribe(raw, contentType); asrMs = now() - tAsr
      if (!asr.ok) { log(`req=${reqId} ASR_UNAVAILABLE status=${asr.status} asrMs=${asrMs}`); send(res, 502, { error: 'ASR_UNAVAILABLE', status: asr.status, detail: asr.detail, model: asrModel }); return }
      if (!asr.transcript || !String(asr.transcript).trim()) { log(`req=${reqId} TRANSCRIPT_EMPTY asrMs=${asrMs}`); send(res, 422, { error: 'TRANSCRIPT_EMPTY', model: asrModel }); return }
      transcript = String(asr.transcript).trim()
    }

    const tRos = now(); const ros = await rosinaTurn({ token, message: transcript, history, selectedChildId }); const rosinaMs = now() - tRos
    if (!ros.ok) { log(`req=${reqId} ROSINA_UNAVAILABLE status=${ros.status} rosinaMs=${rosinaMs}`); send(res, 502, { error: 'ROSINA_UNAVAILABLE', status: ros.status }); return }
    const reply = String(ros.reply ?? '')
    const tTts = now(); const tts = await speak(reply); const ttsMs = now() - tTts
    log(`req=${reqId} ok src=${source} historyLen=${history.length} asrMs=${asrMs ?? '-'} rosinaMs=${rosinaMs} ttsMs=${ttsMs} totalMs=${now() - t0} tts=${tts.ok}`)
    send(res, 200, {
      transcript, transcriptSource: source, reply, actions: ros.actions ?? [],
      models: { asr: source === 'audio' ? asrModel : null, tts: ttsModel, voice: ttsVoice, voiceName: ttsVoiceName, rosina: ros.model ?? null },
      timings: { asrMs: asrMs ?? undefined, rosinaMs, ttsMs, serverTotalMs: now() - t0 },
      audioBase64: tts.ok ? tts.audio.toString('base64') : null,
      mimeType: tts.ok ? tts.mimeType : null,
      ttsError: tts.ok ? null : 'TTS_UNAVAILABLE',
    })
  }

  async function speakOnly(req, res) {
    const id = await guard(req, res); if (!id) return
    const raw = await readBinary(req, maxAudioBytes)
    let payload = {}; try { payload = JSON.parse(raw.toString('utf8') || '{}') } catch { payload = {} }
    if (typeof payload.text !== 'string' || !payload.text.trim()) { send(res, 400, { error: 'TEXT_REQUIRED' }); return }
    const tts = await speak(payload.text.trim().slice(0, 4000))
    if (!tts.ok) { send(res, 502, { error: 'TTS_UNAVAILABLE' }); return }
    send(res, 200, { audioBase64: tts.audio.toString('base64'), mimeType: tts.mimeType, model: ttsModel, voice: ttsVoice, voiceName: ttsVoiceName })
  }

  async function transcribeOnly(req, res) {
    const id = await guard(req, res); if (!id) return
    const raw = await readBinary(req, maxAudioBytes)
    const asr = await transcribe(raw, req.headers['content-type'])
    if (!asr.ok) { send(res, 502, { error: 'ASR_UNAVAILABLE', status: asr.status, detail: asr.detail, model: asrModel }); return }
    send(res, 200, { text: asr.transcript, model: asr.model ?? asrModel })
  }

  /** Handle a /voice/* route; returns true if it owned the request. */
  async function dispatch(req, res) {
    const url = req.url || ''
    if (req.method !== 'POST') return false
    if (url === '/voice/transcribe') { await transcribeOnly(req, res); return true }
    if (url === '/voice/speak') { await speakOnly(req, res); return true }
    if (url.startsWith('/voice/turn')) { await turn(req, res); return true }
    return false
  }

  return { turn, speakOnly, transcribeOnly, dispatch }
}
