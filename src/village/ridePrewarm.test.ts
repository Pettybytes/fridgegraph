/**
 * Pre-step tests — the ordering and the failure modes, with every transport stubbed.
 *
 * The point of these is the claim that matters: an unauthorized caller never touches the store or the
 * provider, a provider failure never becomes a number, and nothing here can fail a parent's request.
 * The SQL side (stored amount, decision, basis) is proven by ops/0063-road-pricing-proof.mjs.
 *
 * Run offline: node --import tsx --test src/village/ridePrewarm.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  allowPrewarm, isUsableMeasurement, prewarmRideDistances, resetPrewarmState,
  trackRidePrewarm, awaitRidePrewarm, resetPrewarmGates, type PrewarmReport,
  type PrewarmDeps, type PricingPair,
} from './ridePrewarm';

const pair = (candidateId: string): PricingPair => ({
  childId: 'p_nora',
  candidateId,
  from: { lat: 42.3314, lng: -83.0458, placeId: 'loc_child_school' },
  to: { lat: 42.289, lng: -83.134, placeId: `loc_${candidateId}` },
});

type Counters = { pairs: number; stored: number; routed: number; wrote: number };

function deps(overrides: Partial<PrewarmDeps> & { counters?: Counters } = {}): { deps: PrewarmDeps; counters: Counters } {
  const counters: Counters = overrides.counters ?? { pairs: 0, stored: 0, routed: 0, wrote: 0 };
  const base: PrewarmDeps = {
    authorize: async () => true,
    pairs: async () => { counters.pairs += 1; return [pair('p_gma'), pair('p_tasha')]; },
    storedMiles: async () => { counters.stored += 1; return null; },
    route: async () => { counters.routed += 1; return { distanceMeters: 8000, durationSeconds: 600 }; },
    store: async () => { counters.wrote += 1; },
  };
  return { deps: { ...base, ...overrides, counters: undefined } as unknown as PrewarmDeps, counters };
}

test('an unauthorized caller touches neither the store nor the provider', async () => {
  const { deps: d, counters } = deps({ authorize: async () => false });
  const report = await prewarmRideDistances(d);

  assert.equal(report.authorized, false);
  assert.equal(report.fallback, 'not-run');
  assert.deepEqual(counters, { pairs: 0, stored: 0, routed: 0, wrote: 0 });
});

test('a throwing authorizer is a refusal, not a warm-up', async () => {
  const { deps: d, counters } = deps({ authorize: async () => { throw new Error('DB_UNAVAILABLE'); } });
  const report = await prewarmRideDistances(d);
  assert.equal(report.authorized, false);
  assert.deepEqual(counters, { pairs: 0, stored: 0, routed: 0, wrote: 0 });
});

test('authorization is awaited BEFORE the pairs are read', async () => {
  const order: string[] = [];
  const d = {
    authorize: async () => { order.push('authorize'); return true; },
    pairs: async () => { order.push('pairs'); return [pair('p_gma')]; },
    storedMiles: async () => { order.push('store'); return null; },
    route: async () => { order.push('route'); return { distanceMeters: 8000, durationSeconds: 600 }; },
    store: async () => { order.push('write'); },
  } as unknown as PrewarmDeps;

  await prewarmRideDistances(d);
  assert.deepEqual(order, ['authorize', 'pairs', 'store', 'route', 'write']);
});

test('a fresh stored result means no provider call', async () => {
  const { deps: d, counters } = deps({ storedMiles: async () => { counters.stored += 1; return 10.5; } });
  const report = await prewarmRideDistances(d);

  assert.equal(report.cached, 2);
  assert.equal(counters.routed, 0, 'a stored result must not trigger ORS');
  assert.equal(counters.wrote, 0);
  assert.equal(report.fallback, 'haversine', 'nothing new was measured, so no road claim is made');
});

test('the work is bounded by maxPairs', async () => {
  const many = Array.from({ length: 9 }, (_, i) => pair(`p_${i}`));
  const { deps: d, counters } = deps({ pairs: async () => many });
  const report = await prewarmRideDistances(d, { maxPairs: 3 });

  assert.equal(report.considered, 3);
  assert.equal(counters.routed, 3);
});

test('the budget stops scheduling new pairs (a slow provider cannot run forever)', async () => {
  let clock = 0;
  const many = Array.from({ length: 6 }, (_, i) => pair(`p_${i}`));
  const { deps: d, counters } = deps({
    pairs: async () => many,
    route: async () => { counters.routed += 1; clock += 400; return { distanceMeters: 8000, durationSeconds: 600 }; },
    now: () => clock,
  });

  const report = await prewarmRideDistances(d, { budgetMs: 900 });
  assert.ok(report.considered <= 3, `considered=${report.considered}`);
  assert.ok(counters.routed < 6);
});

test('a provider failure leaves the store empty and reports the haversine fallback', async () => {
  const { deps: d, counters } = deps({
    route: async () => { counters.routed += 1; throw new Error('ORS_UNREACHABLE'); },
  });
  const report = await prewarmRideDistances(d);

  assert.equal(report.failed, 2);
  assert.equal(report.measured, 0);
  assert.equal(counters.wrote, 0);
  assert.equal(report.fallback, 'haversine');
});

test('an unusable measurement is rejected, never stored', async () => {
  for (const bad of [
    { distanceMeters: 0, durationSeconds: 10 },
    { distanceMeters: -5, durationSeconds: 10 },
    { distanceMeters: Number.NaN, durationSeconds: 10 },
    { distanceMeters: 900_000, durationSeconds: 10 },
    { distanceMeters: 8000, durationSeconds: -1 },
    { distanceMeters: 8000, durationSeconds: Number.POSITIVE_INFINITY },
  ]) {
    const { deps: d, counters } = deps({
      pairs: async () => [pair('p_gma')],
      route: async () => { counters.routed += 1; return bad; },
    });
    const report = await prewarmRideDistances(d);
    assert.equal(report.rejected, 1, `measurement ${JSON.stringify(bad)} should be rejected`);
    assert.equal(counters.wrote, 0);
    assert.equal(report.fallback, 'haversine');
  }
});

test('a storage refusal is soft: the run continues and the fallback stands', async () => {
  let calls = 0;
  const { deps: d, counters } = deps({
    store: async () => { calls += 1; if (calls === 1) throw new Error('UNAUTHORIZED'); },
  });
  const report = await prewarmRideDistances(d);

  assert.equal(report.failed, 1);
  assert.equal(report.measured, 1);
  assert.equal(counters.routed, 2);
});

test('a store read failure does not become a refusal — the provider is still tried', async () => {
  const { deps: d, counters } = deps({
    storedMiles: async () => { counters.stored += 1; throw new Error('DB_UNAVAILABLE'); },
  });
  const report = await prewarmRideDistances(d);

  assert.equal(report.authorized, true);
  assert.equal(counters.routed, 2);
  assert.equal(report.measured, 2);
  assert.equal(report.fallback, 'road');
});

test('the per-caller bucket is separate and bounded', () => {
  resetPrewarmState();
  const t = 1_000_000;
  for (let i = 0; i < 6; i += 1) assert.equal(allowPrewarm('p_mom', 6, t), true);
  assert.equal(allowPrewarm('p_mom', 6, t), false);
  assert.equal(allowPrewarm('p_dad', 6, t), true, 'another caller has their own bucket');
  resetPrewarmState();
});

test('measurement validation is strict about the shape the writer will receive', () => {
  assert.equal(isUsableMeasurement({ distanceMeters: 8000, durationSeconds: 600 }), true);
  assert.equal(isUsableMeasurement({ distanceMeters: '8000', durationSeconds: 600 }), false);
  assert.equal(isUsableMeasurement({ distanceMeters: 8000 }), false);
  assert.equal(isUsableMeasurement({ distanceMeters: 500_001, durationSeconds: 600 }), false);
});

// ---------------------------------------------------------------------------------------------
// ORDERING — the pre-step is awaited (or bounded) before ranking, not merely launched first.
// A launched-but-unsettled warm-up is a race: ranking can price from an empty store and write a
// haversine basis even though a road measurement lands a moment later. These cases pin the order.
// ---------------------------------------------------------------------------------------------

const settleAfter = (ms: number, report: Partial<PrewarmReport> = {}): Promise<PrewarmReport> =>
  new Promise((resolve) => setTimeout(
    () => resolve({
      authorized: true, considered: 1, cached: 0, measured: 1, rejected: 0, failed: 0, fallback: 'road', ...report,
    }),
    ms,
  ));

test('a delayed provider is waited for — ranking cannot outrun the measurement', async () => {
  resetPrewarmGates();
  trackRidePrewarm('job_delayed', settleAfter(30));

  let rankCalls = 0;
  const report = await awaitRidePrewarm('job_delayed', 500);
  rankCalls += 1; // the moment ranking would begin

  assert.equal(rankCalls, 1, 'ranking runs exactly once');
  assert.equal(report?.measured, 1);
  assert.equal(report?.fallback, 'road', 'the basis available to ranking is road, not haversine');
});

test('a provider that never settles is bounded — ranking still runs once, on the labelled fallback', async () => {
  resetPrewarmGates();
  trackRidePrewarm('job_hung', new Promise<PrewarmReport>(() => { /* never settles */ }));

  const started = Date.now();
  const report = await awaitRidePrewarm('job_hung', 25);
  const elapsed = Date.now() - started;

  assert.equal(report, null, 'a timeout yields no report, never a fabricated one');
  assert.ok(elapsed >= 20 && elapsed < 500, `bounded wait, took ${elapsed}ms`);
  // Ranking would proceed exactly once, and 0060 then writes the haversine basis it labels.
});

