/**
 * Creative Muse invite workflow (offline, injected deps; no network):
 *   - the parent's request drives the art (no preset theme), including requested wording;
 *   - a reference image routes to /images/edits (real image-to-image), and a revision edits the prior
 *     result preserving existing elements;
 *   - art is produced WITHOUT a complete event schedule; missing details are suggested, never invented;
 *   - output format + dimensions are read from the ACTUAL provider bytes (not assumed PNG 1024×1024);
 *   - preserved invariants: tenant authorization, upload hygiene, per-child budget (once), uncertain
 *     handling, and no graph data in the provider request.
 * Also unit-covers imageHygiene. Run: npm run test:rosina
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Request, Response } from 'express';
import { sniffImageMime, stripImageMetadata, readImageDimensions } from './imageHygiene';
import { createInviteHandler, type InviteEndpointDeps } from './inviteEndpoint';
import { createInviteDedup } from './inviteDedup';
import { createLiveImageGenerator, InviteImageUncertainFailure, type InviteImageGenerator, type InviteImageRef, type InviteImageResult } from './inviteImage';
import type { InviteLedgerBudget } from './inviteLedgerBudget';

// ---- minimal real images ----
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngChunk = (type: string, data: Buffer) => { const c = Buffer.alloc(12 + data.length); c.writeUInt32BE(data.length, 0); c.write(type, 4, 'latin1'); data.copy(c, 8); c.writeUInt32BE(0, 8 + data.length); return c; };
function png({ w = 64, h = 64, text = true } = {}): Buffer {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([PNG_SIG, pngChunk('IHDR', ihdr), ...(text ? [pngChunk('tEXt', Buffer.from('Comment\0GPS 42.3 SECRET'))] : []), pngChunk('IDAT', Buffer.from([0x78, 0x9c, 0x00])), pngChunk('IEND', Buffer.alloc(0))]);
}
function webp({ w = 200, h = 100 } = {}): Buffer {
  const chunk = (tag: string, data: Buffer) => { const size = data.length; const pad = size + (size % 2); const c = Buffer.alloc(8 + pad); c.write(tag, 0, 'latin1'); c.writeUInt32LE(size, 4); data.copy(c, 8); return c; };
  const vp8x = Buffer.alloc(10); vp8x.writeUIntLE(w - 1, 4, 3); vp8x.writeUIntLE(h - 1, 7, 3);
  const payload = Buffer.concat([chunk('VP8X', vp8x), chunk('VP8 ', Buffer.from([1, 2, 3]))]);
  const size = Buffer.alloc(4); size.writeUInt32LE(payload.length + 4, 0);
  return Buffer.concat([Buffer.from('RIFF'), size, Buffer.from('WEBP'), payload]);
}

// ---- imageHygiene units ----
test('imageHygiene: sniff by magic bytes, strip metadata, read dimensions', () => {
  assert.equal(sniffImageMime(png()), 'image/png');
  assert.equal(sniffImageMime(webp()), 'image/webp');
  assert.equal(sniffImageMime(Buffer.from('%PDF-1.7')), null);
  assert.equal(stripImageMetadata(png(), 'image/png').includes(Buffer.from('SECRET')), false);
  assert.deepEqual(readImageDimensions(png({ w: 120, h: 90 }), 'image/png'), { width: 120, height: 90 });
  assert.deepEqual(readImageDimensions(webp({ w: 200, h: 100 }), 'image/webp'), { width: 200, height: 100 });
});

// ---- live generator: real endpoints, verified output format + dimensions ----
test('live generate reads the ACTUAL output format and dimensions (not assumed PNG 1024×1024)', async () => {
  const live = createLiveImageGenerator({ apiKey: 'k', baseUrl: 'http://x/v1', fetchFn: (async () => ({ ok: true, json: async () => ({ data: [{ b64_json: webp({ w: 300, h: 450 }).toString('base64') }], output_format: 'webp' }) })) as unknown as typeof fetch });
  const r = await live.generate({ prompt: 'p', promptHash: 'h' });
  assert.equal(r.art.mimeType, 'image/webp');
  assert.deepEqual([r.art.width, r.art.height], [300, 450]);
  assert.equal(r.provenance.outputFormat, 'webp');
  // quiet area tracks the actual size, not a 1024 constant
  assert.ok(r.art.quietArea.w <= 300 && r.art.quietArea.y >= 200);
});

test('a reference routes to /images/edits with the image in the body; a fresh request uses /generations', async () => {
  const calls: { url: string; hasImages: boolean }[] = [];
  const fetchFn = (async (url: string, init: { body: string }) => { const b = JSON.parse(init.body); calls.push({ url, hasImages: Array.isArray(b.images) && b.images.length > 0 }); return { ok: true, json: async () => ({ data: [{ b64_json: png().toString('base64') }], output_format: 'png' }) }; }) as unknown as typeof fetch;
  const live = createLiveImageGenerator({ apiKey: 'k', baseUrl: 'http://x/v1', fetchFn });
  await live.generate({ prompt: 'fresh', promptHash: 'h1' });
  const ref: InviteImageRef = { bytes: png(), mimeType: 'image/png' };
  await live.generate({ prompt: 'edit', promptHash: 'h2', images: [ref] });
  assert.match(calls[0].url, /\/images\/generations$/); assert.equal(calls[0].hasImages, false);
  assert.match(calls[1].url, /\/images\/edits$/); assert.equal(calls[1].hasImages, true);
});

// ---- endpoint harness ----
function fakeReq(headers: Record<string, string>, body: unknown): Request { return { header: (n: string) => headers[n.toLowerCase()], body } as unknown as Request; }
function fakeRes(): Response & { code: number; payload: any } { const r: any = { code: 0, payload: undefined, status(c: number) { r.code = c; return r; }, json(o: unknown) { r.payload = o; return r; } }; return r; }
function fakeLedger(): InviteLedgerBudget & { reserves: number; settled: { status: string }[] } {
  let seq = 0, reserves = 0; const settled: { status: string }[] = [];
  return { get reserves() { return reserves; }, settled, async reserve() { reserves += 1; seq += 1; return { allowed: true, generationId: `ig_${seq}`, remainingUsd: 1 }; }, async settle({ status }) { settled.push({ status }); return true; } } as InviteLedgerBudget & { reserves: number; settled: { status: string }[] };
}
function spyImage(): InviteImageGenerator & { calls: { prompt: string; images?: InviteImageRef[] }[] } {
  const calls: { prompt: string; images?: InviteImageRef[] }[] = [];
  return { calls, peekCached: () => false, async generate({ prompt, promptHash, images }): Promise<InviteImageResult> { calls.push({ prompt, images }); return { art: { mimeType: 'image/png', width: 120, height: 90, base64: png({ w: 120, h: 90 }).toString('base64'), quietArea: { x: 0, y: 0, w: 1, h: 1 } }, provenance: { source: 'MUSE_IMAGE', model: 'muse-image-1.0', cached: false, promptHash, outputFormat: 'png', edited: Boolean(images?.length) } }; } } as InviteImageGenerator & { calls: { prompt: string; images?: InviteImageRef[] }[] };
}
const auth = { authorization: 'Bearer T' };
function deps(over: Partial<InviteEndpointDeps> = {}): InviteEndpointDeps {
  return { verify: async () => ({ ok: true, personId: 'p_mom', demoGuide: false }), authorizeParent: async () => true, extractor: async () => ({ childFirstName: 'Sam', occasion: 'Birthday', date: '2026-12-01' }), image: spyImage(), rateLimiter: { take: () => ({ allowed: true }) }, dedup: createInviteDedup(), ledgerBudget: fakeLedger(), source: 'MUSE_IMAGE', now: () => new Date('2026-11-02T12:00:00Z'), ...over };
}
const refField = (buf: Buffer, mimeType = 'image/png') => ({ mimeType, dataBase64: buf.toString('base64') });

// ---- acceptance scenarios ----
test('1. generate an invitation from a creative text request (no schedule required)', async () => {
  const image = spyImage();
  const h = createInviteHandler(deps({ image, extractor: async () => ({}) /* nothing extracted — still generates */ }));
  const res = fakeRes();
  await h(fakeReq(auth, { childId: 'p_nora', request: 'a cosmic watercolor rocket party, dreamy and bright' }), res);
  assert.equal(res.code, 200);
  assert.equal(res.payload.status, 'READY');
  assert.match(image.calls[0].prompt, /cosmic watercolor rocket party/); // the request drives the art
  assert.equal(image.calls[0].images, undefined); // fresh generation
  assert.ok(res.payload.suggestion); // missing details are suggested, not invented
  assert.equal(res.payload.event.date, null);
});

