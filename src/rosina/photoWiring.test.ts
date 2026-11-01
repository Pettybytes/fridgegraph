/**
 * Exercises the REAL production wiring (buildPhotoDeps + the endpoint handler), not a handler
 * built from injected pass/fail stubs. Only the external boundaries are faked: an RLS-scoped DB
 * client that implements `orbit_photo_access` + `orbit_vocabulary` as the caller, a temp photo
 * dir, and the vision client. If the old `authorize:()=>false` / `photoStore:()=>null` /
 * `vocabulary:()=>new Map()` ever came back, Kendra's 200 case here would fail.
 * Run with: npm run test:rosina
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Request, Response } from 'express';
import { buildPhotoDeps, type DbForFn } from './photoDeps';
import { createPhotoDescriptorsHandler } from './photoEndpoint';
import { VISION_MODEL_ID, type VisionClient } from './photoDescriptors';

const photoDir = mkdtempSync(join(tmpdir(), 'orbit-photos-'));
writeFileSync(join(photoDir, 'orbit-nora.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9])); // tiny stand-in; vision is faked
// ph_leo is for a different child and has no file — it must 403 on authorization, never reach the file.

const PHOTOS: Record<string, { child: string; path: string }> = {
  ph_nora: { child: 'p_nora', path: 'orbit-nora.jpg' },
  ph_leo: { child: 'p_leo', path: 'orbit-leo.jpg' },
};

/** Fake RLS client: orbit_photo_access decides by the caller's token, like the real accessor. */
const fakeDbFor: DbForFn = (ctx) => ({
  async rpc(fn, args) {
    if (fn !== 'orbit_photo_access') return { data: null, error: { message: 'unknown rpc' } };
    const photo = PHOTOS[String((args as { p_photo?: unknown }).p_photo)];
    // Only Kendra (token 'kendra') is a parent; everyone else, and unknown photos, get null.
    if (ctx.token === 'kendra' && photo) return { data: [{ access: 'PARENT', storage_path: photo.path, child_id: photo.child }], error: null };
    return { data: [], error: null }; // unauthorized == nonexistent: the same empty answer
  },
  from() {
    return { async select() { return { data: [{ kind: 'WEAR_COLOR', value: 'yellow' }, { kind: 'CARRY_ITEM', value: 'backpack' }], error: null }; } };
  },
});

const vision: VisionClient = { describe: async () => ({ modelId: VISION_MODEL_ID, source: 'live', descriptors: [{ key: 'wearColor', value: 'yellow' }, { key: 'carryItem', value: 'skateboard' }] }) };

function handler(visionClient: VisionClient | null) {
  return createPhotoDescriptorsHandler(buildPhotoDeps({
    verify: async (h) => (h === 'Bearer kendra' ? { ok: true, personId: 'p_mom' } : h === 'Bearer priya' ? { ok: true, personId: 'p_priya' } : { ok: false }),
    rateLimiter: { allow: () => true },
    vision: visionClient,
    photoDir,
    dbForFn: fakeDbFor,
  }));
}

function fakeReq(bearer: string, body: unknown): Request {
  return { header: (n: string) => (n.toLowerCase() === 'authorization' ? `Bearer ${bearer}` : undefined), body } as unknown as Request;
}
function fakeRes(): Response & { code: number; payload: unknown } {
  const r: Partial<Response> & { code: number; payload: unknown } = { code: 0, payload: undefined, status(c: number) { r.code = c; return r as Response }, json(o: unknown) { r.payload = o; return r as Response } };
  return r as Response & { code: number; payload: unknown };
}

test('Kendra with her own child’s photo → 200 with a vocabulary-only, review-only proposal', async () => {
  const res = fakeRes();
  await handler(vision)(fakeReq('kendra', { childId: 'p_nora', photoId: 'ph_nora' }), res);
  assert.equal(res.code, 200);
  const body = res.payload as { descriptors: Record<string, string>; dropped: unknown[] };
  assert.deepEqual(body.descriptors, { wearColor: 'yellow' }); // in-vocabulary only
  assert.ok(body.dropped.length >= 1); // the off-vocabulary 'skateboard' was dropped, not forced
});

test('Priya → 403 (she is not a parent of the child)', async () => {
  const res = fakeRes();
  await handler(vision)(fakeReq('priya', { childId: 'p_nora', photoId: 'ph_nora' }), res);
  assert.equal(res.code, 403);
});

test('another child’s photo → the same generic 403', async () => {
  const res = fakeRes();
  await handler(vision)(fakeReq('kendra', { childId: 'p_nora', photoId: 'ph_leo' }), res);
  assert.equal(res.code, 403);
  assert.deepEqual(res.payload, { error: 'NOT_AUTHORIZED' });
});

test('a missing photo id → the same generic 403 (no existence oracle)', async () => {
  const res = fakeRes();
  await handler(vision)(fakeReq('kendra', { childId: 'p_nora', photoId: 'ph_missing' }), res);
  assert.equal(res.code, 403);
  assert.deepEqual(res.payload, { error: 'NOT_AUTHORIZED' });
});

test('vision unconfigured → a clear 503, not a false refusal', async () => {
  const res = fakeRes();
  await handler(null)(fakeReq('kendra', { childId: 'p_nora', photoId: 'ph_nora' }), res);
  assert.equal(res.code, 503);
});
