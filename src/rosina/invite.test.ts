/**
 * Invites slice tests: field extraction/validation, clarification on ambiguous dates, the art prompt
 * carrying no name/date/venue, non-parent refused with ZERO model calls, the process budget surviving
 * a new login, and the key never reaching logs. Express req/res faked; all deps injected; no network.
 * Run: npm run test:rosina
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Request, Response } from 'express';
import { validateInviteFields } from './inviteFields';
import { buildArtPrompt, assertNoPii, promptHash } from './invitePrompt';
import { createFixtureImageGenerator, createLiveImageGenerator } from './inviteImage';
import { createGenerationBudget, createInviteRateLimiter } from './inviteBudget';
import { createInviteHandler, type InviteEndpointDeps } from './inviteEndpoint';

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
const COMPLETE = { childFirstName: 'Nora', occasion: 'Birthday party', date: '2026-11-15', startTime: '14:00', endTime: '16:00', placeLabel: 'Maple Hall' };

function deps(over: Partial<InviteEndpointDeps> = {}): InviteEndpointDeps {
  return {
    verify: async () => ({ ok: true, personId: 'p_mom', demoGuide: false }),
    authorizeParent: async () => true,
    extractor: async () => ({ ...COMPLETE }),
    image: createFixtureImageGenerator(),
    rateLimiter: { take: () => ({ allowed: true }) },
    budget: createGenerationBudget(100),
    source: 'FIXTURE',
    now: () => new Date('2026-11-02T12:00:00Z'),
    ...over,
  };
}
const body = { childId: 'p_nora', request: 'dinosaur birthday invite for Nora on Nov 15 at Maple Hall, 2-4pm' };

// ---- field validation / extraction ----

test('a complete extraction validates to READY editable fields', () => {
  const v = validateInviteFields(COMPLETE, { today: '2026-11-02' });
  assert.equal(v.status, 'READY');
  assert.deepEqual(v.event, { childFirstName: 'Nora', occasion: 'Birthday party', date: '2026-11-15', startTime: '14:00', endTime: '16:00', timezone: 'America/Detroit', placeLabel: 'Maple Hall' });
});

test('an ambiguous/missing date returns a clarification, never an invented fact', () => {
  const noDate = validateInviteFields({ childFirstName: 'Nora', occasion: 'Birthday party' }, { today: '2026-11-02' });
  assert.equal(noDate.status, 'NEEDS_CLARIFICATION');
  if (noDate.status === 'NEEDS_CLARIFICATION') assert.match(noDate.clarification.question, /date/i);
  assert.equal(noDate.event.date, null);

  const modelAmbiguous = validateInviteFields({ ...COMPLETE, date: undefined, clarification: "Is \"next Friday\" Nov 6 or Nov 13?" }, { today: '2026-11-02' });
  assert.equal(modelAmbiguous.status, 'NEEDS_CLARIFICATION');

  const past = validateInviteFields({ ...COMPLETE, date: '2020-01-01' }, { today: '2026-11-02' });
  assert.equal(past.status, 'NEEDS_CLARIFICATION');
});

// ---- art-only prompt ----

test('the art prompt contains no child name, date, venue, or time — even if the occasion hides a name', () => {
  const prompt = buildArtPrompt("Nora's dinosaur birthday"); // occasion carries the name
  const low = prompt.toLowerCase();
  for (const pii of ['nora', '2026-11-15', 'maple hall', '14:00', '16:00']) assert.ok(!low.includes(pii.toLowerCase()), `leaked: ${pii}`);
  assert.doesNotThrow(() => assertNoPii(prompt, COMPLETE));
  assert.match(prompt, /no text|no letters/i);
  assert.match(prompt, /no people|no faces/i);
  // the guard trips if PII is ever present
  assert.throws(() => assertNoPii('a party background for Nora', { childFirstName: 'Nora' }), /PII_LEAK/);
});

// ---- endpoint ----

test('READY: fixture art + editable event + provenance', async () => {
  const res = fakeRes();
  await createInviteHandler(deps())(fakeReq(auth, body), res);
  assert.equal(res.code, 200);
  const p = res.payload as any;
  assert.equal(p.status, 'READY');
  assert.equal(p.event.childFirstName, 'Nora');
  assert.equal(p.event.timezone, 'America/Detroit');
  assert.equal(p.art.mimeType, 'image/png');
  assert.ok(p.art.base64.length > 0);
  assert.deepEqual(p.art.quietArea, { x: 96, y: 600, w: 832, h: 328 });
  assert.equal(p.provenance.source, 'FIXTURE');
  assert.equal(p.provenance.model, null);
  assert.equal(p.provenance.cached, false);
  assert.equal(p.provenance.promptHash.length, 64);
});

test('401 unauthenticated; 400 when a photo field is present; 429 rate limit carries retryAfterMs', async () => {
  const r1 = fakeRes();
  await createInviteHandler(deps({ verify: async () => ({ ok: false }) }))(fakeReq(auth, body), r1);
  assert.equal(r1.code, 401);

  const r2 = fakeRes();
  await createInviteHandler(deps())(fakeReq(auth, { ...body, photoBase64: 'AAAA' }), r2);
  assert.equal(r2.code, 400);

  const r3 = fakeRes();
  await createInviteHandler(deps({ rateLimiter: { take: () => ({ allowed: false, retryAfterMs: 4200 }) } }))(fakeReq(auth, body), r3);
  assert.equal(r3.code, 429);
  assert.deepEqual(r3.payload, { error: 'RATE_LIMITED', retryAfterMs: 4200 });
});

test('a non-parent (and the demo guide) is refused with ZERO Spark or image calls', async () => {
  for (const over of [{ authorizeParent: async () => false }, { verify: async () => ({ ok: true as const, personId: 'p_guide', demoGuide: true }) }]) {
    let extracted = false, imaged = false;
    const res = fakeRes();
    await createInviteHandler(deps({
      ...over,
      extractor: async () => { extracted = true; return { ...COMPLETE }; },
      image: { generate: async () => { imaged = true; throw new Error('should not reach'); } },
    }))(fakeReq(auth, body), res);
    assert.equal(res.code, 403);
    assert.deepEqual(res.payload, { error: 'UNAUTHORIZED' });
    assert.equal(extracted, false, 'no Spark call on refusal');
    assert.equal(imaged, false, 'no image call on refusal');
  }
});

test('the generation budget is process-wide — a new login cannot reset it', async () => {
  const budget = createGenerationBudget(1);
  const h = createInviteHandler(deps({ budget, verify: async () => ({ ok: true, personId: 'p_mom', demoGuide: false }) }));
  const r1 = fakeRes(); await h(fakeReq(auth, body), r1);
  assert.equal(r1.code, 200); // first generation consumes the only budget

  // a DIFFERENT person (fresh login) shares the same process budget and cannot reset it
  const h2 = createInviteHandler(deps({ budget, verify: async () => ({ ok: true, personId: 'p_other', demoGuide: false }) }));
  const r2 = fakeRes(); await h2(fakeReq(auth, body), r2);
  assert.equal(r2.code, 429);
  assert.deepEqual(r2.payload, { error: 'BUDGET_EXHAUSTED' });
});

test('the key never reaches logs (live image client + endpoint)', async () => {
  const KEY = 'SUPER_SECRET_KEY_do_not_log_123';
  const captured: string[] = [];
  const origLog = console.log, origErr = console.error;
  console.log = (...a: unknown[]) => { captured.push(a.join(' ')); };
  console.error = (...a: unknown[]) => { captured.push(a.join(' ')); };
  try {
    const fetchFn = (async () => ({ ok: true, json: async () => ({ data: [{ b64_json: 'QUJD' }] }) })) as unknown as typeof fetch;
    const live = createLiveImageGenerator({ apiKey: KEY, baseUrl: 'http://unused/v1', fetchFn });
    const res = fakeRes();
    await createInviteHandler(deps({ image: live, source: 'MUSE_IMAGE' }))(fakeReq(auth, body), res);
    assert.equal(res.code, 200);
    assert.equal((res.payload as any).provenance.source, 'MUSE_IMAGE');
  } finally {
    console.log = origLog; console.error = origErr;
  }
  assert.ok(captured.length > 0, 'something was logged');
  for (const line of captured) assert.ok(!line.includes(KEY), `key leaked in log: ${line}`);
});

test('live image generator caches by prompt hash (miss then hit)', async () => {
  let calls = 0;
  const fetchFn = (async () => { calls++; return { ok: true, json: async () => ({ data: [{ b64_json: 'QUJD' }] }) }; }) as unknown as typeof fetch;
  const live = createLiveImageGenerator({ apiKey: 'k', baseUrl: 'http://unused/v1', fetchFn });
  const hash = promptHash(buildArtPrompt('Birthday party'));
  const a = await live.generate({ prompt: buildArtPrompt('Birthday party'), promptHash: hash });
  const b = await live.generate({ prompt: buildArtPrompt('Birthday party'), promptHash: hash });
  assert.equal(a.provenance.cached, false);
  assert.equal(b.provenance.cached, true);
  assert.equal(calls, 1, 'second call served from cache, model hit once');
});

test('per-caller rate limiter returns retryAfterMs when over the limit', () => {
  let t = 0;
  const rl = createInviteRateLimiter(2, 60_000, () => t);
  assert.equal(rl.take('p').allowed, true);
  assert.equal(rl.take('p').allowed, true);
  const d = rl.take('p');
  assert.equal(d.allowed, false);
  if (!d.allowed) assert.ok(d.retryAfterMs > 0 && d.retryAfterMs <= 60_000);
});
