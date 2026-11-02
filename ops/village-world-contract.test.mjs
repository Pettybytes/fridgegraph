/**
 * villageWorld contract — static, CI-runnable, no database.
 *
 * The behavioural test belongs to a served window (it needs a persona and a Postgres). What can be
 * checked here is the shape the #87 agreement fixed: ONE gate for the world, no money on any world
 * field, and explicit "not derived" nulls rather than guesses that read as facts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const subgraph = readFileSync('src/subgraphs/village.ts', 'utf8');
const schema = readFileSync('schema/village.graphql', 'utf8');

test('the world type exists in BOTH the subgraph typeDefs and the composition schema', () => {
  for (const source of [subgraph, schema]) {
    assert.match(source, /type VillageWorld \{/);
    assert.match(source, /people: \[VillagePerson!\]!/);
    assert.match(source, /places: \[VillagePlace!\]!/);
    assert.match(source, /events: \[VillageDayEvent!\]!/);
  }
});

test('placeState and coordinateState distinguish withheld from not-recorded', () => {
  assert.match(schema, /enum PlaceState \{\s*LINKED\s*UNLINKED\s*WITHHELD\s*\}/);
  assert.match(schema, /enum CoordinateState \{\s*SET\s*WITHHELD\s*NOT_RECORDED\s*\}/);
});

test('the WHOLE world is gated by schedule.read on the requested child', () => {
  const body = subgraph.slice(subgraph.indexOf('villageWorld: async'));
  const head = body.slice(0, body.indexOf('const day ='));
  assert.match(head, /requireCaller\(ctx\)/);
  assert.match(head, /await authorizeChild\(ctx, childId, SCOPE\.schedule\)/);
});

test('no money appears anywhere on a world field', () => {
  const worldTypes = schema.slice(schema.indexOf('type VillageWorld'), schema.indexOf('type Village {'));
  for (const forbidden of ['estimatedRideCostUsd', 'costBasis', 'distanceMiles', 'householdCapUsd', 'paidRidePath']) {
    assert.ok(!worldTypes.includes(forbidden), `world types must not carry ${forbidden}`);
  }
  assert.ok(!subgraph.slice(subgraph.indexOf('villageWorld: async')).includes('estimated_ride_cost_usd'));
});

test('per-person association fields are null-and-documented, never guessed', () => {
  const body = subgraph.slice(subgraph.indexOf('villageWorld: async'));
  const block = body.slice(body.indexOf('relationship: rel?.type'), body.indexOf('// Places:'));
  assert.match(block, /homePlaceId: null/);
  assert.match(block, /areaLabel: null/);
  assert.match(block, /scheduledEventId: null/);
  assert.match(block, /scheduledPlaceId: null/);
  assert.match(block, /Not derived/i);
});

test('a place refusal is skipped, never widened', () => {
  const body = subgraph.slice(subgraph.indexOf('villageWorld: async'));
  const block = body.slice(body.indexOf('for (const placeId of placeIds)'), body.indexOf('// The selected day'));
  assert.match(block, /place_route_geometry_for/);
  assert.match(block, /if \(error\) continue;/);
  assert.match(block, /coordinateState:/);
});
