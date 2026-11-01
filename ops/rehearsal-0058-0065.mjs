#!/usr/bin/env node
/**
 * Rehearsal / apply preparation for 0058 → 0065 (+ conditional teacher migrations).
 *
 * WHAT THIS IS
 * One ordered, disposable-database rehearsal of the whole village map/road slice, so the window does
 * not discover dependency problems. It applies each migration in dependency order, asserts the things
 * that must be true after each, and then hands the behavioural checks to the scripts that already own
 * them (0061 day read, 0062 seed/reset, 0063 road pricing). Everything runs inside ONE transaction and
 * is rolled back; the disposable database is left as it was found.
 *
 * WHAT IT CANNOT DO
 * A stock Postgres is not Supabase. Roles are created by hand, `auth.uid()` is absent (a session GUC
 * stands in for `current_person()`), there is no PostgREST, no JWT verification and no RLS policies on
 * the scaffold tables. So this proves ORDER, SIGNATURES, ACLS and SQL behaviour — not RLS under real
 * claims. The reserved window on the project database is still the authority, and the steps that only
 * exist there (seed-auth-users, reseed, the GraphQL recompose, Rosina) are PRINTED as window steps,
 * never faked.
 *
 * Usage:
 *   REHEARSAL_DB_URL=postgres://…disposable… node ops/rehearsal-0058-0065.mjs
 */
import pg from 'pg';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const target = process.env.REHEARSAL_DB_URL;
if (!target) {
  console.error('REFUSED: REHEARSAL_DB_URL is not set. This rehearsal runs on a disposable database only.');
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
  console.error('REFUSED: REHEARSAL_DB_URL points at the project database.');
  process.exit(2);
}

let failed = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};
const body = (file) => readFileSync(file, 'utf8')
  .replace(/^\s*begin\s*;/i, '').replace(/commit\s*;\s*$/i, '');

// ---------------------------------------------------------------------------------------------
// The plan. Dependency order is explicit; a missing file is a hard failure, not a skipped step.
// ---------------------------------------------------------------------------------------------
const CORE = [
  '0058_place_route_geometry.sql',
  '0059_road_distance_ride_cost.sql',
  '0060_rank_uses_road_distance.sql',
  '0061_event_place_linkage.sql',
  '0062_place_coordinates_and_event_links.sql',
  '0063_authorized_road_result_store.sql',
  '0064_ride_miles_double_precision.sql',
  '0065_price_leg_in_pickup_direction.sql',
];

/**
 * TEACHER MIGRATIONS — resolved by FILE PRESENCE at one recorded origin/main SHA.
 *
 * Ancestry was the wrong test: a squash merge makes `feat/teacher-persona` a non-ancestor of main
 * while its files are on main, so an ancestry check reports "not merged" for work that IS there.
 * The record below is a main commit; the files are listed from that commit's tree and read from it
 * with `git show`, so the runner does not depend on the working tree carrying them.
 *
 * FILE PRESENCE IS NOT APPLIED STATE. A file in the tree says only that the migration exists. What
 * the database has is probed separately, per migration, after the apply step.
 */
const TEACHER_SOURCE_SHA = 'db7dc5739c87276d6810fea42021e0b6e172f859';
const TEACHER_FILE = /(^|\/)007[0-9]_.*\.sql$/;

const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

function teacherMigrations() {
  const sha = process.env.REHEARSAL_TEACHER_SHA ?? TEACHER_SOURCE_SHA;

  try {
    git(['cat-file', '-e', `${sha}^{commit}`]);
  } catch {
    return { sha, files: [], reason: `recorded teacher source ${sha.slice(0, 7)} is not present locally (fetch it)` };
  }

  // REVALIDATE BEFORE EXECUTION: is the recorded commit still what main is? If main has moved, say so
  // and require a deliberate refresh rather than silently rehearsing a different tree.
  let mainSha = null;
  try { mainSha = git(['rev-parse', 'origin/main']); } catch { /* offline: keep the record */ }
  const drift = mainSha && mainSha !== sha ? `origin/main is now ${mainSha.slice(0, 7)}` : null;

  const paths = git(['ls-tree', '-r', '--name-only', sha, 'supabase/migrations/'])
    .split('\n')
    .filter((f) => TEACHER_FILE.test(f))
    .sort();

  // Read the SQL from the recorded commit, not from disk: this checkout may be behind main.
  const files = paths.map((path) => ({ path, sql: git(['show', `${sha}:${path}`]) }));
  return { sha, mainSha, drift, files, reason: `${files.length} file(s) at ${sha.slice(0, 7)}` };
}

