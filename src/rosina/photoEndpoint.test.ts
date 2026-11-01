/**
 * Tests for the photo-descriptors endpoint: authentication, rate limiting, and especially
 * AUTHORIZATION refusal — an unauthorized caller gets 403 and the photo is never loaded and
 * the vision model is never called. Express req/res are minimally faked; all deps injected.
 * Run with: npm run test:rosina
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Request, Response } from 'express';
import { createPhotoDescriptorsHandler, type PhotoEndpointDeps } from './photoEndpoint';
import { VISION_MODEL_ID, type VisionClient } from './photoDescriptors';

function fakeReq(headers: Record<string, string>, body: unknown): Request {
  return { header: (n: string) => headers[n.toLowerCase()], body } as unknown as Request;
}
function fakeRes(): Response & { code: number; payload: unknown } {
  const r: Partial<Response> & { code: number; payload: unknown } = {
    code: 0, payload: undefined,
    status(c: number) { r.code = c; return r as Response; },
    json(o: unknown) { r.payload = o; return r as Response; },
  };
  return r as Response & { code: number; payload: unknown };
}

const vocab = new Map<string, ReadonlySet<string>>([['WEAR_COLOR', new Set(['red'])]]);
const vision: VisionClient = { describe: async () => ({ modelId: VISION_MODEL_ID, source: 'live', descriptors: [{ key: 'wearColor', value: 'red' }] }) };

function deps(over: Partial<PhotoEndpointDeps> = {}): PhotoEndpointDeps {
  return {
    verify: async () => ({ ok: true, personId: 'p_mom' }),
    rateLimiter: { allow: () => true },
    authorize: async () => true,
    photoStore: { load: async () => ({ data: new Uint8Array([1]), contentType: 'image/png' }) },
    vocabulary: async () => vocab,
    vision,
    ...over,
  };
}
const body = { childId: 'child_1', photoId: 'photo_1' };
const auth = { authorization: 'Bearer T' };

test('401 when the bearer does not verify', async () => {
  const res = fakeRes();
  await createPhotoDescriptorsHandler(deps({ verify: async () => ({ ok: false }) }))(fakeReq(auth, body), res);
  assert.equal(res.code, 401);
});

test('429 when rate limited', async () => {
  const res = fakeRes();
  await createPhotoDescriptorsHandler(deps({ rateLimiter: { allow: () => false } }))(fakeReq(auth, body), res);
  assert.equal(res.code, 429);
});

test('400 when childId or photoId is missing', async () => {
  const res = fakeRes();
  await createPhotoDescriptorsHandler(deps())(fakeReq(auth, { childId: 'child_1' }), res);
  assert.equal(res.code, 400);
});

test('403 when the caller is not authorized — photo never loaded, vision never called', async () => {
  let loaded = false, described = false;
  const res = fakeRes();
  await createPhotoDescriptorsHandler(deps({
    authorize: async () => false,
    photoStore: { load: async () => { loaded = true; return { data: new Uint8Array(), contentType: 'image/png' }; } },
    vision: { describe: async () => { described = true; return { modelId: VISION_MODEL_ID, source: 'live', descriptors: [] }; } },
  }))(fakeReq(auth, body), res);
  assert.equal(res.code, 403);
  assert.deepEqual(res.payload, { error: 'NOT_AUTHORIZED' });
  assert.equal(loaded, false, 'photo must not load on refusal');
  assert.equal(described, false, 'vision must not run on refusal');
});

test('a missing / unloadable photo is the SAME generic 403 (no existence oracle)', async () => {
  const res = fakeRes();
  await createPhotoDescriptorsHandler(deps({ photoStore: { load: async () => null } }))(fakeReq(auth, body), res);
  assert.equal(res.code, 403);
  assert.deepEqual(res.payload, { error: 'NOT_AUTHORIZED' });
});

test('200 returns an in-vocabulary proposal when everything passes', async () => {
  const res = fakeRes();
  await createPhotoDescriptorsHandler(deps())(fakeReq(auth, body), res);
  assert.equal(res.code, 200);
  assert.deepEqual((res.payload as { descriptors: unknown }).descriptors, { wearColor: 'red' });
});
