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
import { buildCreativeBrief, promptHash } from './invitePrompt';
import { createFixtureImageGenerator, createLiveImageGenerator, InviteImageConfirmedFailure, InviteImageUncertainFailure, type InviteImageGenerator } from './inviteImage';
import { createInviteRateLimiter } from './inviteBudget';
import { createInviteHandler, type InviteEndpointDeps } from './inviteEndpoint';
import { createInviteDedup } from './inviteDedup';
import type { InviteLedgerBudget } from './inviteLedgerBudget';

/** A fake per-child ledger mirroring the real RPC pair (0085) exactly: reserve always
 *  provisionally charges the FIXED per-generation cost (never a caller argument — mirrors the
 *  SQL constant, which real code never sends either); settle replaces that provisional charge
 *  with the ACTUAL charge computed from (status, cached) — $0 for FAILED or a cached SUCCEEDED,
 *  the full reserved amount for an uncached SUCCEEDED or any UNCERTAIN outcome. A reservation can
 *  only be settled once (mirrors the SQL's PENDING-only update). */
function fakeLedgerBudget(capUsd = 1.0, costPerGeneration = 0.01): InviteLedgerBudget & { settled: Array<{ status: string; cached: boolean; actualCost: number }> } {
  const reservations = new Map<string, { childId: string; cost: number }>(); // present = still PENDING
  const byChild = new Map<string, number>(); // childId -> sum of PENDING+SUCCEEDED+UNCERTAIN cost
  let seq = 0;
  const settled: Array<{ status: string; cached: boolean; actualCost: number }> = [];
  return {
    settled,
    async reserve({ childId }) {
      const used = byChild.get(childId) ?? 0;
      if (used + costPerGeneration > capUsd) return { allowed: false, generationId: null, remainingUsd: Math.max(0, capUsd - used) };
      seq += 1;
      const id = `ig_fake_${seq}`;
      reservations.set(id, { childId, cost: costPerGeneration });
      byChild.set(childId, used + costPerGeneration);
      return { allowed: true, generationId: id, remainingUsd: Math.max(0, capUsd - used - costPerGeneration) };
    },
    async settle({ generationId, status, cached }) {
      const r = reservations.get(generationId);
      if (!r) return false; // already settled, or never reserved — settle is once-only
      reservations.delete(generationId);
      const actualCost = status === 'FAILED' ? 0 : status === 'SUCCEEDED' && cached ? 0 : r.cost;
      settled.push({ status, cached, actualCost });
      const used = byChild.get(r.childId) ?? 0;
      byChild.set(r.childId, Math.max(0, used - r.cost + actualCost));
      return true;
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
const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
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
    source: 'FIXTURE',
    now: () => new Date('2026-11-02T12:00:00Z'),
    ...over,
  };
}
const PNG_16x16 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAF0lEQVR4nGP4z8BAEiJN9aiGUQ1DSgMAkPn/Afnh+ngAAAAASUVORK5CYII=';
const body = { childId: 'p_nora', request: 'dinosaur birthday invite for Nora on Nov 15 at Maple Hall, 2-4pm', referenceImage: { mimeType: 'image/png', dataBase64: PNG_16x16 } };

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

// ---- creative brief (parent's request drives the art) ----

test('the creative brief preserves the parent’s subject/style/wording and keeps safety constraints', () => {
  const req = 'watercolor warrior unicorns in golden armor with “Happy Birthday Sam” across the top';
  const prompt = buildCreativeBrief(req);
  assert.match(prompt, /warrior unicorns/);
  assert.match(prompt, /Happy Birthday Sam/);        // the parent's wording is honored, not stripped
  assert.match(prompt, /real, identifiable people/i); // safety constraints remain
});

test('a reference request becomes an edit brief; a revision preserves existing elements', () => {
  const edit = buildCreativeBrief('make them warrior unicorns', { hasReference: true });
  assert.match(edit, /Transform the provided reference image/i);
  const rev = buildCreativeBrief('add balloons', { revise: true });
  assert.match(rev, /preserving every existing element/i);
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
      image: { peekCached: () => false, generate: async () => { imaged = true; throw new Error('should not reach'); } },
    }))(fakeReq(auth, body), res);
    assert.equal(res.code, 403);
    assert.deepEqual(res.payload, { error: 'UNAUTHORIZED' });
    assert.equal(extracted, false, 'no Spark call on refusal');
    assert.equal(imaged, false, 'no image call on refusal');
  }
});

