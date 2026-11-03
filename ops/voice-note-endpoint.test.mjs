/**
 * Offline, mocked-media-service test for GET /api/demo/voice-note/:voiceNoteId — explicitly
 * SEPARATE from the SQL authorization proof (ops/demo-history-proof.mjs). Per
 * docs/contracts/demo-history.md §6: "a disposable-Postgres SQL proof alone does not and cannot
 * prove HTTP/signed-URL behavior."
 *
 * This is a STRUCTURAL check on the real route source in src/demo/server.ts, not a live HTTP
 * round-trip against a running server (that would need a real Supabase connection this offline
 * suite does not have) — stated plainly, not overclaimed. It verifies the properties that
 * actually matter for "private HTTP playback": the route requires a bearer before anything else,
 * sets Cache-Control: no-store on every path (not just success), calls voice_note_access on every
 * request (never a cached/trusted prior check), serves only via basename() (no path traversal
 * through a crafted storage_path), and returns the identical 404 shape whether the id doesn't
 * exist or access was refused.
 *
 * Run with: node --test ops/voice-note-endpoint.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync('src/demo/server.ts', 'utf8');
const start = source.indexOf("app.get('/api/demo/voice-note/:voiceNoteId'");
const routeBody = source.slice(start, source.indexOf('\n  });', start));

test('the voice-note route exists', () => {
  assert.ok(start >= 0, 'GET /api/demo/voice-note/:voiceNoteId not found in src/demo/server.ts');
});

test('Cache-Control: no-store is set before any auth/access check — covers every refusal path too', () => {
  const noStoreIndex = routeBody.indexOf("res.setHeader('Cache-Control', 'no-store')");
  const firstCheck = routeBody.indexOf('bearerToken(');
  assert.ok(noStoreIndex >= 0, 'no-store header not set');
  assert.ok(noStoreIndex < firstCheck, 'no-store must be set before the bearer check, not only on a success path');
});

test('a missing bearer is refused before any database call', () => {
  const bearerCheck = routeBody.indexOf('if (!token)');
  const dbCall = routeBody.indexOf('voice_note_access');
  assert.ok(bearerCheck >= 0 && dbCall >= 0 && bearerCheck < dbCall, 'bearer must be checked before voice_note_access is ever called');
});

test('voice_note_access is re-checked on every request — no cached/session-level authority', () => {
  assert.match(routeBody, /rpc\('voice_note_access',\s*\{\s*p_voice_note:\s*req\.params\.voiceNoteId\s*\}\)/);
});

test('not-found and no-access collapse to the identical 404 shape — no oracle', () => {
  assert.match(routeBody, /if \(error \|\| !row\?\.access \|\| !row\?\.storage_path\)/);
  const refusalBlock = routeBody.slice(routeBody.indexOf('if (error || !row?.access'));
  assert.match(refusalBlock.slice(0, 200), /res\.status\(404\)\.json\(\{ error: 'NOT_FOUND' \}\)/);
});

test('the served file path is derived with basename() — a crafted storage_path cannot traverse out of VOICE_NOTE_DIR', () => {
  assert.match(routeBody, /join\(VOICE_NOTE_DIR, basename\(row\.storage_path\)\)/);
});

test('no signed URL, token, or durable path is ever returned — only bytes, on this one request', () => {
  assert.equal(/signedUrl|signed_url|presign/i.test(routeBody), false);
});

test('the catch-all refusal also answers 404, not a 500 that could distinguish an internal error from a refusal', () => {
  const tail = routeBody.slice(routeBody.lastIndexOf('} catch'));
  assert.match(tail, /res\.status\(404\)\.json\(\{ error: 'NOT_FOUND' \}\)/);
});
