/**
 * Offline checks for the geographic seed (0062). No database, no migration applied.
 *
 * These assertions exist because three things are easy to get wrong and expensive to discover in a
 * window: an id that is not the deterministic md5 form, a link that points at a place outside the
 * child's household, and a reset that deletes a place something still references. SQL behaviour is
 * checked by ops/0062-dry-run.mjs, which is **NOT RUN** until a reserved window.
 *
 * Run offline: node --import tsx --test src/village/placeSeed.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createCastV2 } from '../fixtures-cast-v2';
import { createSeed } from '../fixtures';

const SQL = readFileSync('supabase/migrations/0062_place_coordinates_and_event_links.sql', 'utf8');

const canonicalId = (household: string, label: string) =>
  'rp_' + createHash('md5').update(`${household}:${label}`).digest('hex').slice(0, 12);

type SeedPlace = { household: string; kind: string; label: string; lat: number; lng: number };
type SeedLink = { eventId: string; household: string; label: string };

/** The coordinate block: (household, kind, label, latitude, longitude). */
const places = (): SeedPlace[] => {
  const out: SeedPlace[] = [];
  const re = /\('(h_[a-z]+)',\s*'([A-Z_]+)',\s*'([^']+)',\s*(-?\d+\.\d+),\s*(-?\d+\.\d+)\)/g;
  for (const m of SQL.matchAll(re)) {
    out.push({ household: m[1], kind: m[2], label: m[3], lat: Number(m[4]), lng: Number(m[5]) });
  }
  return out;
};

/** The link block: (event_id, household, label). */
const links = (): SeedLink[] => {
  const out: SeedLink[] = [];
  const re = /\('(fx_event_[a-z0-9_]+)',\s*'(h_[a-z]+)',\s*'([^']+)'\)/g;
  for (const m of SQL.matchAll(re)) {
    out.push({ eventId: m[1], household: m[2], label: m[3] });
  }
  return out;
};

const seedPlaces = places();
const seedLinks = links();

test('the seed covers every canonical place, each with a coordinate', () => {
  assert.equal(seedPlaces.length, 11);
  for (const p of seedPlaces) {
    assert.ok(Number.isFinite(p.lat) && Number.isFinite(p.lng), `no coordinates for ${p.household}/${p.label}`);
    assert.ok(p.lat > 42.1 && p.lat < 42.5, `latitude out of the fictional band: ${p.lat}`);
    assert.ok(p.lng > -83.3 && p.lng < -82.8, `longitude out of the fictional band: ${p.lng}`);
  }
  const unique = new Set(seedPlaces.map((p) => `${p.household}:${p.label}`));
  assert.equal(unique.size, seedPlaces.length, 'a (household, label) pair is seeded twice');
});

test('ids stay the deterministic md5 form 0053 uses — never hard-coded', () => {
  assert.match(SQL, /'rp_' \|\| substr\(md5\(w\.household_id \|\| ':' \|\| w\.label\), 1, 12\)/);
  // No literal place id may appear in the migration: every id is derived, so a re-seed cannot point
  // at a row that does not exist.
  const literalPlaceIds = SQL.match(/'rp_[0-9a-f]{12}'/g) ?? [];
  assert.deepEqual(literalPlaceIds, []);
  assert.equal(canonicalId('h_a', 'Lincoln Elementary School').length, 15);
});

test('the coordinates reused from approved fixtures have not drifted', () => {
  const school = seedPlaces.filter((p) => p.label === 'Lincoln Elementary School');
  assert.ok(school.length >= 1);
  for (const p of school) {
    assert.equal(p.lat, 42.3314, 'Lincoln Elementary must match src/fixtures.ts loc_nora_school');
    assert.equal(p.lng, -83.0458);
  }
  const riverside = seedPlaces.filter((p) => p.label === 'Riverside Park');
  assert.ok(riverside.length === 1);
  assert.equal(riverside[0].lat, 42.337, 'Riverside Park must match the web map fixture');
  assert.equal(riverside[0].lng, -83.049);
});