test('the per-child ledger budget: a new login for the SAME child cannot reset it, a DIFFERENT child has an independent budget, and FIXTURE never touches it', async () => {
  let reserveCalls = 0;
  const budget = fakeLedgerBudget(0.01); // exactly one generation's worth, at $0.01/generation
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
    const fetchFn = (async () => ({ ok: true, json: async () => ({ data: [{ b64_json: PNG_1x1 }] }) })) as unknown as typeof fetch;
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
  const fetchFn = (async () => { calls++; return { ok: true, json: async () => ({ data: [{ b64_json: PNG_1x1 }] }) }; }) as unknown as typeof fetch;
  const live = createLiveImageGenerator({ apiKey: 'k', baseUrl: 'http://unused/v1', fetchFn });
  const hash = promptHash(buildCreativeBrief('Birthday party'));
  const a = await live.generate({ prompt: buildCreativeBrief('Birthday party'), promptHash: hash });
  const b = await live.generate({ prompt: buildCreativeBrief('Birthday party'), promptHash: hash });
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


// ---- deduplication ----

test('two concurrent identical requests (same caller, same child, same text) share ONE real extraction+image call, never two', async () => {
  let extractCalls = 0, imageCalls = 0;
  const dedup = createInviteDedup();
  const h = createInviteHandler(deps({
    dedup,
    extractor: async () => { extractCalls++; await new Promise((r) => setTimeout(r, 10)); return { ...COMPLETE }; },
    image: { peekCached: () => false, generate: async () => { imageCalls++; return createFixtureImageGenerator().generate({ prompt: '', promptHash: 'h' }); } },
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
    image: { peekCached: () => false, generate: async () => { throw new Error('model down'); } },
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

// ---- cache hits and uncertain outcomes (corrections to #178) ----

test('a KNOWN cache hit skips reservation entirely — it is never blocked by an exhausted budget and never billed', async () => {
  const budget = fakeLedgerBudget(0.01); // exactly one generation's worth
  let reserveCalls = 0;
  const spyBudget: typeof budget = { ...budget, reserve: (i) => { reserveCalls++; return budget.reserve(i); } };
  const fetchFn = (async () => ({ ok: true, json: async () => ({ data: [{ b64_json: PNG_1x1 }] }) })) as unknown as typeof fetch;
  const live = createLiveImageGenerator({ apiKey: 'k', baseUrl: 'http://unused/v1', fetchFn });

  // First request: a real, uncached generation — consumes the only $0.01 of budget.
  const r1 = fakeRes();
  await createInviteHandler(deps({ ledgerBudget: spyBudget, source: 'MUSE_IMAGE', image: live }))(fakeReq(auth, body), r1);
  assert.equal(r1.code, 200);
  assert.equal(reserveCalls, 1);
  assert.equal(budget.settled.length, 1);
  assert.equal(budget.settled[0].cached, false);
  assert.equal(budget.settled[0].actualCost, 0.01, 'the real generation is charged the full price');

  // Second request, SAME request text -> same creative brief -> same hash -> the live
  // client's own cache already holds it, so the endpoint's peekCached() check sees it BEFORE
  // reserving. The budget was fully spent by request 1, but this must still succeed, because a
  // known cache hit is never billed and so must never be gated by the cap at all.
  const r2 = fakeRes();
  await createInviteHandler(deps({ ledgerBudget: spyBudget, source: 'MUSE_IMAGE', image: live }))(fakeReq(auth, body), r2);
  assert.equal(r2.code, 200, 'a known cache hit must succeed even though the reserved budget is fully spent');
  assert.equal(reserveCalls, 1, 'a known cache hit never calls reserve() at all — nothing to gate');
  assert.equal(budget.settled.length, 1, 'a known cache hit never calls settle() either — nothing was ever reserved to settle');

  // Third request, a GENUINELY DIFFERENT (not cached) prompt — a different creative REQUEST now
  // yields a different brief/hash (the art is driven by the parent's own request text, not the
  // extracted event schedule). The real budget is still fully spent by request 1's real
  // generation, so this is correctly refused. Proves the cache-hit exemption above is narrow: it
  // does not quietly reopen the budget for real new spend.
  const r3 = fakeRes();
  await createInviteHandler(deps({ ledgerBudget: spyBudget, source: 'MUSE_IMAGE', image: live }))(
    fakeReq(auth, { ...body, request: 'a totally different request — underwater mermaid castle party' }), r3,
  );
  assert.equal(r3.code, 429, 'a genuinely new, uncached request is still correctly refused — the real spend from request 1 is unaffected by the free cache hit');
});

test('a RACE (peekCached said false, but generate() turns out cached anyway) still settles $0 — settle-time `cached` is the real source of truth', async () => {
  const budget = fakeLedgerBudget(0.01);
  // A concurrent request populated the provider-side cache between this request's peekCached()
  // check and its own generate() call — simulated directly: peekCached lies (always false, so
  // the endpoint still reserves), but generate() returns cached:true regardless.
  const raceyImage: InviteImageGenerator = {
    peekCached: () => false,
    generate: async ({ promptHash }) => ({
      art: { mimeType: 'image/png', width: 1024, height: 1024, base64: 'QUJD', quietArea: { x: 0, y: 0, w: 1, h: 1 } },
      provenance: { source: 'MUSE_IMAGE', model: 'muse-image-1.0', cached: true, promptHash },
    }),
  };
  const res = fakeRes();
  await createInviteHandler(deps({ ledgerBudget: budget, source: 'MUSE_IMAGE', image: raceyImage }))(fakeReq(auth, body), res);
  assert.equal(res.code, 200);
  assert.equal(budget.settled.length, 1, 'this path DOES reserve (peekCached said false) and DOES settle — unlike the known-cache-hit path above');
  assert.equal(budget.settled[0].cached, true);
  assert.equal(budget.settled[0].actualCost, 0, 'the reservation is still correctly released to $0 by the real settle-time cached fact, even though it was reserved');
});

test('an UNCERTAIN outcome (network error after send) is charged conservatively, never released', async () => {
  const budget = fakeLedgerBudget(0.01); // exactly one generation's worth
  const uncertainImage: InviteImageGenerator = { peekCached: () => false, generate: async () => { throw new InviteImageUncertainFailure('IMAGE_NETWORK_timeout'); } };

  const r1 = fakeRes();
  await createInviteHandler(deps({ ledgerBudget: budget, source: 'MUSE_IMAGE', image: uncertainImage }))(fakeReq(auth, body), r1);
  assert.equal(r1.code, 502);
  assert.equal(budget.settled[0].status, 'UNCERTAIN');
  assert.equal(budget.settled[0].actualCost, 0.01, 'an uncertain outcome keeps the full reserved charge — the provider may have billed for it');

  // Budget is now fully spent by the UNCERTAIN charge — a second request for the same child must
  // be refused, proving the charge was real, not silently released.
  const r2 = fakeRes();
  await createInviteHandler(deps({ ledgerBudget: budget, source: 'MUSE_IMAGE', image: uncertainImage }))(fakeReq(auth, body), r2);
  assert.equal(r2.code, 429);
  assert.deepEqual(r2.payload, { error: 'BUDGET_EXHAUSTED' });
});

test('a CONFIRMED provider failure (a clean HTTP error, never generated) is free — distinct from UNCERTAIN', async () => {
  const budget = fakeLedgerBudget(0.01);
  const confirmedImage: InviteImageGenerator = { peekCached: () => false, generate: async () => { throw new InviteImageConfirmedFailure('IMAGE_HTTP_400'); } };

  const r1 = fakeRes();
  await createInviteHandler(deps({ ledgerBudget: budget, source: 'MUSE_IMAGE', image: confirmedImage }))(fakeReq(auth, body), r1);
  assert.equal(r1.code, 502);
  assert.equal(budget.settled[0].status, 'FAILED');
  assert.equal(budget.settled[0].actualCost, 0, 'a confirmed, never-generated failure costs nothing');

  // The released budget means a second request succeeds.
  const r2 = fakeRes();
  await createInviteHandler(deps({ ledgerBudget: budget, source: 'MUSE_IMAGE', image: createFixtureImageGenerator() }))(fakeReq(auth, body), r2);
  assert.equal(r2.code, 200, 'the confirmed failure released the budget, unlike an uncertain one');
});

test('createLiveImageGenerator classifies failures correctly: HTTP error -> CONFIRMED, malformed/oversized 200 body -> UNCERTAIN', async () => {
  const httpError = createLiveImageGenerator({
    apiKey: 'k', baseUrl: 'http://unused/v1',
    fetchFn: (async () => ({ ok: false, status: 400 })) as unknown as typeof fetch,
  });
  await assert.rejects(() => httpError.generate({ prompt: 'p', promptHash: 'h1' }), InviteImageConfirmedFailure);

  const networkError = createLiveImageGenerator({
    apiKey: 'k', baseUrl: 'http://unused/v1',
    fetchFn: (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch,
  });
  await assert.rejects(() => networkError.generate({ prompt: 'p', promptHash: 'h2' }), InviteImageUncertainFailure);

  const emptyBody = createLiveImageGenerator({
    apiKey: 'k', baseUrl: 'http://unused/v1',
    fetchFn: (async () => ({ ok: true, json: async () => ({ data: [{}] }) })) as unknown as typeof fetch,
  });
  await assert.rejects(() => emptyBody.generate({ prompt: 'p', promptHash: 'h3' }), InviteImageUncertainFailure);

  const oversized = createLiveImageGenerator({
    apiKey: 'k', baseUrl: 'http://unused/v1',
    fetchFn: (async () => ({ ok: true, json: async () => ({ data: [{ b64_json: 'A'.repeat(9_000_000) }] }) })) as unknown as typeof fetch,
  });
  await assert.rejects(() => oversized.generate({ prompt: 'p', promptHash: 'h4' }), InviteImageUncertainFailure);
});
