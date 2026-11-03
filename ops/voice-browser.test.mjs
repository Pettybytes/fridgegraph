/**
 * Browser-voice handler tests: the caller is VERIFIED before any paid provider runs, on every route.
 * Missing / malformed / expired tokens trigger ZERO provider calls (ASR, Rosina, TTS). Rate limiting
 * is by verified identity. History is bounded by encoded UTF-8 bytes. Run:
 *   node --test ops/voice-browser.test.mjs
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Readable } from 'node:stream'
import { createBrowserVoiceRoutes, boundHistoryBytes } from './voice-browser.mjs'

function makeRes() {
  return { status: 0, body: '', writeHead(s) { this.status = s }, end(b) { this.body = b ?? '' } }
}
function makeReq({ auth, url = '/voice/turn', contentType = 'audio/webm', body = Buffer.from('audio-bytes') } = {}) {
  const req = Readable.from([Buffer.isBuffer(body) ? body : Buffer.from(body)])
  req.headers = { 'content-type': contentType }
  if (auth !== undefined) req.headers.authorization = auth
  req.url = url
  req.method = 'POST'
  return req
}
function spies() {
  const calls = { transcribe: 0, speak: 0, rosina: 0 }
  return {
    calls,
    transcribe: async () => { calls.transcribe += 1; return { ok: true, transcript: 'hello rosina', model: 'asr' } },
    speak: async () => { calls.speak += 1; return { ok: true, audio: Buffer.from('mp3'), mimeType: 'audio/mpeg' } },
    rosinaTurn: async () => { calls.rosina += 1; return { ok: true, reply: 'Hi Kendra', actions: [], model: 'spark' } },
  }
}
const routes = (verify, allow, s) => createBrowserVoiceRoutes({
  verify, allow: allow ?? (() => true), transcribe: s.transcribe, speak: s.speak, rosinaTurn: s.rosinaTurn,
  asrModel: 'asr', ttsModel: 'tts', ttsVoice: 'v', ttsVoiceName: 'Sarah',
})

const badTokens = [
  ['missing', undefined, async () => ({ ok: false, reason: 'missing' })],
  ['malformed', 'Token xyz', async () => ({ ok: false, reason: 'malformed' })],
  ['expired/invalid', 'Bearer eyJhbGciOiJF.expired.sig', async () => ({ ok: false, reason: 'invalid', detail: 'ERR_JWT_EXPIRED' })],
]
for (const [label, auth, verify] of badTokens) {
  for (const url of ['/voice/turn', '/voice/speak', '/voice/transcribe']) {
    test(`${label} token on ${url} → 401 and ZERO provider calls`, async () => {
      const s = spies()
      const res = makeRes()
      const body = url === '/voice/speak' ? JSON.stringify({ text: 'x' }) : Buffer.from('a')
      const contentType = url === '/voice/speak' ? 'application/json' : 'audio/webm'
      await routes(verify, () => true, s).dispatch(makeReq({ auth, url, contentType, body }), res)
      assert.equal(res.status, 401)
      assert.deepEqual(s.calls, { transcribe: 0, speak: 0, rosina: 0 }, 'no provider was called for an unverified caller')
    })
  }
}

test('a verified caller runs the full turn (providers called, 200)', async () => {
  const s = spies()
  const res = makeRes()
  await routes(async () => ({ ok: true, personId: 'p_mom' }), () => true, s).dispatch(makeReq({ auth: 'Bearer good' }), res)
  assert.equal(res.status, 200)
  assert.deepEqual(s.calls, { transcribe: 1, speak: 1, rosina: 1 })
  const out = JSON.parse(res.body)
  assert.equal(out.reply, 'Hi Kendra')
  assert.equal(out.models.voiceName, 'Sarah')
})

test('rate limit is keyed by verified identity → 429 with ZERO provider calls', async () => {
  const s = spies()
  const res = makeRes()
  await routes(async () => ({ ok: true, personId: 'p_mom' }), () => false, s).dispatch(makeReq({ auth: 'Bearer good' }), res)
  assert.equal(res.status, 429)
  assert.deepEqual(s.calls, { transcribe: 0, speak: 0, rosina: 0 })
})

test('/voice/speak verifies before TTS (valid → speaks, no ASR/Rosina)', async () => {
  const s = spies()
  const res = makeRes()
  await routes(async () => ({ ok: true, personId: 'p_mom' }), () => true, s)
    .dispatch(makeReq({ auth: 'Bearer good', url: '/voice/speak', contentType: 'application/json', body: JSON.stringify({ text: 'read this' }) }), res)
  assert.equal(res.status, 200)
  assert.deepEqual(s.calls, { transcribe: 0, speak: 1, rosina: 0 })
})

test('history is bounded by encoded UTF-8 bytes (multilingual cannot exceed the budget)', () => {
  const big = Array.from({ length: 50 }, () => ({ role: 'user', content: 'あ'.repeat(200) })) // 3 bytes/char → 600 B each
  const bounded = boundHistoryBytes(big, 1500)
  const bytes = bounded.reduce((n, m) => n + Buffer.byteLength(m.content, 'utf8'), 0)
  assert.ok(bytes <= 1500, `bounded content was ${bytes} bytes`)
  assert.ok(bounded.length >= 1 && bounded.length < 50, 'kept the most recent few, dropped the rest')
})
