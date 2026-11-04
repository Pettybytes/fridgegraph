/**
 * ops/voice-turn-proxy.test.mjs
 *
 * Proves the blocker-4 fix: the inbound GHL webhook `POST /voice-turn` reaches the voice-turn
 * server through serve-web instead of hitting the static server's GET/HEAD-only 405. Boots the
 * real serve-web.mjs against a stub upstream so the routing is exercised end to end, and confirms
 * the exact allowlist is not loosened: `/voice/*` and unlisted `/api/*` stay closed, static still
 * serves, and the webhook secret header is forwarded unchanged (auth stays at the upstream).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SERVE_WEB = new URL('./serve-web.mjs', import.meta.url).pathname;

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

// Stub upstream standing in for voice-turn-server.mjs: records what it received.
function startStub(port) {
  const received = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ method: req.method, url: req.url, secret: req.headers['x-fridgegraph-webhook-secret'], body });
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, from: 'stub-voice-turn' }));
    });
  });
  return new Promise((resolve) => srv.listen(port, '127.0.0.1', () => resolve({ srv, received })));
}

let child;
let stub;
let base;

before(async () => {
  const servePort = await freePort();
  const voicePort = await freePort();
  const root = mkdtempSync(join(tmpdir(), 'serve-web-root-'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>stub</title>app');

  stub = await startStub(voicePort);
  base = `http://127.0.0.1:${servePort}`;

  child = spawn(process.execPath, [SERVE_WEB], {
    env: { ...process.env, PORT: String(servePort), VOICE_TURN_PORT: String(voicePort), WEB_ROOT: root },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('serve-web did not start')), 5000);
    child.stdout.on('data', (d) => {
      if (String(d).includes('listening on 127.0.0.1')) { clearTimeout(to); resolve(); }
    });
    child.stderr.on('data', (d) => process.stderr.write(`[serve-web stderr] ${d}`));
    child.on('exit', (c) => { clearTimeout(to); reject(new Error(`serve-web exited early (${c})`)); });
  });
});

after(() => {
  if (child) child.kill('SIGTERM');
  if (stub?.srv) stub.srv.close();
});

test('POST /voice-turn reaches the upstream (no more static 405) and forwards the webhook secret', async () => {
  const r = await fetch(`${base}/voice-turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FridgeGraph-Webhook-Secret': 'test-secret-value' },
    body: JSON.stringify({ reply: 'YES', attemptId: 'att_1' }),
  });
  assert.equal(r.status, 201, 'should be the upstream 201, not 405');
  const json = await r.json();
  assert.equal(json.from, 'stub-voice-turn');

  const got = stub.received.at(-1);
  assert.equal(got.method, 'POST');
  assert.equal(got.url, '/voice-turn');
  assert.equal(got.secret, 'test-secret-value', 'webhook secret header must pass through to the upstream');
  assert.equal(JSON.parse(got.body).reply, 'YES');
});

test('the /voice-turn query string (GHL custom-action style) is forwarded intact', async () => {
  const r = await fetch(`${base}/voice-turn?attemptId=att_42`, { method: 'POST', body: '{}' });
  assert.equal(r.status, 201);
  assert.equal(stub.received.at(-1).url, '/voice-turn?attemptId=att_42');
});

test('the exact allowlist is not loosened: /voice/* and unlisted /api/* stay closed', async () => {
  const voiceSub = await fetch(`${base}/voice/turn`, { method: 'POST', body: '{}' });
  assert.equal(voiceSub.status, 404, '/voice/ subtree stays reserved -> 404');

  const api = await fetch(`${base}/api/not-allowed`, { method: 'POST', body: '{}' });
  assert.equal(api.status, 404, 'unlisted /api/* stays reserved -> 404');

  // A near-miss that must NOT match the exact /voice-turn rule: it is not proxied (so the stub
  // never sees it) and falls through to static handling, which rejects POST with 405.
  const seenBefore = stub.received.length;
  const near = await fetch(`${base}/voice-turn/extra`, { method: 'POST', body: '{}' });
  assert.equal(near.status, 405, '/voice-turn/extra is not the exact route -> static 405, not proxied');
  assert.equal(stub.received.length, seenBefore, 'near-miss path must never reach the upstream');
});

test('static SPA still serves on GET', async () => {
  const r = await fetch(`${base}/`);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /stub/);
});