const teacher = teacherMigrations();
const plan = [...CORE, ...teacher.files.map((f) => f.path.replace(/^supabase\/migrations\//, ''))];
const planSql = new Map(teacher.files.map((f) => [f.path.replace(/^supabase\/migrations\//, ''), f.sql]));

console.log('REHEARSAL PLAN (dependency order)');
for (const f of plan) console.log(`  - ${f}`);
if (!teacher.files.length) console.log(`  - teacher 0070-range: NONE — ${teacher.reason}`);
else {
  console.log(`  - teacher 0070-range: ${teacher.files.length} file(s), source ${teacher.sha.slice(0, 7)}`);
  for (const f of teacher.files) console.log(`      ${f.path}`);
  if (teacher.drift) console.log(`      NOTE: ${teacher.drift} — refresh TEACHER_SOURCE_SHA deliberately before applying`);
}

const missing = plan.filter((f) => !existsSync(`supabase/migrations/${f}`) && !planSql.has(f));
if (missing.length) {
  console.error(`\nMISSING migration file(s): ${missing.join(', ')}`);
  process.exit(1);
}

const c = new pg.Client({ connectionString: target });
await c.connect();

// Roles live outside the run transaction: a rolled-back CREATE ROLE would strand the next run.
await c.query(`
  do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
  end $$;
`);

await c.query('begin');

try {
  // ---- scaffolding the slice reads. Shaped like the real columns, not like the functions' wishes.
  await c.query(`
    create table people (id text primary key);
    create table households (id text primary key);
    create table household_members (household_id text, person_id text, role text);
    create table children (person_id text primary key);
    create table capabilities (person_id text, name text);
    create table vehicles (id text primary key, owner_id text);
    create table household_policies (household_id text, rule text, value text);
    create table grants (id text primary key, actor_id text, child_id text, scopes text[],
                         valid_from date, valid_until date);
    create table recorded_place_catalog (label text primary key);
    create table recorded_places (
      id text primary key, household_id text not null, kind text not null, label text not null,
      sandbox boolean not null default true, fixture boolean not null default false,
      created_at timestamptz not null default now(), latitude numeric(9,6), longitude numeric(9,6),
      unique (household_id, label));
    create table events (
      id text primary key, child_id text, title text, start_at timestamp, end_at timestamp,
      location text, status text, fixture boolean);
    create table locations (
      id text primary key, owner_type text, owner_id text, label text,
      lat double precision, lng double precision, source text, captured_at timestamptz,
      sandbox boolean default true);
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
    create table orbit_alerts (id text primary key, child_id text, status text, sandbox boolean,
                               last_seen_place_id text);
    create table school_reports (id text primary key default gen_random_uuid()::text,
                                 child_id text, body text, created_at timestamptz default now());
    create table demo_reset_audit (id bigserial primary key, actor text, removed jsonb,
                                   at timestamptz default now());

    create or replace function current_person() returns text language sql stable as
      $$ select nullif(current_setting('test.person', true), '') $$;
    create or replace function is_parent_of(p_child text) returns boolean language sql stable as $$
      select exists (
        select 1 from household_members hm
         where hm.person_id = p_child and hm.role = 'child'
           and hm.household_id in (select m.household_id from household_members m
                                    where m.person_id = current_person() and m.role in ('parent','guardian')))
    $$;
    create or replace function has_scope(p_child text, p_scope text) returns boolean language sql stable as $$
      select exists (select 1 from grants g
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
               * power(sin(radians(lng2 - lng1) / 2), 2))))::numeric, 2)
    $$;
    create or replace function estimate_ride_cost_usd(miles numeric)
    returns numeric language sql immutable set search_path = pg_catalog as $$ select round(miles * 1.40, 2) $$;
  `);
  await c.query('grant usage on schema public to anon, authenticated, service_role');

  // The seed/reset checks need the households 0062 knows about, and the cast events it links.
  await c.query(`
    insert into recorded_place_catalog (label) values
      ('Lincoln Elementary School'),('Roosevelt Middle School'),('Maple Grove Park'),
      ('Riverside Park'),('Cedar Hill Park'),('Eastside Sports Field'),('Northgate Practice Field');
    insert into households (id) values ('h_a'),('h_b'),('h_c'),('h_emma'),('h_malik'),('h_micah'),('h_taylor');
    insert into household_members (household_id, person_id, role) values
      ('h_a','p_nora','child'),('h_b','p_nora','child'),('h_c','p_jax','child'),
      ('h_emma','p_emma','child'),('h_micah','p_micah','child'),('h_micah','p_avery','child'),
      ('h_malik','p_malik','child'),('h_taylor','p_taylor','child');
  `);
  const seedEvents = ['p_nora','p_jax','p_emma','p_micah','p_avery']
    .flatMap((child) => [0, 3, 6].map((k) => `('fx_event_${child}_${k}','${child}','School day','2026-09-0${k + 1} 08:15','confirmed')`));
  await c.query(`insert into events (id, child_id, title, start_at, status) values ${seedEvents.join(',')}`);

  // ---- apply, in order, asserting each step landed
  for (const file of plan) {
    try {
      await c.query(planSql.get(file) ?? body(`supabase/migrations/${file}`));
      check(`applied ${file}`, true);
    } catch (e) {
      check(`applied ${file}`, false, e.message);
      throw e;
    }
  }

  // ---- 0058 / 0061 / 0062 / 0063 / 0064 signatures
  const fns = ['place_route_geometry_for', 'event_day_places', 'seed_recorded_places',
    'seed_event_place_links', 'reset_demo_places', 'store_route_result_authorized',
    'route_distance_miles', 'ride_miles_for'];
  const present = (await c.query(
    `select proname, count(*)::int n from pg_proc where proname = any($1) group by proname`, [fns])).rows;
  for (const name of fns) {
    const row = present.find((r) => r.proname === name);
    check(`function present: ${name}`, Boolean(row) && row.n >= 1, row ? `${row.n} signature(s)` : 'missing');
  }

  // 0064's reason for existing: the double-precision call must resolve.
  const dp = await c.query(
    `select * from public.ride_miles_for(42.3314::double precision, -83.0458::double precision,
                                         42.4039::double precision, -83.0458::double precision)`);
  check('0064 — ride_miles_for resolves for double precision coordinates', dp.rows.length === 1,
    dp.rows[0] ? String(dp.rows[0].miles) : 'no row');

  // 0065's reason for existing: the paid branch prices candidate → pickup.
  const def0065 = (await c.query(
    `select pg_get_functiondef(oid) d from pg_proc where proname = '_rank_and_advance'`)).rows[0].d;
  check('0065 — the paid branch prices candidate → pickup',
    def0065.includes('ride_miles_for(l.lat, l.lng, v_school.lat, v_school.lng)'));
  check('0065 — the reversed order is gone',
    def0065.includes('ride_miles_for(v_school.lat, v_school.lng, l.lat, l.lng)') === false);

  // 0063's gate: the raw writer is not executable by a caller.
  const acl = (await c.query(
    `select proacl::text a from pg_proc where proname = 'store_route_result'
      and pronargs = 9 limit 1`)).rows[0]?.a ?? '';
  check('0063 — the raw writer no longer grants authenticated',
    acl.includes('authenticated=X') === false, acl || 'no ACL');

  // 0062's seed: coordinates and links, and a second seed that changes nothing.
  await c.query('select seed_recorded_places()');
  await c.query('select seed_event_place_links()');
  const seeded = (await c.query(
    `select count(*)::int n from recorded_places where latitude is not null and longitude is not null`)).rows[0].n;
  check('0062 — every seeded place carries coordinates', seeded === 11, `${seeded} places`);
  const linked = (await c.query(`select count(*)::int n from events where place_id is not null`)).rows[0].n;
  check('0062 — the canonical event links exist', linked === 15, `${linked} links`);

  const before = JSON.stringify((await c.query(
    'select id, latitude, longitude from recorded_places order by id')).rows);
  await c.query('select seed_recorded_places()');
  const after = JSON.stringify((await c.query(
    'select id, latitude, longitude from recorded_places order by id')).rows);
  check('0062 — re-seeding is deterministic', before === after);

  // 0062's reset: a changed coordinate and a disposable place are restored/removed.
  const oneId = (await c.query(`select id from recorded_places order by id limit 1`)).rows[0].id;
  await c.query(`update recorded_places set latitude = 1.5 where id = $1`, [oneId]);
  await c.query(`insert into recorded_places (id, household_id, kind, label, sandbox, fixture)
                 values ('rp_disposable','h_a','PARK','Riverside Park', true, false)`);
  await c.query(`select reset_demo_places('rehearsal')`);
  check('0062 — reset restores the canonical coordinate',
    Number((await c.query(`select latitude from recorded_places where id = $1`, [oneId])).rows[0].latitude) !== 1.5);
  check('0062 — reset removes the disposable place',
    (await c.query(`select count(*)::int n from recorded_places where id = 'rp_disposable'`)).rows[0].n === 0);

  // 0061's three states, on the linked/unlinked rows this scaffold has.
  await c.query(`select set_config('test.person','p_mom',false)`);
  await c.query(`insert into household_members values ('h_a','p_mom','parent')`);
  const states = (await c.query(
    `select state, count(*)::int n from event_day_places('p_nora','2026-09-01') group by state`)).rows;
  check('0061 — a linked event reads as linked',
    states.some((s) => s.state === 'linked'), JSON.stringify(states));

  // ---- TEACHER: file presence is not applied state. Probe the DB for the objects 0070 creates.
  if (teacher.files.length) {
    const policy = await c.query(
      `select 1 from pg_policies where tablename = 'school_reports' and policyname = 'school_reports_insert'`);
    check(`teacher applied — policy school_reports_insert exists (source ${teacher.sha.slice(0, 7)})`,
      policy.rowCount === 1, `${policy.rowCount} policy row(s)`);

    const priv = await c.query(`select has_table_privilege('authenticated','school_reports','INSERT') as ok`);
    check('teacher applied — authenticated may INSERT school_reports', priv.rows[0].ok === true);
  } else {
    console.log('  SKIP  teacher applied-state probes — no teacher migration in the plan');
  }

  // ---- behaviour owned by the focused scripts: run them if the runner was asked to
  const runFocus = process.env.REHEARSAL_RUN_FOCUS === '1';
  console.log(`\nFOCUSED CHECKS: ${runFocus ? 'running' : 'not run (set REHEARSAL_RUN_FOCUS=1)'}`);
  if (runFocus) {
    for (const script of ['ops/0063-road-pricing-proof.mjs']) {
      try {
        execFileSync('node', [script], { env: { ...process.env, PROOF_DB_URL: target }, stdio: 'inherit' });
        check(`focused: ${script}`, true);
      } catch {
        check(`focused: ${script}`, false, 'see its output above');
      }
    }
  }
} finally {
  await c.query('rollback').catch(() => undefined);
  await c.end();
}

// ---------------------------------------------------------------------------------------------
// WINDOW-ONLY STEPS. Printed, never executed here: they need Supabase auth, PostgREST or the running
// stack. A rehearsal that pretends to have done them is worse than one that names them.
// ---------------------------------------------------------------------------------------------
console.log(`
WINDOW-ONLY STEPS (not run here):
  1. apply, in order: ${plan.join(', ')}${teacher.files.length ? `
     teacher files come from ${teacher.sha}` : ''}
  2. seed auth users:      npx tsx scripts/seed-auth-users.ts
  3. reseed:               npm run db:seed   (places + links are seeded by the migration helpers)
  4. SURFACES — do not recompose for REST:
       /api/village/day and /api/village/route are Express routes on 4008. Restart that
       listener; NO supergraph change.
     GraphQL changes only (today: school.reportSchoolDay, 0070): recompose the supergraph
       and restart the router. The village day read is NOT a GraphQL field.
  5. cast checksum:        measure, then update the published checksum deliberately
  6. Rosina:               serve with #86 + #89; confirm ROSINA_PROPOSAL_SIGNING_KEY is SET
                           (presence and length only — never print the value)

  COORDINATION (window plan, from Bryan — no code change implied):
    - #90 (Codex) is offline-ready at 66cc717, CI green, transport behind
      VITE_NOTICE_PLAN_LIVE; stays draft and mock-labelled until this window.
    - give the VERIFIED Rosina serving revision and the TEST SLOT to
      feat/web-graphql-adapter (Codex) and feat/rosina-service (Claude Code).
    - coordinate ONE mounted sample-(a) flow so UI and backend evidence cover the
      SAME request; enable live mode only in the designated test build.
    - record the UI revision separately from the backend revision.
    - samples (b) and (c) remain feat/rosina-service's proofs; canonical
      restoration afterward (live flag off, mock-labelled default restored).
`);

console.log(failed === 0 ? 'REHEARSAL PASS (rolled back)' : `REHEARSAL FAILED — ${failed} check(s)`);
process.exit(failed === 0 ? 0 : 1);
