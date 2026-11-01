#!/usr/bin/env node
/**
 * 0063 proof — the paid-ride evaluation, on a DISPOSABLE database.
 *
 * This is the real `_rank_and_advance` (0060) running against a real Postgres, not a mirror of it.
 * It applies 0059, 0060 and 0063 to a throwaway database, seeds the two `locations` rows the ranking
 * actually reads, and asserts the four cases the write gap was hiding:
 *
 *   1. road cost over the cap while haversine is under it — decision, stored amount and basis agree;
 *   2. a provider failure (no stored result) — labelled haversine basis and the matching decision;
 *   3. an authorization failure — the write is refused and the store is unchanged;
 *   4. an ordinary caller cannot inject an arbitrary distance or snapshot.
 *
 * Usage:
 *   PROOF_DB_URL=postgres://postgres:proof@127.0.0.1:55432/postgres node ops/0063-road-pricing-proof.mjs
 *
 * It refuses the project database and drops nothing it did not create.
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';

const target = process.env.PROOF_DB_URL;
if (!target) {
  console.error('REFUSED: PROOF_DB_URL is not set. This proof runs on a disposable database only.');
  process.exit(2);
}
const projectUrl = (() => {
  try {
    const env = readFileSync('.env', 'utf8');
    const line = env.split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='));
    return line ? line.slice('SUPABASE_DB_URL='.length).replace(/["'\s\r]/g, '') : null;
  } catch { return null; }
})();
if (projectUrl && target.replace(/\s/g, '') === projectUrl) {
  console.error('REFUSED: PROOF_DB_URL points at the project database.');
  process.exit(2);
}

const c = new pg.Client({ connectionString: target });
await c.connect();

// Cluster-level roles are created OUTSIDE the run transaction: they are not content to roll back, and
// a rolled-back CREATE ROLE would leave the next run unable to resolve them.
await c.query(`
  do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
  end $$;
`);

// One transaction for the whole run. An expected refusal aborts the transaction it runs in, so every
// negative case is wrapped in a SAVEPOINT and rolled back to it. The final ROLLBACK leaves the
// disposable database exactly as it was found.
await c.query('begin');

/** Run a statement expected to be refused, then restore the transaction to a known-good point. */
async function expectFailure(fn) {
  await c.query('savepoint sp_expected');
  let error = null;
  try { await fn(); } catch (e) { error = e; }
  await c.query('rollback to savepoint sp_expected');
  return error;
}

let failed = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};
const body = (file) => readFileSync(file, 'utf8')
  .replace(/^\s*begin\s*;/i, '').replace(/commit\s*;\s*$/i, '');

const SCHOOL = { lat: 42.3314, lng: -83.0458 };
/** ~5.0 mi north of the school: under the $10 cap on a straight line. */
const HOME = { lat: 42.4039, lng: -83.0458 };
/** 8.0 mi on the road: $11.20, over the cap. */
const ROAD_METERS = 8 * 1609.344;

await c.query('drop schema if exists public cascade; create schema public;');
await c.query('grant usage on schema public to anon, authenticated, service_role');

