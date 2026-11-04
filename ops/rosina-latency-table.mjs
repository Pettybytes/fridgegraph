#!/usr/bin/env node
/**
 * Rosina latency table (Bryan 2026-11-03 hard spec): 10 chat turns + 10 voice turns against a
 * served origin, p50/p95 per stage, pass/fail per target. Run three times in a row for the gate.
 *
 *   node ops/rosina-latency-table.mjs                         # https://fridgegraph.loomz.stream
 *   BASE_URL=http://127.0.0.1:5189 node ops/rosina-latency-table.mjs
 *   TURNS=10 VOICE_TURNS=10 PERSONA=kendra RUNS=3 node ops/rosina-latency-table.mjs
 *
 * Targets (public URL): first streamed token < 1000ms; full chat reply < 3000ms; voice reply
 * audio ready < 2000ms after end of speech (server-side asr+rosina+tts as the proxy; the browser
 * adds only decode/playback start on top).
 *
 * Measures CLIENT-perceived times (fetch start to event) plus the server's own stage meta
 * (lens/model/tools) so a miss points at its stage. Voice turns synthesize their input clip once
 * via /voice/speak, then replay it. Demo personas only; no secrets; read-only plus one TTS call.
 */

const BASE = (process.env.BASE_URL ?? 'https://fridgegraph.loomz.stream').replace(/\/$/, '');
const PERSONA = process.env.PERSONA ?? 'kendra';
const TURNS = Number(process.env.TURNS ?? 10);
const VOICE_TURNS = Number(process.env.VOICE_TURNS ?? 10);
const RUNS = Number(process.env.RUNS ?? 1);

const QUESTIONS = [
  "hi rosina, how's my night looking",
  'who has Nora tomorrow',
  'what is on the calendar this week',
  'any open pickup requests right now',
  'what are the snack rules',
  'when is the next school event',
  "how's tomorrow morning looking",
  'did anyone respond to the last pickup',
  'what time is pickup today',
  'is there anything I should know for today',
];

function quantile(values, q) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  return Math.round(sorted[base] + (sorted[Math.min(base + 1, sorted.length - 1)] - sorted[base]) * (pos - base));
}

