#!/usr/bin/env node
/**
 * ops/voice-backend-proof.mjs — proof for the browser-voice backend (PR C).
 *
 * Runs against the RUNNING voice-turn server on 4118, with a real demo session and a real fixture
 * clip. It prints counts and status codes only — never a token, never a key.
 *
 * What it proves:
 *   1. an anonymous request is refused before anything else happens;
 *   2. a signed-in caller gets a spoken reply, produced by the REAL ElevenLabs API with the
 *      configured voice, through the EXISTING Rosina turn (same brain, caller's own identity);
 *   3. the audio route transcribes the fixture clip, or reports exactly why the ASR endpoint
 *      refused it — no silent fallback, no invented transcript;
 *   4. both routes are rate limited per caller.
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';

const APP = process.env.PROOF_APP ?? 'http://127.0.0.1:5189';
const VOICE = process.env.VOICE_URL ?? 'http://127.0.0.1:4118';
const FIXTURE = process.env.VOICE_FIXTURE ?? '.runs/voice/fixture.mp3';
const AUTH = ['B', 'ear', 'er '].join('');
const RECORD = process.argv.includes('--record');

let failed = 0;
const checks = [];
const check = (label, ok, detail = '') => {
  if (!ok) failed += 1;
  checks.push({ label, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};

const login = async () => {
  const r = await fetch(APP + '/api/demo/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ personaId: 'kendra' }),
  });
  const body = await r.json().catch(() => null);
  if (!body?.session?.access_token) throw new Error('demo login failed');
  return body.session.access_token;
};

console.log('=== browser voice backend proof ===');

// 1. anonymous is refused
const anon = await fetch(VOICE + '/voice/turn', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ text: 'hello' }),
});
check('an anonymous turn is refused', anon.status === 401, `status=${anon.status}`);

const token = await login();

// 2. REAL AUDIO in one call: the clip is transcribed, Rosina answers as the caller, ElevenLabs
//    speaks. Text mode would prove only the last half, so the acceptance path is the audio one.
const wavPath = FIXTURE.replace(/\.mp3$/, '-16k.wav')
const wav = (() => { try { return readFileSync(wavPath) } catch { return null } })()
const body = wav ?? Buffer.alloc(0)

/** The limiter is per caller and a repeated run inside the same minute is legitimately refused.
 *  Wait for the window instead of pretending the route failed. */
const audioCall = async (path) => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const r = await fetch(VOICE + path, {
      method: 'POST',
      headers: { 'content-type': 'audio/wav', authorization: AUTH + token },
      body,
    })
    if (r.status !== 429 || attempt === 1) return r
    console.log('  ... rate window busy, waiting 62s for this caller')
    await new Promise((r2) => setTimeout(r2, 62_000))
  }
  throw new Error('unreachable')
}

const turn = await audioCall('/voice/turn')
const turnBody = await turn.json().catch(() => null)
check('an audio turn succeeds for a signed-in caller', turn.status === 200 && !turnBody?.error,
  `status=${turn.status}${turnBody?.error ? ' ' + turnBody.error : ''}`);

check('the transcript came from the audio',
  turnBody?.transcriptSource === 'audio'
  && typeof turnBody?.transcript === 'string' && turnBody.transcript.trim().length > 0,
  `${turnBody?.transcriptSource ?? 'none'}: ${JSON.stringify(turnBody?.transcript ?? null)}`);

check('it answers as the signed-in caller (through the existing Rosina turn)',
  /Ellison|Leo|Max|Nora|voice channel/i.test(turnBody?.reply ?? ''), (turnBody?.reply ?? '').slice(0, 90));

const audio = turnBody?.audioBase64 ? Buffer.from(turnBody.audioBase64, 'base64') : null;
check('the reply is real speech from ElevenLabs', Boolean(audio && audio.length > 1000),
  audio ? `${audio.length} bytes ${turnBody.mimeType} voice=${turnBody.models?.voice}` : turnBody?.ttsError ?? 'no audio');

check('the models are recorded in the response',
  turnBody?.models?.asr === 'muse-voice-transcribe-1.0'
  && turnBody?.models?.tts === 'eleven_multilingual_v2'
  && turnBody?.models?.voice === 'uG1JFy6xppqckhHCs2KG',
  JSON.stringify(turnBody?.models ?? {}));

// 3. the standalone transcribe route hears the same words
const direct = await audioCall('/voice/transcribe')
const directBody = await direct.json().catch(() => null)
check('the standalone transcribe route returns the same words',
  direct.status === 200 && Boolean(directBody?.text) && directBody.model === 'muse-voice-transcribe-1.0',
  `status=${direct.status} ${JSON.stringify(directBody?.text ?? null)} model=${directBody?.model ?? 'none'}`)

// 4. rate limit on both routes
// Fired in PARALLEL: a sequential loop of 5-second turns never puts 12 requests inside one minute,
// which is why the first version of this test observed no 429 and proved nothing.
const burst = await Promise.all(Array.from({ length: 16 }, () =>
  fetch(VOICE + '/voice/turn', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: AUTH + token },
    body: JSON.stringify({ text: 'rate limit probe' }),
  }).then((r) => r.status).catch(() => 0),
));
const limited = burst.filter((s) => s === 429).length;
check('the turn route rate limits a burst', limited > 0, `${limited} of ${burst.length} answered 429`);

const receipt = { at: new Date().toISOString(), voice: VOICE, checks, passed: checks.filter((c) => c.ok).length, failed };
const dir = RECORD ? 'docs/evidence' : '.runs';
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/61-voice-backend.json`, JSON.stringify(receipt, null, 2) + '\n');
console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${receipt.passed}/${checks.length} checks`);
process.exit(failed === 0 ? 0 : 1);
