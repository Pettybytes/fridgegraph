/**
 * Invite REFERENCE-IMAGE tests (offline, injected deps; no network). Covers the mandated matrix:
 * type/size/dimension rejection, EXIF stripped before the provider sees the bytes, an unauthorized
 * caller refused with ZERO provider calls, the per-child budget charged exactly once, provider
 * failure returning an honest error (text preserved client-side), and one end-to-end mocked run where
 * the generated card reflects the reference's extracted style. Also unit-covers imageHygiene and the
 * bounded style→prompt mapping. Run: npm run test:rosina
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Request, Response } from 'express';
import { sniffImageMime, stripImageMetadata, readImageDimensions } from './imageHygiene';
import { styleHintToFragment } from './inviteReference';
import { createInviteHandler, type InviteEndpointDeps } from './inviteEndpoint';
import { createInviteDedup } from './inviteDedup';
import { InviteImageUncertainFailure, type InviteImageGenerator } from './inviteImage';
import type { InviteLedgerBudget } from './inviteLedgerBudget';

// ---- minimal image builders (magic bytes + headers the hygiene/dimension code reads) ----
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function pngChunk(type: string, data: Buffer): Buffer {
  const c = Buffer.alloc(12 + data.length);
  c.writeUInt32BE(data.length, 0); c.write(type, 4, 'latin1'); data.copy(c, 8); c.writeUInt32BE(0, 8 + data.length);
  return c;
}
function png({ w = 64, h = 64, text = true }: { w?: number; h?: number; text?: boolean } = {}): Buffer {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    PNG_SIG, pngChunk('IHDR', ihdr),
    ...(text ? [pngChunk('tEXt', Buffer.from('Comment\0GPS 42.3,-83.0 SECRET'))] : []),
    pngChunk('IDAT', Buffer.from([0x78, 0x9c, 0x00])), pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
function jpeg({ w = 64, h = 64 }: { w?: number; h?: number } = {}): Buffer {
  const seg = (marker: number, payload: Buffer) => { const s = Buffer.alloc(4 + payload.length); s[0] = 0xff; s[1] = marker; s.writeUInt16BE(payload.length + 2, 2); payload.copy(s, 4); return s; };
  const app1 = seg(0xe1, Buffer.concat([Buffer.from('Exif\0\0'), Buffer.from('GPS SECRET')]));
  const sof = seg(0xc0, Buffer.from([0x08, (h >> 8) & 0xff, h & 0xff, (w >> 8) & 0xff, w & 0xff, 0x01, 0x01, 0x11, 0x00]));
  const scan = Buffer.concat([Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]), Buffer.from([0x11, 0x22]), Buffer.from([0xff, 0xd9])]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sof, scan]);
}
function webp({ w = 64, h = 64 }: { w?: number; h?: number } = {}): Buffer {
  const chunk = (tag: string, data: Buffer) => { const size = data.length; const pad = size + (size % 2); const c = Buffer.alloc(8 + pad); c.write(tag, 0, 'latin1'); c.writeUInt32LE(size, 4); data.copy(c, 8); return c; };
  const vp8xData = Buffer.alloc(10); vp8xData[0] = 0b00001100; // EXIF+XMP flags set
  vp8xData.writeUIntLE(w - 1, 4, 3); vp8xData.writeUIntLE(h - 1, 7, 3);
  const payload = Buffer.concat([chunk('VP8X', vp8xData), chunk('VP8 ', Buffer.from([1, 2, 3])), chunk('EXIF', Buffer.from('II* GPS SECRET'))]);
  const riffSize = Buffer.alloc(4); riffSize.writeUInt32LE(payload.length + 4, 0);
  return Buffer.concat([Buffer.from('RIFF'), riffSize, Buffer.from('WEBP'), payload]);
}

// ---- imageHygiene units ----
test('sniff trusts magic bytes; strip removes EXIF/GPS/text; dimensions read server-side', () => {
  assert.equal(sniffImageMime(png()), 'image/png');
  assert.equal(sniffImageMime(jpeg()), 'image/jpeg');
  assert.equal(sniffImageMime(webp()), 'image/webp');
  assert.equal(sniffImageMime(Buffer.from('%PDF-1.7\n')), null);
  for (const [buf, mime] of [[png(), 'image/png'], [jpeg(), 'image/jpeg'], [webp(), 'image/webp']] as const) {
    const stripped = stripImageMetadata(buf, mime);
    assert.equal(stripped.includes(Buffer.from('SECRET')), false, `${mime} metadata stripped`);
    assert.deepEqual(readImageDimensions(buf, mime), { width: 64, height: 64 }, `${mime} dims`);
  }
});

test('styleHintToFragment maps only fixed vocabulary; empty hint → empty string', () => {
  assert.equal(styleHintToFragment(null), '');
  assert.equal(styleHintToFragment({}), '');
  const frag = styleHintToFragment({ palette: 'warm', style: 'watercolor', mood: 'cheerful', subject: 'animals' });
  assert.match(frag, /warm palette/);
  assert.match(frag, /watercolor look/);
  assert.match(frag, /animals motifs/);
  assert.match(frag, /never reproducing the reference/);
});

// ---- endpoint harness ----
function fakeReq(headers: Record<string, string>, body: unknown): Request {
  return { header: (n: string) => headers[n.toLowerCase()], body } as unknown as Request;
}
function fakeRes(): Response & { code: number; payload: any } {
  const r: Partial<Response> & { code: number; payload: any } = { code: 0, payload: undefined, status(c: number) { r.code = c; return r as Response; }, json(o: unknown) { r.payload = o; return r as Response; } };
  return r as Response & { code: number; payload: any };
}
function fakeLedger(): InviteLedgerBudget & { reserves: number; settled: Array<{ status: string }> } {
  let seq = 0; const settled: Array<{ status: string }> = []; let reserves = 0;
  return {
    get reserves() { return reserves; }, settled,
    async reserve() { reserves += 1; seq += 1; return { allowed: true, generationId: `ig_${seq}`, remainingUsd: 1 }; },
    async settle({ status }) { settled.push({ status }); return true; },
  } as InviteLedgerBudget & { reserves: number; settled: Array<{ status: string }> };
}
function spyImage(): InviteImageGenerator & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    prompts, peekCached: () => false,
    async generate({ prompt, promptHash }) { prompts.push(prompt); return { art: { mimeType: 'image/png', width: 1024, height: 1024, base64: 'QUJD', quietArea: { x: 0, y: 0, w: 1, h: 1 } }, provenance: { source: 'MUSE_IMAGE', model: 'muse-image-1.0', cached: false, promptHash } }; },
  } as InviteImageGenerator & { prompts: string[] };
}
const COMPLETE = { childFirstName: 'Nora', occasion: 'Birthday party', date: '2026-11-15', startTime: '14:00', endTime: '16:00', placeLabel: 'Maple Hall' };
const auth = { authorization: 'Bearer T' };

function deps(over: Partial<InviteEndpointDeps> = {}): InviteEndpointDeps {
  return {
    verify: async () => ({ ok: true, personId: 'p_mom', demoGuide: false }),
    authorizeParent: async () => true,
    extractor: async () => ({ ...COMPLETE }),
    image: spyImage(),
    rateLimiter: { take: () => ({ allowed: true }) },
    dedup: createInviteDedup(),
    ledgerBudget: fakeLedger(),
    source: 'MUSE_IMAGE',
    now: () => new Date('2026-11-02T12:00:00Z'),
    ...over,
  };
}
const refBody = (buf: Buffer, mimeType = sniffImageMime(buf) ?? 'image/png') => ({ childId: 'p_nora', request: 'dinosaur birthday', referenceImage: { mimeType, dataBase64: buf.toString('base64') } });

test('a non-image reference is rejected (415) with zero provider calls', async () => {
  const image = spyImage(); let refCalls = 0;
  const h = createInviteHandler(deps({ image, referenceExtractor: async () => { refCalls += 1; return {}; } }));
  const res = fakeRes();
  await h(fakeReq(auth, refBody(Buffer.from('%PDF-1.7 not an image'), 'image/png')), res);
  assert.equal(res.code, 415);
  assert.equal(image.prompts.length, 0); assert.equal(refCalls, 0);
});

test('an oversize (>5MB) reference is rejected (413)', async () => {
  const big = Buffer.concat([png(), Buffer.alloc(5 * 1024 * 1024 + 1)]); // still sniffs PNG, but too large
  const res = fakeRes();
  await createInviteHandler(deps())(fakeReq(auth, refBody(big, 'image/png')), res);
  assert.equal(res.code, 413);
});

test('an over-dimension reference is rejected (400)', async () => {
  const res = fakeRes();
  await createInviteHandler(deps())(fakeReq(auth, refBody(png({ w: 5000, h: 64 }), 'image/png')), res);
  assert.equal(res.code, 400);
});

test('EXIF/GPS is stripped before the bytes reach the vision extractor', async () => {
  let seenBytes = 0;
  let seenHasSecret: boolean | null = null;
  const h = createInviteHandler(deps({ referenceExtractor: async ({ image }) => {
    const buf = Buffer.from(image.bytes); seenBytes = buf.length; seenHasSecret = buf.includes(Buffer.from('SECRET')); return { palette: 'warm' };
  } }));
  await h(fakeReq(auth, refBody(jpeg(), 'image/jpeg')), fakeRes());
  assert.ok(seenBytes > 0, 'the extractor received the image');
  assert.equal(seenHasSecret, false);
});

test('an unauthorized caller is refused (403) with zero provider calls', async () => {
  const image = spyImage(); let refCalls = 0;
  const h = createInviteHandler(deps({ image, authorizeParent: async () => false, referenceExtractor: async () => { refCalls += 1; return {}; } }));
  const res = fakeRes();
  await h(fakeReq(auth, refBody(png(), 'image/png')), res);
  assert.equal(res.code, 403);
  assert.equal(image.prompts.length, 0); assert.equal(refCalls, 0);
});

test('a reference generation charges the per-child budget exactly once', async () => {
  const ledger = fakeLedger();
  const h = createInviteHandler(deps({ ledgerBudget: ledger, referenceExtractor: async () => ({ palette: 'warm', mood: 'cheerful' }) }));
  const res = fakeRes();
  await h(fakeReq(auth, refBody(png(), 'image/png')), res);
  assert.equal(res.code, 200);
  assert.equal(ledger.reserves, 1);
  assert.deepEqual(ledger.settled, [{ status: 'SUCCEEDED' }]);
});

test('image provider failure → honest 502 (settled, not released); the request text is preserved client-side', async () => {
  const ledger = fakeLedger();
  const failing: InviteImageGenerator = { peekCached: () => false, async generate() { throw new InviteImageUncertainFailure('IMAGE_EMPTY'); } };
  const h = createInviteHandler(deps({ ledgerBudget: ledger, image: failing, referenceExtractor: async () => ({ palette: 'warm' }) }));
  const res = fakeRes();
  await h(fakeReq(auth, refBody(png(), 'image/png')), res);
  assert.equal(res.code, 502);
  assert.equal(res.payload.error, 'IMAGE_FAILED');
  assert.deepEqual(ledger.settled, [{ status: 'UNCERTAIN' }]); // charged conservatively, never silently released
});

test('vision failure falls back to plain art (still generates, referenceApplied=false)', async () => {
  const image = spyImage();
  const h = createInviteHandler(deps({ image, referenceExtractor: async () => { throw new Error('VISION_DOWN'); } }));
  const res = fakeRes();
  await h(fakeReq(auth, refBody(png(), 'image/png')), res);
  assert.equal(res.code, 200);
  assert.equal(res.payload.reference.requested, true);
  assert.equal(res.payload.reference.applied, false);
  assert.equal(image.prompts.length, 1); // the card is still generated
});

test('end to end: upload → the generated card reflects the reference style; fields stay editable', async () => {
  const image = spyImage();
  const h = createInviteHandler(deps({ image, referenceExtractor: async () => ({ palette: 'warm', style: 'watercolor', mood: 'cheerful' }) }));
  const res = fakeRes();
  await h(fakeReq(auth, refBody(png(), 'image/png')), res);
  assert.equal(res.code, 200);
  assert.equal(res.payload.status, 'READY');
  assert.equal(res.payload.reference.applied, true);
  // The art prompt the model received carries the extracted (fixed-vocabulary) style — the card reflects it.
  assert.match(image.prompts[0], /warm palette/);
  assert.match(image.prompts[0], /watercolor look/);
  // Event fields are returned for the user to keep editing after generation.
  assert.equal(res.payload.event.childFirstName, 'Nora');
  assert.equal(res.payload.event.occasion, 'Birthday party');
  assert.equal(res.payload.provenance.source, 'MUSE_IMAGE');
});

test('FIXTURE mode: a valid reference is accepted but never style-applied (live generation off)', async () => {
  const image = spyImage();
  const h = createInviteHandler(deps({ source: 'FIXTURE', image, referenceExtractor: async () => ({ palette: 'warm' }) }));
  const res = fakeRes();
  await h(fakeReq(auth, refBody(png(), 'image/png')), res);
  assert.equal(res.code, 200);
  assert.equal(res.payload.reference.applied, false); // honest: live generation is off
});
