/**
 * Village routing tests — the ordering claims, not just the happy path.
 *
 * The five cases here exist because each one was a plausible way to leak a route:
 * a cache hit standing in for permission, a refused second place still costing an ORS call, an
 * authorized-but-ungeocoded place silently routing, and a walking request answered from a driving
 * cache entry.
 *
 * Run offline: node --import tsx --test src/village/*.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { routeBetween, resetRouteState, routeCacheSize, RouteUnavailable } from './ors';
import { decideRoute, type PlaceLookup } from './routeRequest';

// Every request here is stubbed, so a placeholder key is not a credential and never leaves the
// process. Without it the key-guard fires first and hides the ordering the tests are about.
process.env.ORS_API_KEY ??= 'test-only-placeholder';

const GRANTED = (id: string, lat: number, lng: number, label = id) =>
  ({ kind: 'row', row: { id, label, state: 'granted', latitude: lat, longitude: lng } }) as PlaceLookup;
const WITHHELD = (id: string) => ({ kind: 'row', row: { id, label: id, state: 'withheld', latitude: null, longitude: null } }) as PlaceLookup;
const ABSENT = (id: string) => ({ kind: 'row', row: { id, label: id, state: 'absent', latitude: null, longitude: null } }) as PlaceLookup;
const NOTFOUND = () => ({ kind: 'notfound' }) as PlaceLookup;

/** An ORS response with a decodable polyline; every call is counted. */
function countingFetch(calls: { n: number; urls: string[] }) {
  return (async (url: string | URL | Request) => {
    calls.n += 1;
    calls.urls.push(String(url));
    return new Response(
      JSON.stringify({ routes: [{ summary: { distance: 1234.4, duration: 300.6 }, geometry: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
}

/** The handler's ordering: decide first, and only route when the decision is ok. */
async function handle(from: PlaceLookup, to: PlaceLookup, deps: { calls: { n: number; urls: string[] }; profile?: 'driving-car' | 'foot-walking' }) {
  const decision = decideRoute(from, to);
  if (!decision.ok) return { routed: false as const, status: decision.status, body: decision.body };
  const route = await routeBetween(deps.profile ?? 'driving-car', 'from', 'to', decision.from, decision.to, countingFetch(deps.calls));
  return { routed: true as const, route };
}

test('first place granted, second withheld → zero cache reads and zero ORS calls', async () => {
  resetRouteState();
  const calls = { n: 0, urls: [] as string[] };
  const out = await handle(GRANTED('a', 42.36, -71.06), WITHHELD('b'), { calls });
  assert.equal(out.routed, false);
  assert.equal(out.status, 403);
  assert.equal(calls.n, 0, 'ORS must not be called');
  assert.equal(routeCacheSize(), 0, 'the cache must not even be consulted into existence');
});

test('an inaccessible place gets 404 and touches neither cache nor ORS', async () => {
  resetRouteState();
  const calls = { n: 0, urls: [] as string[] };
  const out = await handle(GRANTED('a', 42.36, -71.06), NOTFOUND(), { calls });
  assert.equal(out.routed, false);
  assert.equal(out.status, 404);
  assert.equal(calls.n, 0);
  assert.equal(routeCacheSize(), 0);
});

test('authorized but ungeocoded is its own outcome (409), not a refusal and not a route', async () => {
  resetRouteState();
  const calls = { n: 0, urls: [] as string[] };
  const out = await handle(GRANTED('a', 42.36, -71.06), ABSENT('b'), { calls });
  assert.equal(out.routed, false);
  assert.equal(out.status, 409);
  assert.deepEqual(out.body, { error: 'GEOMETRY_UNAVAILABLE', place: 'b' });
  assert.equal(calls.n, 0);
  assert.equal(routeCacheSize(), 0);
});

test('a mislabelled row cannot route without coordinates (fail closed)', async () => {
  resetRouteState();
  const calls = { n: 0, urls: [] as string[] };
  const bogus = { kind: 'row', row: { id: 'b', label: 'b', state: 'granted', latitude: null, longitude: null } } as PlaceLookup;
  const out = await handle(GRANTED('a', 42.36, -71.06), bogus, { calls });
  assert.equal(out.routed, false);
  assert.equal(out.status, 409);
  assert.equal(calls.n, 0);
});

test('an authorized cache hit is served only after the check passes, and a later refusal cannot reuse it', async () => {
  resetRouteState();
  const calls = { n: 0, urls: [] as string[] };
  const first = await handle(GRANTED('a', 42.36, -71.06), GRANTED('b', 42.37, -71.07), { calls });
  assert.equal(first.routed, true);
  assert.equal(calls.n, 1);

  const second = await handle(GRANTED('a', 42.36, -71.06), GRANTED('b', 42.37, -71.07), { calls });
  assert.equal(second.routed, true);
  if (second.routed) assert.equal(second.route.cached, true);
  assert.equal(calls.n, 1, 'the second call is served from cache');

  // Same ids, but the second place is now withheld: the cached entry must not answer it.
  const refused = await handle(GRANTED('a', 42.36, -71.06), WITHHELD('b'), { calls });
  assert.equal(refused.routed, false);
  assert.equal(refused.status, 403);
  assert.equal(calls.n, 1, 'a refusal never costs an ORS call');
});

test('different profiles never share a cache entry', async () => {
  resetRouteState();
  const calls = { n: 0, urls: [] as string[] };
  const drive = await handle(GRANTED('a', 42.36, -71.06), GRANTED('b', 42.37, -71.07), { calls, profile: 'driving-car' });
  const walk = await handle(GRANTED('a', 42.36, -71.06), GRANTED('b', 42.37, -71.07), { calls, profile: 'foot-walking' });
  assert.equal(drive.routed && walk.routed, true);
  assert.equal(calls.n, 2, 'a second profile is a second real request');
  assert.ok(calls.urls[0].includes('/driving-car/'), calls.urls[0]);
  assert.ok(calls.urls[1].includes('/foot-walking/'), calls.urls[1]);
  assert.equal(routeCacheSize(), 2);
});

test('the driving entry is still a hit after the walking request', async () => {
  resetRouteState();
  const calls = { n: 0, urls: [] as string[] };
  await handle(GRANTED('a', 42.36, -71.06), GRANTED('b', 42.37, -71.07), { calls, profile: 'driving-car' });
  await handle(GRANTED('a', 42.36, -71.06), GRANTED('b', 42.37, -71.07), { calls, profile: 'foot-walking' });
  const again = await handle(GRANTED('a', 42.36, -71.06), GRANTED('b', 42.37, -71.07), { calls, profile: 'driving-car' });
  assert.equal(again.routed, true);
  if (again.routed) assert.equal(again.route.cached, true);
  assert.equal(calls.n, 2);
});

test('a missing ORS key is an explicit failure, never a straight-line estimate', async () => {
  resetRouteState();
  const saved = process.env.ORS_API_KEY;
  delete process.env.ORS_API_KEY;
  try {
    await assert.rejects(
      () => routeBetween('driving-car', 'a', 'b', { lat: 42.36, lng: -71.06 }, { lat: 42.37, lng: -71.07 }),
      (e: unknown) => e instanceof RouteUnavailable && e.reason === 'ORS_KEY_MISSING',
    );
  } finally {
    if (saved === undefined) delete process.env.ORS_API_KEY; else process.env.ORS_API_KEY = saved;
  }
});