await c.query(`
  create table people (id text primary key);
  create table households (id text primary key);
  create table household_members (household_id text, person_id text, role text);
  create table children (person_id text primary key);
  create table capabilities (person_id text, name text);
  create table vehicles (id text primary key, owner_id text);
  create table household_policies (household_id text, rule text, value text);
  create table grants (
    id text primary key, actor_id text, child_id text, scopes text[],
    valid_from date, valid_until date);
  create table locations (
    id text primary key, owner_type text, owner_id text, label text,
    lat double precision, lng double precision, source text,
    captured_at timestamptz, sandbox boolean default true);
  create table coordination_jobs (
    id text primary key, idempotency_key text, type text, child_id text, status text,
    version int, request_version int, as_of date, created_at timestamptz default now(),
    discovery_timeout_seconds int default 60, over_limit_candidate_id text, failure_reason text);
  create table candidate_evaluations (
    id text primary key default gen_random_uuid()::text, job_id text, candidate_id text,
    reason_code text, available boolean, decline_reason text, accepted_via text,
    late_reply boolean, distance_miles numeric, estimated_ride_cost_usd numeric,
    cost_basis text, location_provenance text, cost_calculated_at timestamptz,
    updated_at timestamptz default now());
  create table recorded_places (
    id text primary key, household_id text, kind text, label text,
    latitude numeric, longitude numeric, sandbox boolean default true,
    fixture boolean default false, created_at timestamptz default now());

  create or replace function current_person() returns text language sql stable as
    $$ select nullif(current_setting('test.person', true), '') $$;

  create or replace function is_parent_of(p_child text) returns boolean language sql stable as $$
    select exists (
      select 1 from household_members hm
       where hm.person_id = p_child and hm.role = 'child'
         and hm.household_id in (
           select m.household_id from household_members m
            where m.person_id = current_person() and m.role in ('parent','guardian')))
  $$;

  create or replace function has_scope(p_child text, p_scope text) returns boolean language sql stable as $$
    select exists (
      select 1 from grants g
       where g.actor_id = current_person() and g.child_id = p_child
         and p_scope = any(g.scopes)
         and (g.valid_from is null or current_date >= g.valid_from)
         and (g.valid_until is null or current_date <= g.valid_until))
  $$;

  create or replace function haversine_miles(lat1 double precision, lng1 double precision,
                                             lat2 double precision, lng2 double precision)
  returns numeric language sql immutable set search_path = pg_catalog as $$
    select round((2 * 3958.8 * asin(sqrt(
             power(sin(radians(lat2 - lat1) / 2), 2)
           + cos(radians(lat1)) * cos(radians(lat2))
             * power(sin(radians(lng2 - lng1) / 2), 2)
           )))::numeric, 2)
  $$;

  create or replace function estimate_ride_cost_usd(miles numeric)
  returns numeric language sql immutable set search_path = pg_catalog as $$
    select round(miles * 1.40, 2)
  $$;
`);

await c.query(body('supabase/migrations/0059_road_distance_ride_cost.sql'));
await c.query(body('supabase/migrations/0060_rank_uses_road_distance.sql'));
await c.query(body('supabase/migrations/0063_authorized_road_result_store.sql'));
await c.query(body('supabase/migrations/0064_ride_miles_double_precision.sql'));

// ---- fixtures: the two rows 0060 reads, and one household cap
await c.query(`
  insert into people values ('p_nora'),('p_mom'),('p_gma'),('p_stranger');
  insert into households values ('h_a');
  insert into household_members values
    ('h_a','p_mom','parent'),('h_a','p_nora','child');
  insert into children values ('p_nora');
  insert into household_policies values ('h_a','ride_cost_cap_usd','10');
`);
await c.query(`
  insert into locations (id, owner_type, owner_id, label, lat, lng, source) values
    ('loc_school','CHILD','p_nora','school',$1,$2,'VERIFIED'),
    ('loc_gma','PERSON','p_gma',null,$3,$4,'ESTIMATED')
`,[SCHOOL.lat, SCHOOL.lng, HOME.lat, HOME.lng]);

const haversine = Number((await c.query(
  `select haversine_miles($1,$2,$3,$4) as m`,[SCHOOL.lat, SCHOOL.lng, HOME.lat, HOME.lng])).rows[0].m);
const haversineCost = Number((await c.query(
  `select estimate_ride_cost_usd($1) as c`,[haversine])).rows[0].c);
check('premise: the straight-line cost is UNDER the cap', haversineCost < 10,
  `haversine ${haversine} mi -> $${haversineCost}`);

const newJob = async (id) => {
  await c.query(`insert into coordination_jobs
    (id, idempotency_key, type, child_id, status, version, request_version, as_of, created_at)
    values ($1,$1,'PICKUP','p_nora','discovering',1,1,current_date, now() - interval '2 minutes')`, [id]);
  await c.query(`insert into candidate_evaluations (job_id, candidate_id, reason_code, available)
    values ($1,'p_gma','AVAILABLE_NO_TRANSPORT',false)`, [id]);
};

const evalRow = async (job) => (await c.query(
  `select candidate_id, reason_code, distance_miles, estimated_ride_cost_usd, cost_basis
     from candidate_evaluations where job_id=$1`,[job])).rows[0];
const jobRow = async (job) => (await c.query(
  `select status, failure_reason, over_limit_candidate_id from coordination_jobs where id=$1`,[job])).rows[0];

