/**
 * Tests for Rosina's village-map answers. The backend (Bentley's routing proxy + authorized
 * places) is represented by fixture responses; every assertion checks that Rosina relays those
 * numbers EXACTLY, labels them correctly, attaches a Show-on-map action, and refuses uniformly
 * for a limited persona (no existence oracle). Run with: npm run test:rosina
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  routeAnswer, nearestAnswer, rideAnswer, dayAnswer, pickupProposalFromRoute,
  type RouteEstimate, type NearestResult, type RideEstimate, type DayPlan, type MapRefusal,
} from './villageMap';

const route: RouteEstimate = {
  fromPlaceId: 'place_loretta_home', fromName: "Loretta's home",
  toPlaceId: 'place_lincoln', toName: 'Lincoln Elementary',
  mode: 'DRIVE', distanceMeters: 4873, etaSeconds: 612,
};

test('route answer relays the proxy distance + ETA exactly, labeled estimated-not-live', () => {
  const a = routeAnswer(route);
  // numbers match the routing proxy's response byte-for-byte
  assert.deepEqual(a.numbers, { distanceMeters: 4873, etaSeconds: 612 });
  assert.match(a.reply, /estimated, not live traffic/);
  assert.match(a.reply, /by car/);
  assert.deepEqual(a.action, { id: 'show-on-map', args: { id: 'place_lincoln', mode: 'DRIVE' } });
});

test('a not-shared route refuses uniformly, with no map action and no numbers', () => {
  const notShared = routeAnswer({ refused: true, reason: 'NOT_SHARED' });
  const unauthorized = routeAnswer({ refused: true, reason: 'UNAUTHORIZED' });
  // no existence oracle: the two reasons produce the same answer
  assert.equal(notShared.reply, unauthorized.reply);
  assert.equal(notShared.action, undefined);
  assert.equal(notShared.numbers, null);
});

test('nearest answer is from authorized places only and says so; ranking relayed exactly', () => {
  const nearest: NearestResult = {
    toPlaceId: 'place_lincoln', toName: 'Lincoln Elementary', mode: 'DRIVE',
    ranked: [
      { personId: 'p_gma', personName: 'Loretta', fromPlaceId: 'place_loretta_home', fromName: "Loretta's home", fromKind: 'HOME', distanceMeters: 4873, etaSeconds: 612 },
      { personId: 'p_priya', personName: 'Priya', fromPlaceId: 'place_area_south', fromName: 'South side', fromKind: 'AREA', distanceMeters: 8200, etaSeconds: 980 },
    ],
  };
  const a = nearestAnswer(nearest);
  assert.deepEqual(a.numbers, nearest.ranked);
  assert.match(a.reply, /Closest to Lincoln Elementary is Loretta/);
  assert.match(a.reply, /home, area and event places shared with you — not anyone's live location/);
  assert.deepEqual(a.action, { id: 'show-on-map', args: { id: 'place_lincoln', mode: 'DRIVE' } });
});

test('nearest refuses uniformly for a limited persona', () => {
  assert.equal(nearestAnswer({ refused: true, reason: 'NOT_SHARED' }).reply, nearestAnswer({ refused: true, reason: 'UNAUTHORIZED' }).reply);
});

test('ride answer is the stored road-distance estimate vs the cap, never a provider quote', () => {
  const ride: RideEstimate = { fromPlaceId: 'place_loretta_home', toPlaceId: 'place_lincoln', roadDistanceMeters: 4873, estimateUsd: 7.25, capUsd: 12, withinCap: true, basis: 'road distance at the household rate' };
  const a = rideAnswer(ride);
  assert.deepEqual(a.numbers, { roadDistanceMeters: 4873, estimateUsd: 7.25, capUsd: 12, withinCap: true });
  assert.match(a.reply, /\$7\.25/);
  assert.match(a.reply, /under your household cap of \$12\.00/);
  assert.match(a.reply, /not a quote from any ride provider/);
});

test('ride answer states when the estimate is over the cap', () => {
  const ride: RideEstimate = { fromPlaceId: 'a', toPlaceId: 'b', roadDistanceMeters: 20000, estimateUsd: 18.5, capUsd: 12, withinCap: false, basis: 'road distance at the household rate' };
  assert.match(rideAnswer(ride).reply, /over your household cap of \$12\.00/);
});

test('day answer lists that day’s events and places', () => {
  const day: DayPlan = { date: '2026-11-07', items: [
    { eventId: 'e1', title: 'Soccer', placeId: 'place_field', placeName: 'Tigers field', at: '2026-11-07T15:00' },
    { eventId: 'e2', title: 'Dentist', placeId: null, placeName: null, at: '2026-11-07T10:00' },
  ] };
  const a = dayAnswer(day);
  assert.deepEqual(a.numbers, day.items);
  assert.match(a.reply, /Soccer at Tigers field/);
  assert.match(a.reply, /Dentist/);
  assert.deepEqual(a.action, { id: 'show-on-map', args: { id: 'place_field' } });
});

test('a route becomes a pickup proposal only for a parent of the child', () => {
  const parent = pickupProposalFromRoute({ route, isParentOfChild: true, childId: 'p_nora', date: '2026-11-07', window: 'afternoon' });
  assert.deepEqual(parent, { propose: true, action: { id: 'start-pickup', args: { childId: 'p_nora', date: '2026-11-07', window: 'afternoon' } } });

  const notParent = pickupProposalFromRoute({ route, isParentOfChild: false, childId: 'p_nora', date: '2026-11-07', window: 'afternoon' });
  assert.deepEqual(notParent, { propose: false, reason: 'NOT_PARENT' });

  const noRoute = pickupProposalFromRoute({ route: { refused: true, reason: 'NO_ROUTE' } as MapRefusal, isParentOfChild: true, childId: 'p_nora', date: '2026-11-07', window: 'afternoon' });
  assert.deepEqual(noRoute, { propose: false, reason: 'NO_ROUTE' });
});
