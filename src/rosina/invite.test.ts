/**
 * Invites slice tests: field extraction/validation, clarification on ambiguous dates, the art prompt
 * carrying no name/date/venue, non-parent refused with ZERO model calls, the per-CHILD ledger budget
 * surviving a new login (and staying independent per child, and untouched by FIXTURE), request
 * deduplication (concurrent identical requests share one real call; a different request or a retry
 * after failure is never deduplicated away), and the key never reaching logs. Express req/res faked;
 * all deps injected; no network.
 * Run: npm run test:rosina
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Request, Response } from 'express';
import { validateInviteFields } from './inviteFields';
import { buildArtPrompt, assertNoPii, promptHash } from './invitePrompt';
import { createFixtureImageGenerator, createLiveImageGenerator } from './inviteImage';
import { createInviteRateLimiter } from './inviteBudget';
import { createInviteHandler, type InviteEndpointDeps } from './inviteEndpoint';
import { createInviteDedup } from './inviteDedup';
import type { InviteLedgerBudget } from './inviteLedgerBudget';

/** A fake per-child ledger: in-memory per-child cap, mirrors what the real RPC pair (0085) does —
 *  reserve counts PENDING+SUCCEEDED against the cap; settle(FAILED) drops the reservation. */
function fakeLedgerBudget(capUsd = 1.0): InviteLedgerBudget & { settled: Array<{ status: string }> } {
  const reservations = new Map<string, number>(); // generationId -> costUsd, present = PENDING/SUCCEEDED
  const byChild = new Map<string, number>(); // childId -> sum of active reservations
  let seq = 0;
  const settled: Array<{ status: string }> = [];
  return {
    settled,
    async reserve({ childId, costUsd }) {
      const used = byChild.get(childId) ?? 0;
      if (used + costUsd > capUsd) return { allowed: false, generationId: null, remainingUsd: Math.max(0, capUsd - used) };
      seq += 1;
      const id = `ig_fake_${seq}`;
      reservations.set(id, costUsd);
      byChild.set(childId, used + costUsd);
      return { allowed: true, generationId: id, remainingUsd: Math.max(0, capUsd - used - costUsd) };
    },
    async settle({ generationId, status }) {
      settled.push({ status });
      if (status === 'FAILED') {
        // Need the child/cost to reverse — look it up the cheap way (fine for a fake).
        const cost = reservations.get(generationId);
        if (cost !== undefined) {
          for (const [child, used] of byChild) {
            if (used >= cost) { byChild.set(child, used - cost); break; }
          }
        }
      }
      return reservations.delete(generationId) || true;
    },
  };
}

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
    dedup: createInviteDedup(),
    ledgerBudget: fakeLedgerBudget(),
    generationCostUsd: 0.04,
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