test('every event link names a seeded (household, label) pair', () => {
  assert.equal(seedLinks.length, 15);
  const seeded = new Set(seedPlaces.map((p) => `${p.household}:${p.label}`));
  for (const l of seedLinks) {
    assert.ok(seeded.has(`${l.household}:${l.label}`), `link points at an unseeded place: ${JSON.stringify(l)}`);
  }
});

test('every linked event exists in the cast, and its child is in that household', () => {
  const cast = createCastV2();
  const events = cast.events;
  // Cast children live in Cast households (h_emma, h_micah, …); v1 fixtures cover h_a/h_b/h_c/h_d.
  const members = [
    ...createSeed().householdMembers.map((m) => ({ personId: m.personId, householdId: m.householdId, role: m.role })),
    ...cast.household_members.map((m) => ({ personId: m.person_id, householdId: m.household_id, role: m.role })),
  ];
  const byId = new Map(events.map((e) => [e.id, e]));

  for (const l of seedLinks) {
    const event = byId.get(l.eventId);
    assert.ok(event, `mapped event does not exist in the cast: ${l.eventId}`);
    const childHouseholds = members
      .filter((m) => m.personId === event.child_id && m.role === 'child')
      .map((m) => m.householdId);
    assert.ok(
      childHouseholds.includes(l.household),
      `${l.eventId} (${event.child_id}) is linked to ${l.household}, which is not one of its households`,
    );
  }
});

test('households with no school place stay unlinked — nothing is invented to fill the gap', () => {
  const schoolHouseholds = new Set(
    seedPlaces.filter((p) => p.kind === 'SCHOOL_PICKUP').map((p) => p.household),
  );
  for (const l of seedLinks) {
    assert.ok(schoolHouseholds.has(l.household), `${l.household} has no SCHOOL_PICKUP place but is linked`);
  }
  // h_taylor has only a practice field, h_malik only a park: no school link for either.
  assert.equal(seedLinks.some((l) => l.household === 'h_taylor'), false);
  assert.equal(seedLinks.some((l) => l.household === 'h_malik'), false);
});

test('the mapping never reads a title or a free-text location', () => {
  const linkFn = SQL.slice(SQL.indexOf('create or replace function public.seed_event_place_links'));
  const body = linkFn.slice(0, linkFn.indexOf('revoke all on function public.seed_event_place_links'));
  assert.equal(/location/i.test(body), false, 'the link function must not read events.location');
  assert.equal(/title/i.test(body), false, 'the link function must not read events.title');
});

test('reset detaches FK dependents BEFORE deleting a place, and only deletes non-fixture rows', () => {
  const resetFn = SQL.slice(SQL.indexOf('create or replace function public.reset_demo_places'));
  const detachEvents = resetFn.indexOf('update public.events');
  const removePlaces = resetFn.indexOf('delete from public.recorded_places');
  assert.ok(detachEvents > -1 && removePlaces > -1);
  assert.ok(detachEvents < removePlaces, 'events.place_id must be detached before the delete');
  assert.match(resetFn, /update orbit_alerts[\s\S]*last_seen_place_id = null/);
  assert.match(resetFn, /delete from public\.recorded_places where sandbox is true and fixture is false/);
  // The reset restores through the seed helpers rather than re-implementing the list.
  assert.match(resetFn, /v_seeded := public\.seed_recorded_places\(\)/);
  assert.match(resetFn, /v_linked := public\.seed_event_place_links\(\)/);
});

test('0062 depends on 0061 and refuses to run without it', () => {
  assert.match(SQL, /0062 requires 0061 \(events\.place_id\) — apply 0061 first/);
});

test('a linked place cannot change household', () => {
  assert.match(SQL, /create or replace function public\._place_household_guard/);
  assert.match(SQL, /raise exception 'PLACE_HOUSEHOLD_LOCKED' using errcode = '42501'/);
  assert.match(SQL, /before update of household_id on public\.recorded_places/);
});

test('withheld is documented as reserved, not as a passing live case', () => {
  assert.match(SQL, /`withheld` is RESERVED \/ DEFENSIVE/);
  assert.match(SQL, /no legitimate producer of a withheld link today/);
});
