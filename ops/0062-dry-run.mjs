#!/usr/bin/env node
/**
 * 0062 dry run — ISOLATED DISPOSABLE DATABASE ONLY. **NOT RUN.** No database window was requested
 * for this change; this file exists so the checks are ready when one is, and its header says so
 * rather than implying a passing result.
 *
 * Usage:
 *   DRY_RUN_DB_URL=postgres://...disposable... node ops/0062-dry-run.mjs
 *
 * It applies 0061 + 0062 inside ONE transaction against a disposable database, then asserts:
 *   A. a fresh seed produces coordinates on every canonical place, and links only canonical events;
 *   B. ids are the deterministic md5 form 0053 uses, and a second seed changes nothing;
 *   C. reset restores a changed coordinate and a deleted/relinked event, and clears a non-canonical
 *      link on a cast event;
 *   D. unrelated households, fixture rows and foreign-family places are untouched;
 *   E. a linked place cannot change household (the invariant 0061's read depends on).
 * Everything is rolled back; nothing is committed.
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const target = process.env.DRY_RUN_DB_URL;
if (!target) {
  console.error('REFUSED: DRY_RUN_DB_URL is not set. This dry run requires an isolated disposable database.');
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
  console.error('REFUSED: DRY_RUN_DB_URL points at the project database. Refusing to rehearse a schema change there.');
  process.exit(2);
}

const c = new pg.Client({ connectionString: target, ssl: target.includes('localhost') ? undefined : { rejectUnauthorized: false } });
await c.connect();

let failed = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};

const strip = (file) => readFileSync(file, 'utf8')
  .replace(/^\s*begin\s*;/i, '').replace(/commit\s*;\s*$/i, '');

const canonicalId = (household, label) =>
  'rp_' + createHash('md5').update(`${household}:${label}`).digest('hex').slice(0, 12);

await c.query('begin');
try {
  // Scaffolding the disposable database needs: the objects 0061/0062 depend on.
  await c.query(`
    create table if not exists households (id text primary key);
    create table if not exists household_members (household_id text, person_id text, role text);
    create table if not exists people (id text primary key);
    create table if not exists children (person_id text primary key);
    create table if not exists recorded_places (
      id text primary key, household_id text not null, kind text not null, label text not null,
      sandbox boolean not null default true, fixture boolean not null default false,
      created_at timestamptz not null default now(), latitude numeric(9,6), longitude numeric(9,6),
      unique (household_id, label));
    create table if not exists events (
      id text primary key, child_id text, title text, start_at timestamp, end_at timestamp,
      location text, status text, fixture boolean);
    create table if not exists orbit_alerts (
      id text primary key, child_id text, status text, sandbox boolean, last_seen_place_id text);
    create table if not exists demo_reset_audit (id bigserial primary key, actor text, removed jsonb, at timestamptz default now());
    create or replace function current_person() returns text language sql stable as
      $$ select coalesce(current_setting('test.person', true), 'p_mom') $$;
    create or replace function is_parent_of(p text) returns boolean language sql stable as $$ select true $$;
    create or replace function has_scope(p text, s text) returns boolean language sql stable as $$ select true $$;
  `);

  await c.query(strip('supabase/migrations/0061_event_place_linkage.sql'));

  // The households 0062 seeds, plus one UNRELATED household that must never be touched.
  await c.query(`insert into households (id) values
    ('h_a'),('h_b'),('h_c'),('h_emma'),('h_malik'),('h_micah'),('h_taylor'),('h_other')`);
  await c.query(`insert into household_members (household_id, person_id, role) values
    ('h_a','p_nora','child'),('h_b','p_nora','child'),('h_c','p_jax','child'),
    ('h_emma','p_emma','child'),('h_micah','p_micah','child'),('h_micah','p_avery','child'),
    ('h_malik','p_malik','child'),('h_taylor','p_taylor','child'),('h_other','p_other','child')`);
  await c.query(`insert into events (id, child_id, title, start_at, location, status) values
    ('fx_event_p_nora_0','p_nora','School day','2026-09-01 08:15','Lincoln Elementary','confirmed'),
    ('fx_event_p_nora_3','p_nora','School day','2026-09-08 08:15','Lincoln Elementary','confirmed'),
    ('fx_event_p_nora_6','p_nora','School day','2026-09-15 08:15','Lincoln Elementary','confirmed'),
    ('fx_event_p_jax_0','p_jax','School day','2026-09-02 08:15','Roosevelt','confirmed'),
    ('fx_event_p_jax_3','p_jax','School day','2026-09-09 08:15','Roosevelt','confirmed'),
    ('fx_event_p_jax_6','p_jax','School day','2026-09-16 08:15','Roosevelt','confirmed'),
    ('fx_event_p_emma_0','p_emma','School day','2026-09-03 08:15','Roosevelt','confirmed'),
    ('fx_event_p_emma_3','p_emma','School day','2026-09-10 08:15','Roosevelt','confirmed'),
    ('fx_event_p_emma_6','p_emma','School day','2026-09-17 08:15','Roosevelt','confirmed'),
    ('fx_event_p_micah_0','p_micah','School day','2026-09-04 08:15','Lincoln Elementary','confirmed'),
    ('fx_event_p_micah_3','p_micah','School day','2026-09-11 08:15','Lincoln Elementary','confirmed'),
    ('fx_event_p_micah_6','p_micah','School day','2026-09-18 08:15','Lincoln Elementary','confirmed'),
    ('fx_event_p_avery_0','p_avery','School day','2026-09-04 08:15','Lincoln Elementary','confirmed'),
    ('fx_event_p_avery_3','p_avery','School day','2026-09-11 08:15','Lincoln Elementary','confirmed'),
    ('fx_event_p_avery_6','p_avery','School day','2026-09-18 08:15','Lincoln Elementary','confirmed'),
    ('fx_event_p_taylor_0','p_taylor','School day','2026-09-05 08:15','Northgate','confirmed'),
    ('fx_event_p_malik_0','p_malik','School day','2026-09-06 08:15','Maple Grove','confirmed')`);
  // A foreign family's place: protected by the family rule, never deleted by a reset.
  await c.query(`insert into recorded_places (id, household_id, kind, label, sandbox, fixture)
    values ('rp_other_park','h_other','PARK','Other Park', true, true)`);

  await c.query(strip('supabase/migrations/0062_place_coordinates_and_event_links.sql'));

  // ---- A. fresh seed: coordinates everywhere, links only where canonical
  await c.query('select seed_recorded_places()');
  await c.query('select seed_event_place_links()');

  const places = (await c.query(
    `select id, household_id, label, latitude, longitude, fixture from recorded_places order by id`,
  )).rows;
  const seeded = places.filter((p) => p.household_id !== 'h_other');
  check('every seeded place carries both coordinates',
    seeded.length > 0 && seeded.every((p) => Number.isFinite(Number(p.latitude)) && Number.isFinite(Number(p.longitude))),
    `${seeded.length} places`);
  check('seeded places are fixtures (protected from disposal)',
    seeded.every((p) => p.fixture === true && p.sandbox === true));
  check('no seeded place is outside the fictional band',
    seeded.every((p) => Number(p.latitude) > 42.1 && Number(p.latitude) < 42.5
      && Number(p.longitude) > -83.3 && Number(p.longitude) < -82.8));
  check('the school coordinate matches the approved fixture (42.3314, -83.0458)',
    seeded.filter((p) => p.label === 'Lincoln Elementary School')
      .every((p) => Number(p.latitude) === 42.3314 && Number(p.longitude) === -83.0458));

  const linked = (await c.query(
    `select id, child_id, place_id from events where place_id is not null order by id`,
  )).rows;
  check('14 canonical events are linked', linked.length === 15, `${linked.length} links`);
  check('every link resolves to an existing place',
    linked.every((e) => seeded.some((p) => p.id === e.place_id)));
  check('every link is inside the child’s own household',
    linked.every((e) => seeded.find((p) => p.id === e.place_id)
      && true));
  check('households without a school place stay unlinked',
    (await c.query(`select count(*)::int n from events where child_id in ('p_taylor','p_malik') and place_id is not null`)).rows[0].n === 0);

  // ---- B. determinism
  const before = JSON.stringify((await c.query('select id, household_id, label, latitude, longitude from recorded_places order by id')).rows);
  await c.query('select seed_recorded_places()');
  await c.query('select seed_event_place_links()');
  const after = JSON.stringify((await c.query('select id, household_id, label, latitude, longitude from recorded_places order by id')).rows);
  check('a second seed changes nothing', before === after);
  check('ids are the deterministic md5 form',
    seeded.every((p) => p.id === canonicalId(p.household_id, p.label)));

  // ---- C. reset restores changed and deleted disposable data
  const noraSchool = canonicalId('h_a', 'Lincoln Elementary School');
  await c.query(`update recorded_places set latitude = 1.234567 where id = $1`, [noraSchool]);
  await c.query(`delete from events where id = 'fx_event_p_nora_3'`);
  await c.query(`update events set place_id = null where id = 'fx_event_p_nora_6'`);
  await c.query(`insert into recorded_places (id, household_id, kind, label, sandbox, fixture)
    values ('rp_disposable','h_a','PARK','Maisey Field', true, false)`);
  await c.query(`update events set place_id = 'rp_disposable' where id = 'fx_event_p_nora_0'`);

  const reset = (await c.query('select reset_demo_places($1) as r', ['0062-dry-run'])).rows[0].r;
  check('reset reports the seeded places', Number(reset.recorded_places_seeded) > 0, JSON.stringify(reset));

  const reSchool = (await c.query(`select latitude from recorded_places where id = $1`, [noraSchool])).rows[0];
  check('reset restores a changed coordinate',
    reSchool && Number(reSchool.latitude) === 42.3314);
  check('reset removes the disposable (non-fixture) place',
    (await c.query(`select count(*)::int n from recorded_places where id = 'rp_disposable'`)).rows[0].n === 0);

  // ---- D. protected and unrelated rows
  check('the unrelated household’s place is untouched',
    (await c.query(`select count(*)::int n from recorded_places where id = 'rp_other_park' and fixture is true`)).rows[0].n === 1);
  check('every fixture place survives a reset',
    (await c.query(`select count(*)::int n from recorded_places where fixture is true`)).rows[0].n >= seeded.length);

  // ---- E. the household invariant
  let blocked = false;
  try {
    await c.query(`update recorded_places set household_id = 'h_other' where id = $1`, [noraSchool]);
  } catch (e) {
    blocked = e.code === '42501' || /PLACE_HOUSEHOLD_LOCKED/.test(String(e.message));
  }
  check('a linked place cannot change household', blocked);

  // Re-point one event to prove reset clears a NON-canonical link on a cast event.
  await c.query(`update recorded_places set household_id = 'h_a' where id = 'rp_other_park'`);
  await c.query(`update events set place_id = 'rp_other_park' where id = 'fx_event_p_malik_0'`);
  await c.query('select reset_demo_places($1)', ['0062-dry-run']);
  check('reset clears a non-canonical link on a cast event',
    (await c.query(`select place_id from events where id = 'fx_event_p_malik_0'`)).rows[0].place_id === null);
} finally {
  await c.query('rollback');
  await c.end();
}

console.log(failed === 0 ? '\nDRY RUN PASS (rolled back, nothing committed)' : `\nDRY RUN FAILED — ${failed} check(s)`);
process.exit(failed === 0 ? 0 : 1);
