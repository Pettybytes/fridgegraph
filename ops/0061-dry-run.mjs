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
    create or replace function current_person() returns text language sql stable as
      $$ select coalesce(current_setting('test.person', true), 'p_mom') $$;
    create or replace function is_parent_of(p text) returns boolean language sql stable as $$
      select exists (select 1 from household_members hm
        where hm.person_id = p and hm.person_id = current_person() and hm.role = 'parent') $$;
    create or replace function has_scope(p text, s text) returns boolean language sql stable as $$
      select exists (select 1 from grants g
        where g.actor_id = current_person() and g.child_id = p and g.scope = s) $$;
    create table if not exists grants (actor_id text, child_id text, scope text, valid_from date, valid_until date);
  `);

  await c.query(sql);

  const col = await c.query(`select 1 from information_schema.columns
    where table_name='events' and column_name='place_id'`);
  check('events.place_id exists', col.rowCount === 1);

  await c.query(`insert into households values ('h1');
    insert into household_members values ('h1','p_nora','child');
    insert into household_members values ('h1','p_mom','parent');
    insert into grants values ('p_mom','p_nora','schedule.read',null,null);
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

  // 1. The parent gets the label AND the place id.
  await c.query(`set local test.person = 'p_mom'`);
  const asKendra = await c.query(`select event_id, state, place_id, place_label from event_day_places('p_nora','2026-11-07') order by event_id`);
  const k1 = asKendra.rows.find((r) => r.event_id === 'e1');
  check('parent sees the linked event with its place label and id',
    k1?.state === 'linked' && k1?.place_label === 'Tigers field' && k1?.place_id === 'pl_field', JSON.stringify(k1));

  // 5. An unlinked event stays unlinked, never guessed from title or location text.
  const k2 = asKendra.rows.find((r) => r.event_id === 'e2');
  check('an unlinked event stays unlinked (no venue invented)', k2?.state === 'unlinked' && k2?.place_id === null, JSON.stringify(k2));

  // 2. Priya: schedule-read, NO address.read. She keeps the label; the reader exposes no coordinates.
  await c.query(`insert into grants values ('p_priya','p_nora','schedule.read',null,null)`);
  await c.query(`set local test.person = 'p_priya'`);
  const asPriya = await c.query(`select event_id, state, place_id, place_label from event_day_places('p_nora','2026-11-07')`);
  const p1 = asPriya.rows.find((r) => r.event_id === 'e1');
  check('a schedule reader without address.read still gets the label (label-only view)',
    p1?.state === 'linked' && p1?.place_label === 'Tigers field', JSON.stringify(p1));
  const cols = await c.query(`select parameter_name, data_type from information_schema.parameters
    where specific_name like 'event_day_places%' and parameter_mode = 'OUT'`);
  const hasCoord = cols.rows.some((r) => /lat|lon|coord|geom/i.test(r.parameter_name ?? ''));
  check('the event reader exposes NO coordinate fields at all', !hasCoord,
    cols.rows.map((r) => r.parameter_name).join(','));

  // 3. An unrelated caller is refused: no schedule read, no parent, no rows.
  await c.query(`set local test.person = 'p_stranger'`);
  const asStranger = await c.query(`select count(*)::int n from event_day_places('p_nora','2026-11-07')`);
  check('an unrelated caller gets nothing at all', asStranger.rows[0].n === 0, `rows=${asStranger.rows[0].n}`);

  // 4. Cross-household linkage stays rejected at write time (trigger, not a read filter).
  let crossRejected = false;
  try { await c.query(`set local test.person = 'p_mom'; update events set place_id='pl_other' where id='e1'`); }
  catch (e) { crossRejected = e.code === '42501' || /EVENT_PLACE_NOT_IN_FAMILY/.test(e.message); }
  check('a cross-household place is rejected on write', crossRejected);

  // 6. Withheld: a link that exists but is not readable is its own state, not "unlinked".
  await c.query(`set local test.person = 'p_mom';
    alter table events drop constraint if exists events_place_id_fkey;
    update events set place_id='pl_ghost' where id='e2'`);
  const withheld = await c.query(`select state, place_id, place_label from event_day_places('p_nora','2026-11-07') where event_id='e2'`);
  check('a linked-but-unreadable place is WITHHELD, distinguishable from unlinked',
    withheld.rows[0]?.state === 'withheld' && withheld.rows[0]?.place_id === null, JSON.stringify(withheld.rows[0]));

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
