/**
 * "Pin it to the fridge" — REAL dependency tests (offline, injected deps; no network, no shared stack).
 *   - private media store: sniff beats the claimed type, metadata is stripped, bytes land in a private
 *     dir, registration runs as the caller, load re-authorizes on every fetch;
 *   - persistence: caption→text / audience / attachment_ref mapping, deterministic idempotency, and a
 *     captionless pin is refused (never fabricated text);
 *   - readiness: default OFF;
 *   - end-to-end handlers: upload → prepare → confirm persists a fridge note; retrieval is caller-scoped.
 * The SQL authority itself (RLS, SECURITY DEFINER) is proven separately in ops/pin-real-proof.mjs.
 * Run: npm run test:rosina
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Request, Response } from 'express';
import type { Ctx } from '../authz';
import { sniffImageMime } from './pinMedia';
import { buildPinMediaStore } from './pinMediaStore';
import { createFridgeNotePinStore, type FridgeNoteWriter, type FridgeNoteRow } from './pinPersistence';
import { pinIntakeReadiness } from './pinReadiness';
import { createFixturePinExtractor } from './pinVision';
import { createPinHandlers, type PinEndpointDeps } from './pinEndpoint';

// ---- a minimal PNG with a tEXt chunk that must be stripped ----
function pngChunk(type: string, data: Buffer): Buffer {
  const c = Buffer.alloc(12 + data.length);
  c.writeUInt32BE(data.length, 0); c.write(type, 4, 'latin1'); data.copy(c, 8); c.writeUInt32BE(0, 8 + data.length);
  return c;
}
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  pngChunk('IHDR', Buffer.alloc(13, 1)),
  pngChunk('tEXt', Buffer.from('Comment\0GPS 42.33,-83.0 SECRET')),
  pngChunk('IDAT', Buffer.from([0x78, 0x9c, 0x00])),
  pngChunk('IEND', Buffer.alloc(0)),
]);

// ---- a fake RLS db mirroring 0090's register_pin_media / pin_media_access ----
type FakeOpts = { parents: Record<string, string[]>; shareReaders?: Record<string, string[]>; sharedAssets?: Set<string> };
function fakeDb(opts: FakeOpts) {
  const media = new Map<string, { childId: string; mime: string; path: string; owner: string }>();
  let n = 0;
  const dbForFn = (ctx: Ctx) => ({
    async rpc(fn: string, args: Record<string, unknown>) {
      const person = String(ctx.token); // token == personId in these tests
      if (fn === 'register_pin_media') {
        const child = String(args.p_child);
        if (!(opts.parents[person] ?? []).includes(child)) return { data: null, error: { message: 'UNAUTHORIZED' } };
        const id = `pm_${n++}`;
        media.set(id, { childId: child, mime: String(args.p_mime), path: String(args.p_path), owner: person });
        return { data: id, error: null };
      }
      if (fn === 'pin_media_access') {
        const m = media.get(String(args.p_media));
        if (!m) return { data: [], error: null };
        let access: string | null = null;
        if ((opts.parents[person] ?? []).includes(m.childId)) access = 'PARENT';
        else if (opts.sharedAssets?.has(String(args.p_media)) && (opts.shareReaders?.[person] ?? []).includes(m.childId)) access = 'SHARED';
        if (!access) return { data: [], error: null };
        return { data: [{ access, storage_path: m.path, child_id: m.childId, mime_type: m.mime }], error: null };
      }
      return { data: null, error: { message: 'UNKNOWN_FN' } };
    },
  });
  return { media, dbForFn: dbForFn as unknown as Parameters<typeof buildPinMediaStore>[0]['dbForFn'] };
}

// ---- media store ----

test('media store: sniff beats the claimed type; a PDF-as-PNG is refused', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pin-'));
  const { dbForFn } = fakeDb({ parents: { p_mom: ['p_nora'] } });
  const store = buildPinMediaStore({ mediaDir: dir, dbForFn });
  const lying = await store.put({ childId: 'p_nora', mimeType: 'image/png', bytes: Buffer.from('%PDF-1.7 not an image'), personId: 'p_mom', bearer: 'p_mom' });
  assert.deepEqual(lying, { ok: false, code: 'UNSUPPORTED' });
  assert.equal(sniffImageMime(PNG), 'image/png');
});

test('media store: strips metadata, writes a private file, registers as the caller', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pin-'));
  const { dbForFn } = fakeDb({ parents: { p_mom: ['p_nora'] } });
  const store = buildPinMediaStore({ mediaDir: dir, dbForFn });
  const put = await store.put({ childId: 'p_nora', mimeType: 'image/png', bytes: PNG, personId: 'p_mom', bearer: 'p_mom' });
  assert.equal(put.ok, true);
  const files = readdirSync(dir);
  assert.equal(files.length, 1);
  const { readFileSync } = await import('node:fs');
  const stored = readFileSync(join(dir, files[0]));
  assert.equal(stored.includes(Buffer.from('SECRET')), false, 'metadata stripped on disk');
  // load re-authorizes: the parent gets bytes, a stranger gets nothing.
  const asParent = await store.load({ assetId: (put as { assetId: string }).assetId, personId: 'p_mom', bearer: 'p_mom' });
  assert.ok(asParent && asParent.mimeType === 'image/png' && asParent.access === 'PARENT');
  const asStranger = await store.load({ assetId: (put as { assetId: string }).assetId, personId: 'p_x', bearer: 'p_x' });
  assert.equal(asStranger, null);
});

test('media store: a non-parent upload is refused and leaves no file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pin-'));
  const { dbForFn } = fakeDb({ parents: { p_mom: ['p_nora'] } });
  const store = buildPinMediaStore({ mediaDir: dir, dbForFn });
  const put = await store.put({ childId: 'p_nora', mimeType: 'image/png', bytes: PNG, personId: 'p_stranger', bearer: 'p_stranger' });
  assert.deepEqual(put, { ok: false, code: 'UNSUPPORTED' });
  assert.equal(readdirSync(dir).length, 0, 'the written file is cleaned up when registration is refused');
});

// ---- persistence ----

function fakeWriter() {
  const rows = new Map<string, FridgeNoteRow>();
  const writer: FridgeNoteWriter = async (_bearer, note) => {
    if (rows.has(note.id)) return 'EXISTS';
    rows.set(note.id, note); return 'CREATED';
  };
  return { rows, writer };
}

test('persistence maps caption→text/audience/attachment_ref and is deterministically idempotent', async () => {
  const { rows, writer } = fakeWriter();
  const store = createFridgeNotePinStore({ writer });
  const make = () => ({ pinId: 'ignored', callerId: 'p_mom', childId: 'p_nora', assetId: 'pm_1', kind: 'drawing' as const, audience: 'SHARED', caption: 'Nora drew our dog!', extracted: null });
  const r1 = await store.pin('pin:p_mom:p_nora:pm_1:prop_A:1', 'p_mom', make);
  assert.equal(r1.created, true);
  const row = [...rows.values()][0];
  assert.equal(row.text, 'Nora drew our dog!');
  assert.equal(row.audience, 'SHARED');
  assert.equal(row.attachmentRef, 'pm_1');
  assert.equal(row.authorId, 'p_mom');
  const r2 = await store.pin('pin:p_mom:p_nora:pm_1:prop_A:1', 'p_mom', make); // replay same key
  assert.equal(r2.created, false);
  assert.equal(r2.record.pinId, r1.record.pinId, 'same deterministic id');
  assert.equal(rows.size, 1, 'never a second row');
  const r3 = await store.pin('pin:p_mom:p_nora:pm_1:prop_B:1', 'p_mom', make); // distinct proposal
  assert.notEqual(r3.record.pinId, r1.record.pinId);
  assert.equal(rows.size, 2);
});

test('persistence refuses a captionless pin (never fabricates text)', async () => {
  const { writer } = fakeWriter();
  const store = createFridgeNotePinStore({ writer });
  await assert.rejects(
    () => Promise.resolve(store.pin('k', 'p_mom', () => ({ pinId: 'x', callerId: 'p_mom', childId: 'p_nora', assetId: 'pm_1', kind: 'other' as const, audience: 'PARENTS_ONLY', caption: null, extracted: null }))),
    /CAPTION_REQUIRED/,
  );
});

// ---- readiness ----

test('readiness is OFF by default and ON only when every piece is set', () => {
  assert.equal(pinIntakeReadiness({} as NodeJS.ProcessEnv).ready, false);
  const full = { PIN_INTAKE_READY: '1', PIN_LIVE: '1', ROSINA_PROPOSAL_SIGNING_KEY: 'k', ROSINA_GRAPHQL_URL: 'http://127.0.0.1:4012/', META_API_KEY: 'x', META_BASE_URL: 'y', META_MODEL_ID: 'z' } as unknown as NodeJS.ProcessEnv;
  assert.deepEqual(pinIntakeReadiness(full), { ready: true, reasons: [] });
});

// ---- end-to-end handlers with the real media store + fake db + fixture extractor + note persistence ----

function fakeReq(headers: Record<string, string>, body: unknown, params: Record<string, string> = {}): Request {
  return { header: (n: string) => headers[n.toLowerCase()], body, params, query: {} } as unknown as Request;
}
function fakeRes() {
  const r: { code: number; payload: unknown; headers: Record<string, string>; body?: Buffer; status(c: number): typeof r; json(o: unknown): typeof r; setHeader(k: string, v: string): void; send(b: unknown): typeof r } = {
    code: 0, payload: undefined, headers: {},
    status(c) { r.code = c; return r; },
    json(o) { r.payload = o; return r; },
    setHeader(k, v) { r.headers[k] = v; },
    send(b) { r.body = b as Buffer; return r; },
  };
  return r;
}

function e2eDeps(dir: string) {
  const { dbForFn } = fakeDb({ parents: { p_mom: ['p_nora'] } });
  const media = buildPinMediaStore({ mediaDir: dir, dbForFn });
  const { writer } = fakeWriter();
  const deps: PinEndpointDeps = {
    verify: async (h) => (h ? { ok: true, personId: (h.replace(/^Bearer\s+/i, '')), demoGuide: false } : { ok: false }),
    authorizeParent: async ({ personId, childId }) => personId === 'p_mom' && childId === 'p_nora',
    media,
    extractor: createFixturePinExtractor({ kind: 'drawing', confidence: 'high' }),
    pinStore: createFridgeNotePinStore({ writer }),
    mediaLoad: (input) => media.load(input),
    signingKey: 'k',
    now: () => new Date('2026-11-02T12:00:00Z'),
  };
  return deps;
}

test('end to end: upload → prepare → confirm persists; retrieval is caller-scoped', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pin-'));
  const h = createPinHandlers(e2eDeps(dir));
  const mom = { authorization: 'Bearer p_mom' };

  const up = fakeRes();
  await h.upload(fakeReq(mom, { childId: 'p_nora', mimeType: 'image/png', dataBase64: PNG.toString('base64') }), up as unknown as Response);
  assert.equal(up.code, 200);
  const assetId = (up.payload as { assetId: string }).assetId;

  const pr = fakeRes();
  await h.prepare(fakeReq(mom, { childId: 'p_nora', assetId, caption: 'Nora drew our dog!', audience: 'SHARED' }), pr as unknown as Response);
  assert.equal(pr.code, 200);
  const env = pr.payload as { proposal: { claims: unknown; signature: string }; extracted: { caption: string } };
  assert.equal((pr.payload as { classification: { kind: string } }).classification.kind, 'drawing');

  const cf = fakeRes();
  await h.confirm(fakeReq(mom, { claims: env.proposal.claims, signature: env.proposal.signature, reviewed: { caption: env.extracted.caption, extracted: env.extracted } }), cf as unknown as Response);
  assert.equal(cf.code, 200);
  assert.equal((cf.payload as { status: string }).status, 'PINNED');
  assert.equal((cf.payload as { pin: { assetId: string } }).pin.assetId, assetId);

  // Retrieval: the parent gets the bytes…
  const dlOk = fakeRes();
  await h.download(fakeReq(mom, null, { id: assetId }), dlOk as unknown as Response);
  assert.equal(dlOk.code, 0, 'no error status set');
  assert.ok(Buffer.isBuffer(dlOk.body) && dlOk.body.length > 0);
  assert.equal(dlOk.headers['Content-Type'], 'image/png');
  // …a different caller gets a generic 404 (no oracle).
  const dlNo = fakeRes();
  await h.download(fakeReq({ authorization: 'Bearer p_stranger' }, null, { id: assetId }), dlNo as unknown as Response);
  assert.equal(dlNo.code, 404);
});

test('end to end: a captionless confirm is refused 422 (fridge_notes.text is required)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pin-'));
  const h = createPinHandlers(e2eDeps(dir));
  const mom = { authorization: 'Bearer p_mom' };
  const up = fakeRes();
  await h.upload(fakeReq(mom, { childId: 'p_nora', mimeType: 'image/png', dataBase64: PNG.toString('base64') }), up as unknown as Response);
  const assetId = (up.payload as { assetId: string }).assetId;
  const pr = fakeRes();
  await h.prepare(fakeReq(mom, { childId: 'p_nora', assetId }), pr as unknown as Response); // no caption
  const env = pr.payload as { proposal: { claims: unknown; signature: string }; extracted: unknown };
  const cf = fakeRes();
  await h.confirm(fakeReq(mom, { claims: env.proposal.claims, signature: env.proposal.signature, reviewed: { caption: null, extracted: env.extracted } }), cf as unknown as Response);
  assert.equal(cf.code, 422);
  assert.equal((cf.payload as { error: string }).error, 'CAPTION_REQUIRED');
});

test('media access rejects a shared reference attached to another child', async () => {
 const dir=mkdtempSync(join(tmpdir(),'pin-child-'));
 const {writeFileSync}=await import('node:fs');
 writeFileSync(join(dir,'private.png'),PNG);
 let noteChild='p_other';
 const dbForFn=(()=>({
  rpc:async()=>({data:[{access:'SHARED',storage_path:'private.png',child_id:'p_nora',mime_type:'image/png'}],error:null}),
  from:()=>({select:async()=>({data:[{child_id:noteChild,attachment_ref:'pm_private',audience:'SHARED'}],error:null})}),
 })) as Parameters<typeof buildPinMediaStore>[0]['dbForFn'];
 const store=buildPinMediaStore({mediaDir:dir,dbForFn});
 const input={assetId:'pm_private',personId:'p_reader',bearer:'reader'};
 assert.equal(await store.load(input),null);
 assert.deepEqual(await store.access(input),{ok:false});
 noteChild='p_nora';
 assert.ok(await store.load(input));
});
