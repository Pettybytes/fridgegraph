/**
 * Ties the shipped sample kit to the pipeline: the exact sample files exist and render, real sample
 * quotes validate (fabricated ones do not), and each sample flows through the SAME prepare/confirm
 * handlers as a manual drop — (a) early dismissal → action, (b) ambiguous → one question → resume,
 * (c) field trip → review-only → 422. Stubbed extractor/reads; no network. Run: npm run test:rosina
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { Request, Response } from 'express';
import { findQuote } from './noticeFacts';
import { createNoticePlanHandlers, type NoticeEndpointDeps, type ScheduleReader, type NoticeExtractor } from './noticeEndpoint';
import type { ProposalEnvelope } from './noticeProposal';

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLES = resolve(here, 'samples');
const ASSETS = resolve(here, '../../web/public/samples/notice-plan');
const read = (f: string) => readFileSync(resolve(SAMPLES, f), 'utf8');

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
const noraReader: ScheduleReader = async () => ({ events: NORA_EVENTS, effectiveSource: 'WEEKLY' });

function deps(extractor: NoticeExtractor, over: Partial<NoticeEndpointDeps> = {}): NoticeEndpointDeps {
  return {
    verify: async () => ({ ok: true, personId: 'p_kendra' }),
    rateLimiter: { allow: () => true },
    scheduleReader: noraReader,
    extractor,
    requestPickup: async () => ({ ok: true, jobId: 'job_abc', status: 'discovering' }),
    signingKey: 'test-key',
    scenarioDate: '2026-10-26',
    now: () => new Date('2026-10-26T13:00:00Z'),
    newProposalId: () => 'np_fixed',
    ...over,
  };
}

test('all three samples ship source + rendered PNG/PDF', () => {
  for (const id of ['notice-a-early-dismissal', 'notice-b-ambiguous', 'notice-c-field-trip']) {
    assert.ok(existsSync(resolve(SAMPLES, `${id}.html`)), `${id}.html`);
    assert.ok(existsSync(resolve(SAMPLES, `${id}.txt`)), `${id}.txt`);
    assert.ok(existsSync(resolve(ASSETS, `${id}.png`)), `${id}.png`);
    assert.ok(existsSync(resolve(ASSETS, `${id}.pdf`)), `${id}.pdf`);
  }
});

test('(a) real sample quote validates; a fabricated one does not', () => {
  const text = read('notice-a-early-dismissal.txt');
  assert.ok(findQuote(text, 'early dismissal at 12:30 PM on Monday, October 26, 2026'));
  assert.ok(findQuote(text, 'released at 12:30 PM instead of the usual 3:00 PM'));
  assert.equal(findQuote(text, 'school is closed for the entire week'), null);
});

test('(a) early dismissal flows to a requestPickup action and confirms', async () => {
  const text = read('notice-a-early-dismissal.txt');
  const extractor: NoticeExtractor = async () => ({
    modelId: 'muse-spark-1.3', processingSource: 'text',
    facts: [{ kind: 'early_dismissal', dates: ['2026-10-26'], times: [{ label: 'dismissal', time: '12:30' }], appliesTo: 'all students (Grades K-5)', quote: 'early dismissal at 12:30 PM on Monday, October 26, 2026' }],
  });
  const h = createNoticePlanHandlers(deps(extractor));
  const rp = fakeRes();
  await h.prepare(fakeReq(auth, { childId: 'p_nora', notice: { kind: 'text', text } }), rp);
  assert.equal(rp.code, 200);
  const env = rp.payload as ProposalEnvelope;
  assert.ok('action' in env.changes[0].onConfirm);
  const rc = fakeRes();
  await h.confirm(fakeReq(auth, { claims: env.claims, signature: env.signature }), rc);
  assert.equal(rc.code, 200);
});

test('(b) ambiguous → one question, then resume continues the SAME proposal with a bumped version', async () => {
  const text = read('notice-b-ambiguous.txt');
  // First pass: the model cannot resolve "next Friday" → one clarification, no facts.
  const ambiguous: NoticeExtractor = async ({ answer }) =>
    answer
      ? { modelId: 'm', processingSource: 'text', facts: [{ kind: 'early_dismissal', dates: ['2026-10-30'], times: [{ label: 'dismissal', time: '12:30' }], appliesTo: 'all families', quote: 'students will be dismissed early next Friday for a staff meeting' }] }
      : { modelId: 'm', processingSource: 'text', facts: [], clarification: "Which Friday is 'next Friday' — Oct 30 or Nov 6?" };
  const h = createNoticePlanHandlers(deps(ambiguous, {
    scheduleReader: async () => ({ events: [{ id: 'e2', title: 'School', start: '2026-10-30T08:15:00', end: '2026-10-30T15:00:00' }], effectiveSource: 'WEEKLY' }),
  }));

  const r1 = fakeRes();
  await h.prepare(fakeReq(auth, { childId: 'p_nora', notice: { kind: 'text', text } }), r1);
  const env1 = r1.payload as ProposalEnvelope;
  assert.ok(env1.clarification, 'first pass asks a question');
  assert.equal(env1.claims.action, 'none');
  assert.equal(env1.version, 1);

  const r2 = fakeRes();
  await h.prepare(fakeReq(auth, { childId: 'p_nora', notice: { kind: 'text', text }, resume: { proposalId: env1.proposalId, version: env1.version, answer: 'Oct 30' } }), r2);
  const env2 = r2.payload as ProposalEnvelope;
  assert.equal(env2.proposalId, env1.proposalId, 'same proposal');
  assert.equal(env2.version, 2, 'version bumped');
  assert.equal(env2.clarification, null);
  assert.ok('action' in env2.changes[0].onConfirm, 'the answer resolves to an actionable conflict');
});

test('(c) field trip is review-only (no confirm button) and the server refuses confirm (422)', async () => {
  const text = read('notice-c-field-trip.txt');
  const extractor: NoticeExtractor = async () => ({
    modelId: 'm', processingSource: 'text',
    facts: [{ kind: 'field_trip', dates: ['2026-11-13'], times: [{ label: 'start', time: '09:30' }], appliesTo: 'Grade 3', quote: 'Grade 3 will visit the Maplewood Nature Center on Friday, November 13, 2026' }],
  });
  let pickupCalled = false;
  const h = createNoticePlanHandlers(deps(extractor, { requestPickup: async () => { pickupCalled = true; return { ok: true, jobId: 'x', status: 's' }; } }));

  const rp = fakeRes();
  await h.prepare(fakeReq(auth, { childId: 'p_nora', notice: { kind: 'text', text } }), rp);
  const env = rp.payload as ProposalEnvelope;
  const onConfirm = env.changes[0].onConfirm;
  assert.ok(!('action' in onConfirm), 'no confirm action for a permission slip');
  assert.equal(env.claims.action, 'none');

  const rc = fakeRes();
  await h.confirm(fakeReq(auth, { claims: env.claims, signature: env.signature }), rc);
  assert.equal(rc.code, 422);
  assert.equal(pickupCalled, false, 'requestPickup must never be called for a review-only notice');
});
