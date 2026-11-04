// Isolated loopback-only voice experiment. Never loaded by the production voice server.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createVerifier } from './voice-auth.mjs';
import { parseHistory } from './voice-helpers.mjs';
import { voiceTurnEvents, parseRosinaEvents } from './voice-stream.mjs';

if (process.env.VOICE_STREAM_LAB !== '1') throw new Error('VOICE_STREAM_LAB must be explicitly enabled');
const port = Number(process.env.VOICE_STREAM_LAB_PORT || 4123);
const rosinaUrl = process.env.VOICE_STREAM_ROSINA_URL || 'http://127.0.0.1:4202/api/rosina';
const verify = createVerifier(), buckets = new Map();
const asrUrl = process.env.MUSE_ASR_URL || `${(process.env.META_BASE_URL || 'https://api.meta.ai/v1').replace(/\/$/, '')}/asr/transcribe`;
const voiceId = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL';
const ttsModel = 'eleven_flash_v2_5';
const asrModel = process.env.MUSE_ASR_MODEL || 'muse-voice-transcribe-1.0';
async function pcmWav(bytes, signal) {
  if (bytes.length >= 44 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE'
    && bytes.readUInt16LE(20) === 1 && bytes.readUInt16LE(22) === 1 && bytes.readUInt16LE(34) === 16
    && [16000, 24000].includes(bytes.readUInt32LE(24))) return bytes;
  return await new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', '16000', '-acodec', 'pcm_s16le', '-f', 'wav', 'pipe:1'], { stdio: ['pipe', 'pipe', 'pipe'], signal });
    const chunks = []; child.stdout.on('data', c => chunks.push(c)); child.stderr.resume();
    child.on('error', () => reject(new Error('AUDIO_CONVERSION_FAILED')));
    child.on('close', code => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error('AUDIO_CONVERSION_FAILED')));
    child.stdin.on('error', () => {}); child.stdin.end(bytes);
  });
}
async function transcribe(bytes, _type, { signal }) {
  const start = performance.now(), wav = await pcmWav(bytes, signal), conversionMs = performance.now() - start;
  const fd = new FormData();
  fd.append('request', new Blob([JSON.stringify({ model: asrModel, audioEncoding: 'WAV', mode: process.env.MUSE_ASR_MODE || 'PUSH_TO_TALK' })], { type: 'application/json' }), 'request.json');
  fd.append('audio', new Blob([wav], { type: 'audio/wav' }), 'clip.wav');
  const sent = performance.now();
  const res = await fetch(asrUrl, { method: 'POST', headers: { authorization: `Bearer ${process.env.META_API_KEY || ''}`, accept: 'application/json' }, body: fd, signal });
  const asrHeadersMs = performance.now() - sent;
  if (!res.ok) throw new Error(`ASR_HTTP_${res.status}`);
  const body = await res.json();
  return { transcript: body.transcript ?? body.text ?? body.results?.[0]?.alternatives?.[0]?.transcript,
    timings: { conversionMs, asrHeadersMs, transcriptionMs: performance.now() - sent } };
}
async function* synthesize(text, { signal }) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream/with-timestamps?output_format=pcm_24000`, {
    method: 'POST', signal, headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY || '', 'content-type': 'application/json' },
    body: JSON.stringify({ text, model_id: ttsModel }),
  });
  if (!res.ok || !res.body) throw new Error(`TTS_HTTP_${res.status}`);
  let buffer = '', firstByteAt = null; const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    firstByteAt ??= performance.now();
    buffer += decoder.decode(chunk, { stream: true });
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      const packet = JSON.parse(line);
      if (packet.audio_base64) yield { audio: Buffer.from(packet.audio_base64, 'base64'), alignment: packet.alignment, providerFirstByteAt: firstByteAt };
    }
  }
  if (buffer.trim()) {
    const packet = JSON.parse(buffer);
    if (packet.audio_base64) yield { audio: Buffer.from(packet.audio_base64, 'base64'), alignment: packet.alignment, providerFirstByteAt: firstByteAt };
  }
}
async function* rosinaStream(input) {
  const res = await fetch(rosinaUrl, { method: 'POST', signal: input.signal,
    headers: { 'content-type': 'application/json', accept: 'text/event-stream', authorization: `Bearer ${input.bearer}` },
    body: JSON.stringify({ message: input.message, currentRoute: '#/ask-rosina', history: input.history, selectedChildId: input.selectedChildId }),
  });
  yield* parseRosinaEvents(res);
}
const json = (res, status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || !['/voice/stream', '/voice/transcribe-prefix'].includes(req.url)) return json(res, 404, { error: 'NOT_FOUND' });
  const identity = await verify(req.headers.authorization);
  if (!identity.ok) return json(res, 401, { error: 'UNAUTHENTICATED' });
  const now = Date.now(), hits = (buckets.get(identity.personId) ?? []).filter(t => now - t < 60000);
  if (hits.length >= 30) return json(res, 429, { error: 'RATE_LIMITED' });
  hits.push(now); buckets.set(identity.personId, hits);
  const selectedChildId = req.headers['x-rosina-child'];
  if (selectedChildId !== undefined && !/^p_[a-z0-9_]{1,60}$/.test(String(selectedChildId))) return json(res, 400, { error: 'INVALID_CHILD_CONTEXT' });
  const controller = new AbortController(); res.on('close', () => controller.abort());
  const chunks = []; let size = 0; const uploadStart = performance.now();
  try {
    for await (const chunk of req) { size += chunk.length; if (size > 8 * 1024 * 1024) return json(res, 413, { error: 'TOO_LARGE' }); chunks.push(chunk); }
    const uploadReadMs = performance.now() - uploadStart, audio = Buffer.concat(chunks);
    // Prefix snapshots are observational ONLY. They can never invoke Rosina or produce proposals.
    if (req.url === '/voice/transcribe-prefix') {
      const asr = await transcribe(audio, req.headers['content-type'], { signal: controller.signal });
      return json(res, 200, { ...asr, interim: true, actionable: false });
    }
    res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store', 'x-accel-buffering': 'no' }); res.flushHeaders();
    const input = { audio, contentType: req.headers['content-type'], history: parseHistory(req.headers['x-rosina-history']), selectedChildId,
      bearer: req.headers.authorization.replace(/^Bearer\s+/i, ''), signal: controller.signal };
    for await (const event of voiceTurnEvents(input, { transcribe, synthesize, rosinaStream })) {
      if (event.type === 'done') {
        Object.assign(event.timings, { uploadReadMs, audioBytes: size, ttsModel, asrModel });
        console.log(JSON.stringify({ voiceLab: true, person: identity.personId, ...event.timings }));
      }
      res.write(JSON.stringify(event) + '\n');
    }
    res.end();
  } catch (e) {
    if (controller.signal.aborted) return;
    const code = /^(ASR_HTTP_\d+|TTS_HTTP_\d+|TRANSCRIPT_EMPTY|ROSINA_UNAVAILABLE|AUDIO_CONVERSION_FAILED)$/.test(e.message) ? e.message : 'VOICE_STREAM_FAILED';
    if (!res.headersSent) json(res, 502, { error: code });
    else { res.write(JSON.stringify({ type: 'error', error: code }) + '\n'); res.end(); }
    console.log(JSON.stringify({ voiceLab: true, error: code }));
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Voice streaming lab on 127.0.0.1:${port}; TTS ${ttsModel}`));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close());
