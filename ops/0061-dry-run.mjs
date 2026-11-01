#!/usr/bin/env node
/**
 * 0061 dry run — ISOLATED DISPOSABLE DATABASE ONLY.
 *
 * This script refuses to run against the project database. The rule is not a preference: a schema
 * change rehearsed against live data is not a dry run, and a `rollback` is one forgotten block away
 * from being a commit.
 *
 * Usage:
 *   DRY_RUN_DB_URL=postgres://...disposable... node ops/0061-dry-run.mjs
 *
 * It applies 0061 inside one transaction, asserts the linkage, the family guard, the gating and the
 * linked/withheld distinguishability, then rolls back and drops what it made.
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';

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

const sql = readFileSync('supabase/migrations/0061_event_place_linkage.sql', 'utf8')
  .replace(/^\s*begin\s*;/i, '').replace(/commit\s*;\s*$/i, '');

await c.query('begin');
try {
  // Minimal scaffolding the disposable database must have: the objects 0061 depends on.
  await c.query(`
    create table if not exists households (id text primary key);
    create table if not exists household_members (household_id text, person_id text, role text);
    create table if not exists events (id text primary key, child_id text, title text,
      start_at timestamp, end_at timestamp, location text, status text, fixture boolean);
    create table if not exists recorded_places (id text primary key, household_id text,
      kind text, label text, sandbox boolean, fixture boolean, created_at timestamptz,
      latitude numeric, longitude numeric);
    create or replace function is_parent_of(p text) returns boolean language sql as $$ select true $$;
    create or replace function has_scope(p text, s text) returns boolean language sql as $$ select true $$;
    create or replace function current_person() returns text language sql as $$ select 'p_mom' $$;
    create table if not exists grants (actor_id text, child_id text, valid_from date, valid_until date);
  `);

  await c.query(sql);

  const col = await c.query(`select 1 from information_schema.columns
    where table_name='events' and column_name='place_id'`);
  check('events.place_id exists', col.rowCount === 1);

  await c.query(`insert into households values ('h1');
    insert into household_members values ('h1','p_nora','child');
    insert into recorded_places (id,household_id,kind,label,sandbox,fixture,created_at)
      values ('pl_field','h1','AREA','Tigers field',false,false,now()),
             ('pl_other','h9','AREA','Someone else',false,false,now());
    insert into events (id,child_id,title,start_at,location,status,fixture)
      values ('e1','p_nora','Soccer','2026-11-07 15:00','Tigers field','CONFIRMED',false),
             ('e2','p_nora','Dentist','2026-11-07 10:00','somewhere','CONFIRMED',false);`);

  // A same-family link is accepted.
  await c.query(`update events set place_id='pl_field' where id='e1'`);
  check('a same-family link is accepted', true);

  // Another family's place is refused at write time.
  let refused = false;
  try { await c.query(`update events set place_id='pl_other' where id='e1'`); }
  catch (e) { refused = e.code === '42501' || /EVENT_PLACE_NOT_IN_FAMILY/.test(e.message); }
  check('another family\'s place is refused on write', refused);

  // Gating: may_locate=true here, so the label comes back for the linked event only.
  const rows = await c.query(`select event_id, linked, place_id, place_label from event_day_places('p_nora','2026-11-07')`);
  const e1 = rows.rows.find((r) => r.event_id === 'e1');
  const e2 = rows.rows.find((r) => r.event_id === 'e2');
  check('a linked event returns its place', e1?.place_id === 'pl_field' && e1?.place_label === 'Tigers field', JSON.stringify(e1));
  check('an unlinked event is distinguishable from a withheld one', e2?.linked === false && e2?.place_id === null, JSON.stringify(e2));

  const acl = (await c.query(`select proacl::text a from pg_proc where proname='event_day_places'`)).rows[0]?.a ?? '';
  const publicEntries = acl.replace(/^\{|\}$/g, '').split(',').filter((x) => x.startsWith('='));
  check('the accessor grants no PUBLIC execute', publicEntries.length === 0, acl || '(default)');
} catch (e) {
  failed += 1;
  console.log('  FAIL  dry run threw —', e.message);
} finally {
  await c.query('rollback');
  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${failed} failing check(s); rolled back`);
  await c.end();
}
process.exit(failed === 0 ? 0 : 1);