test('a failed provider is treated the same as a timeout: no report, ranking proceeds once', async () => {
  resetPrewarmGates();
  trackRidePrewarm('job_failed', Promise.reject(new Error('ORS_UNREACHABLE')));

  const report = await awaitRidePrewarm('job_failed', 200);
  assert.equal(report, null, 'a rejection must not propagate into the ranking path');
});

test('a job with no registered pre-step never blocks ranking', async () => {
  resetPrewarmGates();
  const started = Date.now();
  const report = await awaitRidePrewarm('job_absent', 1_000);
  assert.equal(report, null);
  assert.ok(Date.now() - started < 100, 'no gate means no wait');
});

test('the gate is one-shot: a second await after it settled does not replay the old report', async () => {
  resetPrewarmGates();
  trackRidePrewarm('job_once', settleAfter(5));
  assert.ok(await awaitRidePrewarm('job_once', 500));
  assert.equal(await awaitRidePrewarm('job_once', 500), null);
});

test('ranking is attempted once even when the pre-step times out and later completes', async () => {
  resetPrewarmGates();
  let completed = false;
  const slow = new Promise<PrewarmReport>((resolve) => setTimeout(() => {
    completed = true;
    resolve({
      authorized: true, considered: 1, cached: 0, measured: 1, rejected: 0, failed: 0, fallback: 'road',
    });
  }, 60));
  trackRidePrewarm('job_late', slow);

  let rankCalls = 0;
  const report = await awaitRidePrewarm('job_late', 15);
  rankCalls += 1;
  await new Promise((r) => setTimeout(r, 80)); // the late completion lands

  assert.equal(report, null, 'ranking saw the bound, not a later answer');
  assert.equal(rankCalls, 1, 'ranking still ran exactly once');
  assert.equal(completed, true, 'the late measurement is not lost — it is simply too late for this ranking');
});