test('the per-child ledger budget: a new login for the SAME child cannot reset it, a DIFFERENT child has an independent budget, and FIXTURE never touches it', async () => {
  let reserveCalls = 0;
  const budget = fakeLedgerBudget(0.04); // exactly one generation's worth
  const spyBudget: typeof budget = { ...budget, reserve: (i) => { reserveCalls++; return budget.reserve(i); } };

  const h = createInviteHandler(deps({ ledgerBudget: spyBudget, source: 'MUSE_IMAGE', image: createFixtureImageGenerator(), verify: async () => ({ ok: true, personId: 'p_mom', demoGuide: false }) }));
  const r1 = fakeRes(); await h(fakeReq(auth, body), r1);
  assert.equal(r1.code, 200); // first generation consumes p_nora's only budget

  // a DIFFERENT person (fresh login), SAME child — shares the same per-child budget
  const h2 = createInviteHandler(deps({ ledgerBudget: spyBudget, source: 'MUSE_IMAGE', image: createFixtureImageGenerator(), verify: async () => ({ ok: true, personId: 'p_other', demoGuide: false }) }));
  const r2 = fakeRes(); await h2(fakeReq(auth, body), r2);
  assert.equal(r2.code, 429);
  assert.deepEqual(r2.payload, { error: 'BUDGET_EXHAUSTED' });

  // a DIFFERENT child — independent budget, not exhausted by p_nora's spend
  const h3 = createInviteHandler(deps({ ledgerBudget: spyBudget, source: 'MUSE_IMAGE', image: createFixtureImageGenerator() }));
  const r3 = fakeRes(); await h3(fakeReq(auth, { ...body, childId: 'p_jax' }), r3);
  assert.equal(r3.code, 200, "a different child's budget must not be exhausted by p_nora's spend");

  assert.equal(reserveCalls, 3, 'MUSE_IMAGE reserves exactly once per actual request');

  // FIXTURE (the default/off path) never calls reserve at all — it spends nothing
  reserveCalls = 0;
  const hFixture = createInviteHandler(deps({ ledgerBudget: spyBudget, source: 'FIXTURE' }));
  const r4 = fakeRes(); await hFixture(fakeReq(auth, body), r4);
  assert.equal(r4.code, 200);
  assert.equal(reserveCalls, 0, 'FIXTURE must never reach the paid-budget ledger');
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

test('a name that is a prefix of a theme word does NOT trip the guard (Star/Fern)', async () => {
  // "Star" vs "twinkling stars"; "Fern" vs "ferns" — word boundaries, not substrings.
  assert.doesNotThrow(() => assertNoPii(buildArtPrompt("Star's space party"), { childFirstName: 'Star' }));
  assert.doesNotThrow(() => assertNoPii(buildArtPrompt("Fern's dinosaur party"), { childFirstName: 'Fern' }));
  assert.match(buildArtPrompt("Star's space party"), /stars/); // the theme word is really present
  assert.match(buildArtPrompt("Fern's dinosaur party"), /ferns/);

  // end to end: a child named Star gets a READY invite, not a 502
  const res = fakeRes();
  await createInviteHandler(deps({ extractor: async () => ({ childFirstName: 'Star', occasion: 'Space party', date: '2026-12-01' }) }))(fakeReq(auth, body), res);
  assert.equal(res.code, 200);
  assert.equal((res.payload as any).status, 'READY');
});

test('if a name is exactly a theme word, the guard refuses cleanly (502) BEFORE any budget reservation', async () => {
  let reserveCalls = 0;
  const budget = fakeLedgerBudget(1.0);
  const spyBudget: typeof budget = { ...budget, reserve: (i) => { reserveCalls++; return budget.reserve(i); } };
  // "Confetti" is a word in the birthday theme → the guard matches.
  const r1 = fakeRes();
  await createInviteHandler(deps({ ledgerBudget: spyBudget, source: 'MUSE_IMAGE', extractor: async () => ({ childFirstName: 'Confetti', occasion: 'Birthday party', date: '2026-12-01' }) }))(fakeReq(auth, body), r1);
  assert.equal(r1.code, 502);
  assert.deepEqual(r1.payload, { error: 'IMAGE_FAILED' });
  assert.equal(reserveCalls, 0, 'the guard runs BEFORE any reservation — nothing was ever reserved to refund');

  // a valid request still has the full budget available
  const r2 = fakeRes();
  await createInviteHandler(deps({ ledgerBudget: spyBudget, source: 'MUSE_IMAGE', extractor: async () => ({ childFirstName: 'Nora', occasion: 'Birthday party', date: '2026-12-01' }) }))(fakeReq(auth, body), r2);
  assert.equal(r2.code, 200);
  assert.equal(reserveCalls, 1);
});

// ---- deduplication ----

test('two concurrent identical requests (same caller, same child, same text) share ONE real extraction+image call, never two', async () => {
  let extractCalls = 0, imageCalls = 0;
  const dedup = createInviteDedup();
  const h = createInviteHandler(deps({
    dedup,
    extractor: async () => { extractCalls++; await new Promise((r) => setTimeout(r, 10)); return { ...COMPLETE }; },
    image: { generate: async () => { imageCalls++; return createFixtureImageGenerator().generate({ prompt: '', promptHash: 'h' }); } },
  }));
  const [r1, r2] = [fakeRes(), fakeRes()];
  await Promise.all([h(fakeReq(auth, body), r1), h(fakeReq(auth, body), r2)]);
  assert.equal(r1.code, 200);
  assert.equal(r2.code, 200);
  assert.deepEqual(r1.payload, r2.payload, 'both callers get the identical result');
  assert.equal(extractCalls, 1, 'one real extraction, not two');
  assert.equal(imageCalls, 1, 'one real image call, not two');
});

test('a DIFFERENT request text from the same caller is NOT deduplicated — it runs for real', async () => {
  let extractCalls = 0;
  const h = createInviteHandler(deps({ extractor: async () => { extractCalls++; return { ...COMPLETE }; } }));
  await h(fakeReq(auth, body), fakeRes());
  await h(fakeReq(auth, { ...body, request: body.request + ' with balloons' }), fakeRes());
  assert.equal(extractCalls, 2);
});

test('a request retried AFTER a failure is NOT deduplicated — an explicit retry must actually retry', async () => {
  let extractCalls = 0;
  const h = createInviteHandler(deps({
    source: 'MUSE_IMAGE',
    extractor: async () => { extractCalls++; return { ...COMPLETE }; },
    image: { generate: async () => { throw new Error('model down'); } },
  }));
  const r1 = fakeRes(); await h(fakeReq(auth, body), r1);
  assert.equal(r1.code, 502);
  const r2 = fakeRes(); await h(fakeReq(auth, body), r2); // explicit retry, same text
  assert.equal(r2.code, 502);
  assert.equal(extractCalls, 2, 'a failure is never cached — retry must run for real');
});

test('a successful MUSE_IMAGE generation settles the reservation SUCCEEDED with a real output hash', async () => {
  const settled: Array<{ status: string; outputSha256: string | null }> = [];
  const budget: InviteLedgerBudget = {
    reserve: async () => ({ allowed: true, generationId: 'ig_1', remainingUsd: 0.96 }),
    settle: async (i) => { settled.push({ status: i.status, outputSha256: i.outputSha256 }); return true; },
  };
  const res = fakeRes();
  await createInviteHandler(deps({ ledgerBudget: budget, source: 'MUSE_IMAGE' }))(fakeReq(auth, body), res);
  assert.equal(res.code, 200);
  assert.equal(settled.length, 1);
  assert.equal(settled[0].status, 'SUCCEEDED');
  assert.equal(settled[0].outputSha256?.length, 64, 'a real sha256 of the generated bytes, not null');
});
