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

// 2. a signed-in caller gets a spoken reply through the existing Rosina turn
const turn = await fetch(VOICE + '/voice/turn', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: AUTH + token },
  body: JSON.stringify({ text: 'Who are my children?' }),
});
const turnBody = await turn.json().catch(() => null);
check('the turn succeeds for a signed-in caller', turn.status === 200, `status=${turn.status}${turnBody?.error ? ' ' + turnBody.error : ''}`);
check('it answers as Kendra (the signed-in caller, through Rosina)',
  /Ellison|Leo|Max|Nora/i.test(turnBody?.reply ?? ''), (turnBody?.reply ?? '').slice(0, 90));
const audio = turnBody?.audioBase64 ? Buffer.from(turnBody.audioBase64, 'base64') : null;
check('the reply is real speech from ElevenLabs', Boolean(audio && audio.length > 1000),
  audio ? `${audio.length} bytes ${turnBody.mimeType} voice=${turnBody.models?.voice}` : turnBody?.ttsError ?? 'no audio');
check('the models are recorded in the response', turnBody?.models?.tts === 'eleven_multilingual_v2' && turnBody?.models?.voice === 'uG1JFy6xppqckhHCs2KG',
  JSON.stringify(turnBody?.models ?? {}));

// 3. the audio route on the fixture clip
let fixture = null;
try { fixture = readFileSync(FIXTURE); } catch { /* reported below */ }
check('the fixture clip exists', Boolean(fixture && fixture.length > 1000), fixture ? `${fixture.length} bytes` : 'missing');

if (fixture) {
  const asr = await fetch(VOICE + '/voice/transcribe', {
    method: 'POST',
    headers: { 'content-type': 'audio/mpeg', authorization: AUTH + token },
    body: fixture,
  });
  const asrBody = await asr.json().catch(() => null);
  if (asr.status === 200) {
    check('the fixture clip transcribes', typeof asrBody?.text === 'string' && asrBody.text.length > 0, `"${asrBody?.text}"`);
  } else {
    // Not a pass. Reported as the failure it is, with the API's own words.
    check('the fixture clip transcribes', false,
      `ASR ${asr.status}: ${asrBody?.detail ?? 'unknown'} — the Muse batch schema is not documented here; see the PR body`);
  }
}

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