// ---------------------------------------------------------------- 1. road over the cap
// Production order: request_pickup creates the job + candidate set, THEN the pre-step measures
// and stores, THEN a reply triggers ranking. The proof follows the same order — a store before the
// candidate exists is correctly refused (see case 4).
await newJob('j_road');
await c.query(`select set_config('test.person','p_mom',false)`);

// ASYMMETRIC ON PURPOSE. Two rows exist for the same two points, in opposite directions and with
// different distances. The documented leg is candidate → pickup, so only the 8.00 mi row may be
// priced; 12.00 mi is the same trip measured backwards and must not be used.
const REVERSE_METERS = 12 * 1609.344;
const wRev = await c.query(
  `select public.store_route_result_authorized('p_nora','driving-car','loc_school','loc_gma',$1,$2,$3,$4,$5,600) as ok`,
  [SCHOOL.lat, SCHOOL.lng, HOME.lat, HOME.lng, REVERSE_METERS]);
const w1 = await c.query(
  `select public.store_route_result_authorized('p_nora','driving-car','loc_gma','loc_school',$1,$2,$3,$4,$5,600) as ok`,
  [HOME.lat, HOME.lng, SCHOOL.lat, SCHOOL.lng, ROAD_METERS]);
check('the authorized writer stores a real measurement', wRev.rows[0].ok === true && w1.rows[0].ok === true);
const forwardMiles = Number((await c.query(
  `select route_distance_miles($1,$2,$3,$4,'driving-car') as m`,[HOME.lat, HOME.lng, SCHOOL.lat, SCHOOL.lng])).rows[0].m);
const backMiles = Number((await c.query(
  `select route_distance_miles($1,$2,$3,$4,'driving-car') as m`,[SCHOOL.lat, SCHOOL.lng, HOME.lat, HOME.lng])).rows[0].m);
check('the store keeps both directions apart', Math.abs(forwardMiles - 8) < 0.01 && Math.abs(backMiles - 12) < 0.01,
  `forward=${forwardMiles} backward=${backMiles}`);
const storedMiles = forwardMiles;

await c.query('select _rank_and_advance($1)', ['j_road']);
const e1 = await evalRow('j_road');
const j1 = await jobRow('j_road');

check('case 1 — the decision is OVER_POLICY', e1.reason_code === 'OVER_POLICY', String(e1.reason_code));
check('case 1 — the stored amount is the ROAD cost ($11.20)',
  Math.abs(Number(e1.estimated_ride_cost_usd) - 11.2) < 0.001, String(e1.estimated_ride_cost_usd));
check('case 1 — the stored miles are the ROAD miles (8.00)',
  Math.abs(Number(e1.distance_miles) - 8) < 0.01, String(e1.distance_miles));
check('case 1 — the DIRECTION is candidate → pickup, not the reversed 12.00 mi row',
  Math.abs(Number(e1.distance_miles) - 8) < 0.01 && Math.abs(Number(e1.distance_miles) - 12) > 0.5,
  String(e1.distance_miles));
check('case 1 — the basis says stored road distance',
  String(e1.cost_basis).includes('stored road distance'), String(e1.cost_basis));
check('case 1 — amount and basis describe each other',
  Math.abs(Number(e1.estimated_ride_cost_usd) - Number((8 * 1.4).toFixed(2))) < 0.001);
check('case 1 — the job is awaiting approval with the flagged alternative',
  j1.status === 'awaiting_approval' && j1.over_limit_candidate_id === 'p_gma', JSON.stringify(j1));

// ---------------------------------------------------------------- 2. provider failure
// No measurement was ever taken. The cap is low enough that the APPROVED haversine fallback is
// itself over it — the only configuration in which the fallback is visible on the row, because a
// within-cap estimate is deliberately never surfaced (0019/0020).
await c.query('delete from place_route_results');
await c.query(`update household_policies set value = '5' where rule = 'ride_cost_cap_usd'`);
await newJob('j_fallback');
await c.query('select _rank_and_advance($1)', ['j_fallback']);
const e2 = await evalRow('j_fallback');
const j2 = await jobRow('j_fallback');

check('case 2 — the basis SAYS haversine', String(e2.cost_basis).includes('haversine'), String(e2.cost_basis));
check('case 2 — the stored amount is the haversine cost',
  Math.abs(Number(e2.estimated_ride_cost_usd) - haversineCost) < 0.001, String(e2.estimated_ride_cost_usd));
