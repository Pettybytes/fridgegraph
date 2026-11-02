/**
 * villageWorld contract — static, CI-runnable, no database.
 *
 * The behavioural proof is `ops/village-world-proof.mjs` (real resolver, rehearsal stack). This file
 * guards the decisions that must not regress between runs: one gate, no private home coordinates,
 * coordinates that are withheld *without* hiding the place, and a person reference that cannot smuggle
 * contacts or capabilities.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const subgraph = readFileSync('src/subgraphs/village.ts', 'utf8');
const schema = readFileSync('schema/village.graphql', 'utf8');
const migration = readFileSync('supabase/migrations/0075_village_places_for_child.sql', 'utf8');

test('the world type exists in BOTH the subgraph typeDefs and the composition schema', () => {
  for (const source of [subgraph, schema]) {
    assert.match(source, /type VillageWorld \{/);
    assert.match(source, /people: \[VillagePerson!\]!/);
    assert.match(source, /places: \[VillagePlace!\]!/);
    assert.match(source, /events: \[VillageDayEvent!\]!/);
  }
});

test('the WHOLE world is gated by schedule.read on the requested child', () => {
  const body = subgraph.slice(subgraph.indexOf('villageWorld: async'));
  const head = body.slice(0, body.indexOf('const day ='));
  assert.match(head, /requireCaller\(ctx\)/);
  assert.match(head, /await authorizeChild\(ctx, childId, SCOPE\.schedule\)/);
});

test('NO raw addresses: the resolver never reads `locations`', () => {
  const body = subgraph.slice(subgraph.indexOf('villageWorld: async'), subgraph.indexOf('person: async'));
  assert.ok(!body.includes("from('locations')"), 'locations holds private home coordinates and feeds ride pricing');
  assert.ok(!body.includes("owner_type"), 'no owner_type branch may be reintroduced');
  assert.match(body, /village_places_for_child/);
});

test('the place read is the curated catalog only, and homes are excluded by construction', () => {
  assert.match(migration, /from recorded_places rp/);
  assert.ok(!/from\s+(public\.)?locations\b|join\s+(public\.)?locations\b/i.test(migration), '0075 must not READ locations');
  assert.match(migration, /revoke all on function village_places_for_child\(text\) from public, anon/);
  assert.match(migration, /grant execute on function village_places_for_child\(text\) to authenticated/);
});

test('labels are gated by schedule.read; coordinates by address access, null together', () => {
  assert.match(migration, /is_parent_of\(p_child\) or public\.has_scope\(p_child, 'schedule\.read'\)/);
  assert.match(migration, /is_parent_of\(p_child\) or public\.has_scope\(p_child, 'address\.read'\)/);
  assert.match(migration, /case when gate\.may_locate then rp\.latitude end/);
  assert.match(migration, /when not gate\.may_locate then 'withheld'/);
  assert.match(migration, /when rp\.latitude is null or rp\.longitude is null then 'absent'/);
});

test('a coordinate refusal keeps the place: withheld maps to WITHHELD, never to a dropped row', () => {
  const body = subgraph.slice(subgraph.indexOf('villageWorld: async'));
  const block = body.slice(body.indexOf('const placeRows'), body.indexOf('// The selected day'));
  assert.match(block, /coordinateState:/);
  assert.match(block, /'WITHHELD'/);
  assert.ok(!/if \(error\) continue/.test(block), 'a refusal must not be silently swallowed');
});

test('people are a narrow ref: no contacts, grants or capabilities', () => {
  assert.match(schema, /person: VillagePersonRef!/);
  assert.match(schema, /type VillagePersonRef \{\s*id: ID!\s*displayName: String!\s*\}/);
  const ref = schema.slice(schema.indexOf('type VillagePersonRef'), schema.indexOf('type VillagePlace'));
  for (const forbidden of ['contactMethods', 'capabilities', 'grants', 'birthDate', 'email', 'phone']) {
    assert.ok(!ref.includes(forbidden), `VillagePersonRef must not expose ${forbidden}`);
  }
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

test('placeState distinguishes unlinked from withheld', () => {
  assert.match(schema, /enum PlaceState \{\s*LINKED\s*UNLINKED\s*WITHHELD\s*\}/);
  const body = subgraph.slice(subgraph.indexOf('villageWorld: async'));
  assert.match(body, /placeState: placeId === null \? 'UNLINKED' : linked \? 'LINKED' : 'WITHHELD'/);
});
