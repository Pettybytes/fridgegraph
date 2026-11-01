/**
 * Tests for the Notice → Plan endpoints: MIME/size enforcement, the generic refusal, the
 * server-side confirm gates (signature, expiry, stale, parent-only), and retry idempotency. Express
 * req/res are minimally faked; all deps injected; no network, no Meta cost. Run: npm run test:rosina
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Request, Response } from 'express';
import {
  createNoticePlanHandlers,
  type NoticeEndpointDeps,
  type NoticeExtractor,
  type ScheduleReader,
} from './noticeEndpoint';
import type { RawExtraction } from './noticeFacts';
import type { ProcessingSource } from './noticeFacts';
import type { ProposalEnvelope } from './noticeProposal';

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

const auth = { authorization: 'Bearer T' };
const NORA_EVENTS = [{ id: 'e_school_1026', title: 'School', start: '2026-10-26T08:15:00', end: '2026-10-26T15:00:00', location: 'Lincoln Elementary' }];

const earlyDismissalExtractor: NoticeExtractor = async ({ notice }): Promise<RawExtraction & { processingSource: ProcessingSource }> => ({
  modelId: 'muse-spark-1.3',
  processingSource: notice.kind === 'text' ? 'text' : notice.kind === 'pdf' ? 'pdf:rasterized' : 'image',
  facts: [{ kind: 'early_dismissal', dates: ['2026-10-26'], times: [{ label: 'dismissal', time: '12:30' }], appliesTo: 'all students', quote: 'early dismissal at 12:30 PM' }],
});

const noraReader: ScheduleReader = async () => ({ events: NORA_EVENTS, effectiveSource: 'WEEKLY' });

function deps(over: Partial<NoticeEndpointDeps> = {}): NoticeEndpointDeps {
  return {
    verify: async () => ({ ok: true, personId: 'p_kendra' }),
    rateLimiter: { allow: () => true },
    scheduleReader: noraReader,
    extractor: earlyDismissalExtractor,
    requestPickup: async () => ({ ok: true, jobId: 'job_abc', status: 'discovering' }),
    signingKey: 'test-key',
    scenarioDate: '2026-10-26',
    now: () => new Date('2026-10-26T13:00:00Z'),
    newProposalId: () => 'np_fixed',
    ...over,
  };
}

const textBody = { childId: 'p_nora', notice: { kind: 'text', text: 'School will have an early dismissal at 12:30 PM today.' } };

test('prepare 401 when the bearer does not verify', async () => {
  const res = fakeRes();
  await createNoticePlanHandlers(deps({ verify: async () => ({ ok: false }) })).prepare(fakeReq(auth, textBody), res);
  assert.equal(res.code, 401);
});

test('prepare 415 for an unsupported MIME', async () => {
  const res = fakeRes();
  await createNoticePlanHandlers(deps()).prepare(fakeReq(auth, { childId: 'p_nora', notice: { kind: 'image', mimeType: 'image/gif', dataBase64: 'AAAA' } }), res);
  assert.equal(res.code, 415);
});

test('prepare 413 when text exceeds the cap', async () => {
  const res = fakeRes();
  await createNoticePlanHandlers(deps({ maxTextChars: 10 })).prepare(fakeReq(auth, textBody), res);
  assert.equal(res.code, 413);
});

test('prepare 403 generic refusal when the caller cannot see the child', async () => {
  let extracted = false;
  const res = fakeRes();
  await createNoticePlanHandlers(deps({
    scheduleReader: async () => null,
    extractor: async (i) => { extracted = true; return earlyDismissalExtractor(i); },
  })).prepare(fakeReq(auth, textBody), res);
  assert.equal(res.code, 403);
  assert.deepEqual(res.payload, { error: 'UNAUTHORIZED' });
  assert.equal(extracted, false, 'must refuse before extracting');
});

test('prepare builds a signed proposal with a requestPickup action (12:30 vs 15:00)', async () => {
  const res = fakeRes();
  await createNoticePlanHandlers(deps()).prepare(fakeReq(auth, textBody), res);
  assert.equal(res.code, 200);
  const env = res.payload as ProposalEnvelope;
  assert.equal(env.changes.length, 1);
  const onConfirm = env.changes[0].onConfirm;
  assert.ok('action' in onConfirm && onConfirm.action === 'requestPickup');
  if ('action' in onConfirm) assert.equal(onConfirm.params.window, 'afternoon');
  assert.equal(env.claims.action, 'requestPickup');
  assert.ok(env.signature.length > 0);
});

test('prepare surfaces a clarification and no action', async () => {
  const res = fakeRes();
  await createNoticePlanHandlers(deps({
    extractor: async ({ notice }) => ({ modelId: 'muse-spark-1.3', processingSource: notice.kind === 'text' ? 'text' : 'image', facts: [], clarification: 'Which Friday — Nov 7 or Nov 14?' }),
  })).prepare(fakeReq(auth, textBody), res);
  assert.equal(res.code, 200);
  const env = res.payload as ProposalEnvelope;
  assert.ok(env.clarification);
  assert.equal(env.claims.action, 'none');
});

// ---- confirm ----

async function prepareEnvelope(over: Partial<NoticeEndpointDeps> = {}): Promise<ProposalEnvelope> {
  const res = fakeRes();
  await createNoticePlanHandlers(deps(over)).prepare(fakeReq(auth, textBody), res);
  return res.payload as ProposalEnvelope;
}

test('confirm calls requestPickup exactly once with the right window and returns the job', async () => {
  const env = await prepareEnvelope();
  let calls = 0; let lastWindow = '';
  const res = fakeRes();
  await createNoticePlanHandlers(deps({
    requestPickup: async ({ window }) => { calls++; lastWindow = window; return { ok: true, jobId: 'job_abc', status: 'discovering' }; },
  })).confirm(fakeReq(auth, { claims: env.claims, signature: env.signature }), res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.payload, { job: { id: 'job_abc', status: 'discovering' } });
  assert.equal(calls, 1);
  assert.equal(lastWindow, 'afternoon');
});

test('confirm is idempotent on retry — same job, never a second one', async () => {
  const env = await prepareEnvelope();
  const jobsByKey = new Map<string, string>();
  const requestPickup: NoticeEndpointDeps['requestPickup'] = async ({ childId, asOf, window }) => {
    const key = `${childId}:${asOf}:${window}`;
    if (!jobsByKey.has(key)) jobsByKey.set(key, `job_${jobsByKey.size + 1}`);
    return { ok: true, jobId: jobsByKey.get(key)!, status: 'discovering' };
  };
  const h = createNoticePlanHandlers(deps({ requestPickup }));
  const r1 = fakeRes(); await h.confirm(fakeReq(auth, { claims: env.claims, signature: env.signature }), r1);
  const r2 = fakeRes(); await h.confirm(fakeReq(auth, { claims: env.claims, signature: env.signature }), r2);
  assert.deepEqual(r1.payload, r2.payload);
  assert.equal(jobsByKey.size, 1, 'only one job ever created');
});

test('confirm 403 when requestPickup denies (Priya / non-parent) — enforced at the server', async () => {
  const env = await prepareEnvelope();
  let called = false;
  const res = fakeRes();
  await createNoticePlanHandlers(deps({
    requestPickup: async () => { called = true; return { ok: false, code: 'UNAUTHORIZED' }; },
  })).confirm(fakeReq(auth, { claims: env.claims, signature: env.signature }), res);
  assert.equal(res.code, 403);
  assert.deepEqual(res.payload, { error: 'UNAUTHORIZED' });
  assert.equal(called, true);
});

test('confirm 400 when the claims are tampered (signature no longer matches)', async () => {
  const env = await prepareEnvelope();
  const tampered = { ...env.claims, params: { asOf: '2026-10-26', window: 'morning' as const } };
  const res = fakeRes();
  await createNoticePlanHandlers(deps()).confirm(fakeReq(auth, { claims: tampered, signature: env.signature }), res);
  assert.equal(res.code, 400);
});

test('confirm 400 when a different caller reuses the token (caller binding)', async () => {
  const env = await prepareEnvelope(); // signed for p_kendra
  const res = fakeRes();
  await createNoticePlanHandlers(deps({ verify: async () => ({ ok: true, personId: 'p_priya' }) }))
    .confirm(fakeReq(auth, { claims: env.claims, signature: env.signature }), res);
  assert.equal(res.code, 400); // reconstructed callerId differs → signature fails
});

test('confirm 410 when the proposal has expired', async () => {
  const env = await prepareEnvelope();
  const res = fakeRes();
  await createNoticePlanHandlers(deps({ now: () => new Date('2026-10-26T13:30:00Z') })) // past the 15-min ttl
    .confirm(fakeReq(auth, { claims: env.claims, signature: env.signature }), res);
  assert.equal(res.code, 410);
});

test('confirm 409 when the schedule changed since prepare (stale)', async () => {
  const env = await prepareEnvelope();
  const res = fakeRes();
  await createNoticePlanHandlers(deps({
    scheduleReader: async () => ({ events: [{ ...NORA_EVENTS[0], end: '2026-10-26T14:00:00' }], effectiveSource: 'WEEKLY' }),
  })).confirm(fakeReq(auth, { claims: env.claims, signature: env.signature }), res);
  assert.equal(res.code, 409);
});

test('confirm 422 for a review-only proposal (no action)', async () => {
  const env = await prepareEnvelope({
    extractor: async ({ notice }) => ({ modelId: 'm', processingSource: notice.kind === 'text' ? 'text' : 'image', facts: [{ kind: 'field_trip', dates: ['2026-10-26'], times: [], appliesTo: 'grade 3', quote: 'early dismissal at 12:30 PM' }] }),
  });
  let called = false;
  const res = fakeRes();
  await createNoticePlanHandlers(deps({ requestPickup: async () => { called = true; return { ok: true, jobId: 'x', status: 's' }; } }))
    .confirm(fakeReq(auth, { claims: env.claims, signature: env.signature }), res);
  assert.equal(res.code, 422);
  assert.equal(called, false, 'requestPickup must not be called for a review-only proposal');
});

test('prepare 501 when PDF rasterization is unavailable', async () => {
  const res = fakeRes();
  await createNoticePlanHandlers(deps({
    extractor: async () => { throw new Error('PDF_NOT_SUPPORTED'); },
  })).prepare(fakeReq(auth, { childId: 'p_nora', notice: { kind: 'pdf', mimeType: 'application/pdf', dataBase64: Buffer.from('%PDF-1.4').toString('base64') } }), res);
  assert.equal(res.code, 501);
});