async function login() {
  const r = await fetch(`${BASE}/api/demo/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ personaId: PERSONA }) });
  const b = await r.json();
  if (b.status !== 'READY') throw new Error(`login ${r.status} ${JSON.stringify(b).slice(0, 120)}`);
  return b.session.access_token;
}

async function chatTurn(token, message) {
  const started = Date.now();
  let ttfbMs = null, firstTokenMs = null, fullReplyMs = null, meta = null, reply = '';
  const res = await fetch(`${BASE}/api/rosina`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream', authorization: `Bearer ${token}` },
    body: JSON.stringify({ message, currentRoute: '#/today', history: [] }),
  });
  if (!res.ok || !res.body) return { error: `HTTP ${res.status}` };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', eventType = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (ttfbMs === null) ttfbMs = Date.now() - started;
    buffer += decoder.decode(value, { stream: true });
    for (;;) {
      const nl = buffer.indexOf('\n');
      if (nl === -1) break;
      const line = buffer.slice(0, nl).replace(/\r$/, '');
      buffer = buffer.slice(nl + 1);
      if (line.startsWith('event:')) { eventType = line.slice(6).trim(); continue; }
      if (!line.startsWith('data:')) continue;
      let payload; try { payload = JSON.parse(line.slice(5).trim()); } catch { continue; }
      if (eventType === 'token' && firstTokenMs === null) firstTokenMs = Date.now() - started;
      if (eventType === 'meta') meta = payload;
      if (eventType === 'final') { fullReplyMs = Date.now() - started; reply = String(payload.reply ?? ''); }
    }
  }
  return { ttfbMs, firstTokenMs, fullReplyMs, meta, replyChars: reply.length };
}

async function makeClip(token) {
  const r = await fetch(`${BASE}/voice/speak`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ text: 'How is my night looking?' }),
  });
  if (!r.ok) return null;
  const b = await r.json().catch(() => null);
  if (!b || typeof b.audioBase64 !== 'string') return null;
  return { bytes: Buffer.from(b.audioBase64, 'base64'), mime: typeof b.mimeType === 'string' ? b.mimeType : 'audio/mpeg' };
}

async function voiceTurn(token, clip) {
  const started = Date.now();
  const r = await fetch(`${BASE}/voice/turn`, {
    method: 'POST',
    headers: { 'content-type': clip.mime, authorization: `Bearer ${token}` },
    body: clip.bytes,
  });
  const totalMs = Date.now() - started;
  if (!r.ok) return { error: `HTTP ${r.status}` };
  const b = await r.json().catch(() => null);
  const t = b?.timings && typeof b.timings === 'object' ? b.timings : {};
  const audioReadyMs = [t.asrMs, t.rosinaMs, t.ttsMs].every((v) => typeof v === 'number') ? t.asrMs + t.rosinaMs + t.ttsMs : null;
  return { totalMs, asrMs: t.asrMs ?? null, rosinaMs: t.rosinaMs ?? null, ttsMs: t.ttsMs ?? null, audioReadyMs, gotAudio: typeof b?.audioBase64 === 'string' && b.audioBase64.length > 0 };
}

function table(rows, metrics) {
  const line = (cells) => `| ${cells.join(' | ')} |`;
  const out = [line(['metric', 'p50', 'p95', 'n']), line(['---', '---', '---', '---'])];
  for (const [label, key] of metrics) {
    const values = rows.map((row) => row[key]).filter((v) => typeof v === 'number');
    out.push(line([label, `${quantile(values, 0.5) ?? 'n/a'}ms`, `${quantile(values, 0.95) ?? 'n/a'}ms`, String(values.length)]));
  }
  return out.join('\n');
}

async function run(runIndex) {
  const token = await login();
  console.log(`\n===== RUN ${runIndex + 1}/${RUNS} base=${BASE} persona=${PERSONA} =====`);

  const chats = [];
  for (let i = 0; i < TURNS; i += 1) {
    const result = await chatTurn(token, QUESTIONS[i % QUESTIONS.length]);
    chats.push(result);
    console.log(`chat#${i + 1} ttfb=${result.ttfbMs}ms firstToken=${result.firstTokenMs}ms full=${result.fullReplyMs}ms stages=${JSON.stringify(result.meta?.stages ?? null)} ${result.error ?? ''}`);
  }
  console.log('\nCHAT (client-perceived):\n' + table(chats, [['ttfb', 'ttfbMs'], ['first token', 'firstTokenMs'], ['full reply', 'fullReplyMs']]));
  const stageRows = chats.map((c) => ({ lensMs: c.meta?.stages?.lensMs, modelMs: c.meta?.stages?.modelMs, toolsMs: c.meta?.stages?.toolsMs, firstAnswerMs: c.meta?.firstAnswerMs }));
  console.log('\nCHAT (server stages):\n' + table(stageRows, [['lens', 'lensMs'], ['model', 'modelMs'], ['tools', 'toolsMs'], ['first validated answer', 'firstAnswerMs']]));

  let voices = [];
  if (VOICE_TURNS > 0) {
    const clip = await makeClip(token);
    if (!clip) console.log('\nVOICE: skipped, /voice/speak unavailable on this origin');
    else {
      for (let i = 0; i < VOICE_TURNS; i += 1) {
        const result = await voiceTurn(token, clip);
        voices.push(result);
        console.log(`voice#${i + 1} total=${result.totalMs}ms asr=${result.asrMs}ms rosina=${result.rosinaMs}ms tts=${result.ttsMs}ms audioReady=${result.audioReadyMs}ms audio=${result.gotAudio} ${result.error ?? ''}`);
      }
      console.log('\nVOICE (server stages):\n' + table(voices, [['asr', 'asrMs'], ['rosina', 'rosinaMs'], ['tts', 'ttsMs'], ['audio ready (asr+rosina+tts)', 'audioReadyMs'], ['total round trip', 'totalMs']]));
    }
  }

  const firstTokenP95 = quantile(chats.map((c) => c.firstTokenMs).filter((v) => typeof v === 'number'), 0.95);
  const fullP95 = quantile(chats.map((c) => c.fullReplyMs).filter((v) => typeof v === 'number'), 0.95);
  const audioP95 = quantile(voices.map((v) => v.audioReadyMs).filter((v) => typeof v === 'number'), 0.95);
  const checks = [
    ['first token p95 < 1000ms', firstTokenP95, 1000],
    ['full reply p95 < 3000ms', fullP95, 3000],
    ...(voices.length ? [['voice audio ready p95 < 2000ms', audioP95, 2000]] : []),
  ];
  let pass = true;
  console.log('\nTARGETS:');
  for (const [label, value, limit] of checks) {
    const ok = typeof value === 'number' && value < limit;
    if (!ok) pass = false;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label} — measured ${value ?? 'n/a'}ms`);
  }
  return pass;
}

let allPass = true;
for (let i = 0; i < RUNS; i += 1) {
  // eslint-disable-next-line no-await-in-loop
  if (!(await run(i))) allPass = false;
}
console.log(`\nRESULT: ${allPass ? 'PASS' : 'FAIL'} (${RUNS} run${RUNS === 1 ? '' : 's'})`);
process.exit(allPass ? 0 : 1);