test('2. upload unicorn artwork → warrior unicorns + “Happy Birthday Sam” → an edit of the reference', async () => {
  const image = spyImage();
  let seenBytesHasSecret: boolean | null = null;
  const h = createInviteHandler(deps({ image, ledgerBudget: fakeLedger() }));
  const wrap = image.generate.bind(image);
  image.generate = async (input) => { seenBytesHasSecret = input.images ? Buffer.from(input.images[0].bytes).includes(Buffer.from('SECRET')) : null; return wrap(input); };
  const res = fakeRes();
  await h(fakeReq(auth, { childId: 'p_nora', request: 'turn these into warrior unicorns in golden armor and add “Happy Birthday Sam”', referenceImage: refField(png()) }), res);
  assert.equal(res.code, 200);
  assert.ok(image.calls[0].images && image.calls[0].images.length === 1, 'the actual reference was sent as an edit input');
  assert.match(image.calls[0].prompt, /warrior unicorns/);
  assert.match(image.calls[0].prompt, /Happy Birthday Sam/);
  assert.match(image.calls[0].prompt, /Transform the provided reference image/i);
  assert.equal(seenBytesHasSecret, false, 'EXIF/GPS stripped before the provider');
  assert.equal(res.payload.reference.applied, true);
});

test('3. revise the generated result preserving existing elements', async () => {
  const image = spyImage();
  const h = createInviteHandler(deps({ image }));
  const prior = png({ w: 120, h: 90 }); // the prior generated art, sent back as the reference
  const res = fakeRes();
  await h(fakeReq(auth, { childId: 'p_nora', request: 'add floating balloons but keep the unicorns and the title', referenceImage: refField(prior), revise: true }), res);
  assert.equal(res.code, 200);
  assert.ok(image.calls[0].images && image.calls[0].images.length === 1);
  assert.match(image.calls[0].prompt, /Revise the provided invitation image/i);
  assert.match(image.calls[0].prompt, /preserving every existing element/i);
  assert.match(image.calls[0].prompt, /add floating balloons/);
});

