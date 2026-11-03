/**
 * REAL loopback HTTP tests for GET /api/demo/voice-note/:voiceNoteId — a real Express app,
 * listening on a real ephemeral 127.0.0.1 port, hit with real `fetch()` calls. Every dependency
 * (auth verification, the voice_note_access RPC, file bytes) is injected and faked — no Supabase,
 * no shared stack, no real filesystem outside this process — but the HTTP layer itself (headers,
 * status codes, routing, body bytes) is exercised for real, which a mocked req/res object cannot
 * prove on its own.
 *
 * Replaces an earlier source-scan (grep-on-text) version of this test, which only proved the
 * route's SOURCE had the right shape, never that an actual request behaves correctly.
 *
 * Run with: npm run test:rosina -- (no, this lives under src/demo — run directly:)
 *   node --import tsx --test src/demo/voiceNoteEndpoint.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, type Server } from 'node:http';
import express from 'express';
import { createVoiceNoteHandler, type VoiceNoteEndpointDeps } from './voiceNoteEndpoint';

async function startServer(deps: VoiceNoteEndpointDeps): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const app = express();
  app.get('/api/demo/voice-note/:voiceNoteId', createVoiceNoteHandler(deps));
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('server did not bind to a loopback port');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return { baseUrl, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

const READY_BYTES = Buffer.from('RIFF....WAVEfmt fake-but-real-bytes-for-this-test', 'utf8');

function deps(over: Partial<VoiceNoteEndpointDeps> = {}): VoiceNoteEndpointDeps {
  return {
    verify: async () => ({ ok: true }),
    access: async () => ({ access: 'PARENT', storagePath: 'ready.mp3', contentType: 'audio/mpeg' }),
    loadBytes: () => READY_BYTES,
    ...over,
  };
}

test('a missing bearer is refused with 401, before any access check runs', async () => {
  let accessCalled = false;
  const { baseUrl, close } = await startServer(deps({
    verify: async () => ({ ok: false }),
    access: async () => { accessCalled = true; return { access: 'PARENT', storagePath: 'x.mp3', contentType: 'audio/mpeg' }; },
  }));
  try {
    const res = await fetch(`${baseUrl}/api/demo/voice-note/vn_1`);
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'UNAUTHENTICATED' });
    assert.equal(accessCalled, false, 'access() must not run when the bearer never verified');
  } finally { await close(); }
});

test('an invalid bearer (verify fails) is refused with 401', async () => {
  const { baseUrl, close } = await startServer(deps({ verify: async () => ({ ok: false }) }));
  try {
    const res = await fetch(`${baseUrl}/api/demo/voice-note/vn_1`, { headers: { authorization: 'Bearer garbage' } });
    assert.equal(res.status, 401);
  } finally { await close(); }
});

test('an authorized caller receives the real bytes, the correct content-type, and the access header', async () => {
  const { baseUrl, close } = await startServer(deps());
  try {
    const res = await fetch(`${baseUrl}/api/demo/voice-note/vn_1`, { headers: { authorization: 'Bearer T' } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'audio/mpeg', 'content-type must come from the injected access() result, never a hardcoded value');
    assert.equal(res.headers.get('x-voice-note-access'), 'PARENT');
    const body = Buffer.from(await res.arrayBuffer());
    assert.ok(body.equals(READY_BYTES), 'the exact injected bytes must be returned, unaltered');
  } finally { await close(); }
});

test('a refused id (access() returns null) is 404 — same shape as a nonexistent id', async () => {
  const { baseUrl, close } = await startServer(deps({ access: async () => null }));
  try {
    const res = await fetch(`${baseUrl}/api/demo/voice-note/vn_not_mine`, { headers: { authorization: 'Bearer T' } });
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'NOT_FOUND' });
  } finally { await close(); }
});

test('a missing id and a refused id return the IDENTICAL 404 body — no oracle', async () => {
  const refused = await startServer(deps({ access: async () => null }));
  const missing = await startServer(deps({ access: async () => null })); // access() returns null for a nonexistent id too
  try {
    const r1 = await fetch(`${refused.baseUrl}/api/demo/voice-note/vn_real_but_refused`, { headers: { authorization: 'Bearer T' } });
    const r2 = await fetch(`${missing.baseUrl}/api/demo/voice-note/vn_does_not_exist`, { headers: { authorization: 'Bearer T' } });
    assert.equal(r1.status, r2.status);
    assert.deepEqual(await r1.json(), await r2.json());
  } finally { await refused.close(); await missing.close(); }
});

test('granted access but a missing file on disk (loadBytes returns null) is also 404', async () => {
  const { baseUrl, close } = await startServer(deps({ loadBytes: () => null }));
  try {
    const res = await fetch(`${baseUrl}/api/demo/voice-note/vn_1`, { headers: { authorization: 'Bearer T' } });
    assert.equal(res.status, 404);
  } finally { await close(); }
});

test('Cache-Control: no-store is present on every response, including refusals', async () => {
  const ok = await startServer(deps());
  const refused = await startServer(deps({ verify: async () => ({ ok: false }) }));
  try {
    const r1 = await fetch(`${ok.baseUrl}/api/demo/voice-note/vn_1`, { headers: { authorization: 'Bearer T' } });
    const r2 = await fetch(`${refused.baseUrl}/api/demo/voice-note/vn_1`);
    assert.equal(r1.headers.get('cache-control'), 'no-store');
    assert.equal(r2.headers.get('cache-control'), 'no-store');
  } finally { await ok.close(); await refused.close(); }
});

test('reauthorization on a subsequent request: access() is re-run every time, not cached from the first call', async () => {
  let callCount = 0;
  const { baseUrl, close } = await startServer(deps({
    access: async () => {
      callCount += 1;
      // First request: access granted. Second request (same id, same connectionless client):
      // access has since been revoked — the route must ask again, not reuse the first answer.
      return callCount === 1 ? { access: 'PARENT', storagePath: 'ready.mp3', contentType: 'audio/mpeg' } : null;
    },
  }));
  try {
    const first = await fetch(`${baseUrl}/api/demo/voice-note/vn_1`, { headers: { authorization: 'Bearer T' } });
    assert.equal(first.status, 200);
    const second = await fetch(`${baseUrl}/api/demo/voice-note/vn_1`, { headers: { authorization: 'Bearer T' } });
    assert.equal(second.status, 404, 'a second real request after revocation must be refused — authority is not cached between requests');
    assert.equal(callCount, 2, 'access() must be invoked once per request, never reused');
  } finally { await close(); }
});
