#!/usr/bin/env node
/**
 * ops/0027-dry-run.mjs — rolled-back dry run for 0027 (event status, holidays inclusive,
 * holiday precedence over the weekly routine, adult availability privacy).
 *
 * Everything runs inside ONE transaction that is rolled back at the end, so the live dataset is
 * untouched. Row-level checks impersonate real callers by setting `request.jwt.claims`, which is
 * exactly what `current_person()` reads — no test hook in product code.
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';

const env = readFileSync('.env', 'utf8');
const row = env.split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='));
if (!row) { console.log('no SUPABASE_DB_URL'); process.exit(2); }
const url = row.slice(row.indexOf('=') + 1).replace(/["'\s\r]/g, '');

const map = JSON.parse(readFileSync('data/identity-map.json', 'utf8'));
const subFor = (personId) => Object.entries(map).find(([, p]) => p === personId)?.[0];

const raw = readFileSync('supabase/migrations/0027_events_holidays_availability.sql', 'utf8');
const sql = raw.split('\n').filter((l) => !/^\s*(begin|commit);\s*$/.test(l)).join('\n');

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

let failed = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ': ' + detail : ''}`);
};

const asPerson = async (personId) => {
  const sub = subFor(personId);
  if (!sub) throw new Error(`no sub for ${personId}`);
  await c.query('reset role');
  await c.query('set local role authenticated');
  // The guide's scope is read from the VERIFIED token's app_metadata, so the impersonation has to
  // carry the same markers a real guide token does; without them is_demo_guide() is correctly false.
  const claims = personId === 'p_demo_guide'
    ? { sub, role: 'authenticated', app_metadata: { demo: true, demo_guide: true } }
    : { sub, role: 'authenticated' };
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
};

console.log('=== 0027 dry run (rolled back) ===');
await c.query('begin');
try {
  await c.query(sql);

  // 1. event status
  await c.query(`insert into events (id, child_id, title, start_at, end_at)
                 values ('dry27_ev_default','p_nora','Dry run', now(), now() + interval '1 hour')`);
  const def = (await c.query(`select status from events where id = 'dry27_ev_default'`)).rows[0].status;
  check('1 a new event defaults to confirmed', def === 'confirmed', def);

  // A failed statement aborts the whole transaction, so the expected failure runs inside a
  // savepoint that is rolled back — otherwise the negation test would poison every later check.
  let rejected = false;
  await c.query('savepoint dry27_status');
  try {
    await c.query(`insert into events (id, child_id, title, start_at, end_at, status)
                   values ('dry27_ev_bad','p_nora','Bad', now(), now() + interval '1 hour', 'maybe')`);
  } catch { rejected = true; }
  await c.query('rollback to savepoint dry27_status');
  check('1 an unknown status is rejected', rejected);

  // 2. holidays are INCLUSIVE at both ends
  await c.query(`insert into holidays (id, child_id, name, start_date, end_date)
                 values ('dry27_hol','p_nora','Dry break','2026-11-25','2026-11-27')`);
  const covers = async (d) => (await c.query('select holiday_covers($1,$2) as v', ['p_nora', d])).rows[0].v;
  check('2 the day BEFORE the range is not covered', (await covers('2026-11-24')) === false);
  check('2 the FIRST day is covered', (await covers('2026-11-25')) === true);
  check('2 the LAST day is covered (inclusive)', (await covers('2026-11-27')) === true);
  check('2 the day AFTER the range is not covered', (await covers('2026-11-28')) === false);

  // 3. holiday precedence over the weekly routine
  await c.query(`insert into routines (id, child_id, title, weekdays, start_time, end_time)
                 values ('dry27_r1','p_nora','School run', array['WED'], '08:00','08:30')`);
  const routinesOn = async (d) => (await c.query('select count(*)::int v from day_routines($1,$2)', ['p_nora', d])).rows[0].v;
  check('3 a normal Wednesday has the routine', (await routinesOn('2026-11-04')) === 1);
  check('3 a Wednesday inside the holiday has NO routine (precedence)', (await routinesOn('2026-11-25')) === 0);
  const kind = async (d) => (await c.query('select day_kind($1,$2) v', ['p_nora', d])).rows[0].v;
  check('3 day_kind reports HOLIDAY on a holiday', (await kind('2026-11-25')) === 'HOLIDAY');
  check('3 day_kind reports SCHOOL_DAY off it', (await kind('2026-11-04')) === 'SCHOOL_DAY');
  check('3 day_kind reports WEEKEND on Saturday', (await kind('2026-11-07')) === 'WEEKEND');

  // 4. availability: reason stays private, state is shared inside the village
  await c.query(`insert into adult_availability (id, person_id, start_at, end_at, state, reason)
                 values ('dry27_av','p_mom', '2026-11-04T09:00:00Z','2026-11-04T17:00:00Z','BUSY','dentist')`);

  await asPerson('p_mom');
  const own = (await c.query(`select count(*)::int v from adult_availability where id = 'dry27_av'`)).rows[0].v;
  const ownView = (await c.query(`select state from adult_availability_free_busy where id = 'dry27_av'`)).rows[0];
  check('4 the owner reads her own row', own === 1);
  check('4 the owner sees only state through the view', ownView?.state === 'BUSY');

  await asPerson('p_dad');
  const other = (await c.query(`select count(*)::int v from adult_availability where id = 'dry27_av'`)).rows[0].v;
  const otherView = (await c.query(`select * from adult_availability_free_busy where id = 'dry27_av'`)).rows;
  check('4 another adult cannot read the base row (reason stays private)', other === 0);
  check('4 another adult in the village sees Busy/Free', otherView.length === 1 && otherView[0].state === 'BUSY');
  check('4 the view exposes no reason column', otherView.length === 1 && !('reason' in otherView[0]));

  await asPerson('p_dana');
  const stranger = (await c.query(`select count(*)::int v from adult_availability_free_busy where id = 'dry27_av'`)).rows[0].v;
  check('4 an adult outside the village sees nothing', stranger === 0);

  await asPerson('p_demo_guide');
  const guide = (await c.query(`select count(*)::int v from adult_availability_free_busy where id = 'dry27_av'`)).rows[0].v;
  check('4 the guide sees the sandbox row (state only)', guide === 1);

  await c.query('reset role');
} finally {
  await c.query('rollback');
  await c.end();
}

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${failed} failure(s); transaction rolled back`);
process.exit(failed === 0 ? 0 : 1);