test('5. a second authorized parent family can use the same workflow', async () => {
  const image = spyImage();
  const h = createInviteHandler(deps({ image, verify: async () => ({ ok: true, personId: 'p_otherdad', demoGuide: false }), authorizeParent: async ({ personId, childId }) => personId === 'p_otherdad' && childId === 'p_malik', extractor: async () => ({ childFirstName: 'Malik', occasion: 'Birthday', date: '2026-12-10' }) }));
  const res = fakeRes();
  await h(fakeReq(auth, { childId: 'p_malik', request: 'a jungle safari invitation with cartoon animals' }), res);
  assert.equal(res.code, 200);
  assert.equal(res.payload.event.childFirstName, 'Malik');
  assert.match(image.calls[0].prompt, /jungle safari/);
});

// ---- preserved invariants ----
test('upload hygiene: non-image rejected 415; oversize 413; bad dims 400 — zero provider calls', async () => {
  const image = spyImage();
  const mk = () => createInviteHandler(deps({ image }));
  const r1 = fakeRes(); await mk()(fakeReq(auth, { childId: 'p_nora', request: 'x', referenceImage: refField(Buffer.from('%PDF-1.7 not an image')) }), r1); assert.equal(r1.code, 415);
  const r2 = fakeRes(); await mk()(fakeReq(auth, { childId: 'p_nora', request: 'x', referenceImage: refField(Buffer.concat([png(), Buffer.alloc(5 * 1024 * 1024 + 1)])) }), r2); assert.equal(r2.code, 413);
  const r3 = fakeRes(); await mk()(fakeReq(auth, { childId: 'p_nora', request: 'x', referenceImage: refField(png({ w: 5000, h: 64 })) }), r3); assert.equal(r3.code, 400);
  assert.equal(image.calls.length, 0);
});

test('an unauthorized caller is refused (403) with zero provider calls, even with a reference', async () => {
  const image = spyImage();
  const res = fakeRes();
  await createInviteHandler(deps({ image, authorizeParent: async () => false }))(fakeReq(auth, { childId: 'p_nora', request: 'x', referenceImage: refField(png()) }), res);
  assert.equal(res.code, 403); assert.equal(image.calls.length, 0);
});

test('a generation (edit) charges the per-child budget exactly once; a provider failure settles conservatively (502)', async () => {
  const ledger = fakeLedger();
  const okRes = fakeRes();
  await createInviteHandler(deps({ ledgerBudget: ledger }))(fakeReq(auth, { childId: 'p_nora', request: 'warrior unicorns', referenceImage: refField(png()) }), okRes);
  assert.equal(okRes.code, 200); assert.equal(ledger.reserves, 1); assert.deepEqual(ledger.settled, [{ status: 'SUCCEEDED' }]);

  const l2 = fakeLedger();
  const failing: InviteImageGenerator = { peekCached: () => false, async generate() { throw new InviteImageUncertainFailure('IMAGE_EMPTY'); } };
  const failRes = fakeRes();
  await createInviteHandler(deps({ ledgerBudget: l2, image: failing }))(fakeReq(auth, { childId: 'p_nora', request: 'warrior unicorns' }), failRes);
  assert.equal(failRes.code, 502); assert.deepEqual(l2.settled, [{ status: 'UNCERTAIN' }]);
});

test('privacy: the provider never receives graph data — only the parent request + reference', async () => {
  const image = spyImage();
  await createInviteHandler(deps({ image }))(fakeReq(auth, { childId: 'p_secret_child_id', request: 'a starry night party' }), fakeRes());
  assert.equal(image.calls[0].prompt.includes('p_secret_child_id'), false); // childId never reaches the provider
  assert.match(image.calls[0].prompt, /starry night party/);
});