check('case 2 — the miles are the haversine miles',
  Math.abs(Number(e2.distance_miles) - haversine) < 0.01, String(e2.distance_miles));
check('case 2 — the decision matches the labelled fallback',
  e2.reason_code === 'OVER_POLICY' && j2.status === 'awaiting_approval' && j2.over_limit_candidate_id === 'p_gma',
  `${e2.reason_code} / ${JSON.stringify(j2)}`);

// 2b — the sanctioned within-cap outcome: no estimate is surfaced at all, so nothing is invented.
await c.query(`update household_policies set value = '10' where rule = 'ride_cost_cap_usd'`);
await newJob('j_within');
await c.query('select _rank_and_advance($1)', ['j_within']);
const e2b = await evalRow('j_within');
const j2b = await jobRow('j_within');
check('case 2b — within the cap no estimate is stored',
  e2b.estimated_ride_cost_usd === null && e2b.cost_basis === null, JSON.stringify(e2b));
check('case 2b — the job fails as no_driver_available',
  j2b.status === 'failed' && j2b.failure_reason === 'no_driver_available', JSON.stringify(j2b));

// ---------------------------------------------------------------- 3. authorization failure
const before = Number((await c.query('select count(*)::int n from place_route_results')).rows[0].n);
await c.query(`select set_config('test.person','p_stranger',false)`);
let refused = null;
await c.query('set role authenticated');
refused = await expectFailure(async () => {
  await c.query(`select public.store_route_result_authorized('p_nora','driving-car','loc_school','loc_gma',$1,$2,$3,$4,$5,600)`,
    [SCHOOL.lat, SCHOOL.lng, HOME.lat, HOME.lng, ROAD_METERS]);
});
await c.query('reset role');
const after = Number((await c.query('select count(*)::int n from place_route_results')).rows[0].n);

check('case 3 — a non-parent is refused (42501)', refused?.code === '42501' || /UNAUTHORIZED/.test(String(refused?.message)),
  refused?.message ?? 'no error raised');
check('case 3 — nothing was written', before === after, `${before} -> ${after}`);

// ---------------------------------------------------------------- 4. no arbitrary injection
await c.query(`select set_config('test.person','p_mom',false)`);

let rawDenied = null;
await c.query('set role authenticated');
rawDenied = await expectFailure(async () => {
  await c.query(`select public.store_route_result('driving-car','x','y',1,1,2,2,1000,60)`);
});
await c.query('reset role');
check('case 4 — the raw writer is not executable by a caller',
  rawDenied?.code === '42501' || /permission denied/i.test(String(rawDenied?.message)),
  rawDenied?.message ?? 'raw writer was reachable');

let invented = null;
await c.query('set role authenticated');
invented = await expectFailure(async () => {
  await c.query(`select public.store_route_result_authorized('p_nora','driving-car',null,null,43.0,-84.0,44.0,-85.0,5000,600)`);
});
await c.query('reset role');
check('case 4 — an invented snapshot is refused',
  invented?.code === '42501' || /SNAPSHOT_NOT_AUTHORIZED/.test(String(invented?.message)),
  invented?.message ?? 'invented snapshot accepted');

let oversize = null;
await c.query('set role authenticated');
oversize = await expectFailure(async () => {
  await c.query(`select public.store_route_result_authorized('p_nora','driving-car','loc_school','loc_gma',$1,$2,$3,$4,999999,600)`,
    [SCHOOL.lat, SCHOOL.lng, HOME.lat, HOME.lng]);
});
await c.query('reset role');
check('case 4 — an out-of-bounds distance is refused',
  /BAD_MEASUREMENT/.test(String(oversize?.message)), oversize?.message ?? 'oversize accepted');

const finalCount = Number((await c.query('select count(*)::int n from place_route_results')).rows[0].n);
check('case 4 — the store still holds only authorized rows', finalCount === 0, `${finalCount} rows`);

await c.query(`select set_config('test.person','p_mom',false)`);
// Everything above was one transaction: undo it, so the disposable database is left untouched.
await c.query('rollback');
await c.end();

console.log(failed === 0 ? '\n0063 PROOF PASS' : `\n0063 PROOF FAILED — ${failed} check(s)`);
process.exit(failed === 0 ? 0 : 1);
