#!/usr/bin/env node
/**
 * ops/0028-dry-run.mjs — rolled-back dry run for the Group 3 correction.
 *
 * Proves: a SCHOOL_CLOSURE suppresses only SCHOOL_DAY routines (bedtime survives); availability is
 * recorded independently; an APPROVED HolidayArrangement overrides the weekly schedule for its
 * INCLUSIVE interval only; a PROPOSED one does not; conflicts are surfaced; approverFor follows the
 * effective schedule on an arrangement day and is unchanged on a normal day; the other parent (and
 * only the other parent, by default) can approve.
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';

const env = readFileSync('.env', 'utf8');
const row = env.split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='));
if (!row) { console.log('no SUPABASE_DB_URL'); process.exit(2); }
const url = row.slice(row.indexOf('=') + 1).replace(/["'\s\r]/g, '');

const map = JSON.parse(readFileSync('data/identity-map.json', 'utf8'));
const subFor = (pid) => Object.entries(map).find(([, p]) => p === pid)?.[0];

const sql = readFileSync('supabase/migrations/0028_holiday_arrangements.sql', 'utf8')
  .split('\n').filter((l) => !/^\s*(begin|commit);\s*$/.test(l)).join('\n');

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

let failed = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ': ' + detail : ''}`);
};
const asPerson = async (pid) => {
  const sub = subFor(pid);
  await c.query('reset role');
  await c.query('set local role authenticated');
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub, role: 'authenticated' })]);
};
const asService = async () => { await c.query('reset role'); };
const one = async (q, p = []) => (await c.query(q, p)).rows[0];
const all = async (q, p = []) => (await c.query(q, p)).rows;

console.log('=== 0028 dry run (rolled back) ===');
await c.query('begin');
try {
  await c.query(sql);

  // ---------------------------------------------------------------- fixtures (rolled back)
  await c.query(`insert into holidays (id, child_id, name, start_date, end_date)
                 values ('dry28_closure','p_nora','Thanksgiving break','2026-11-25','2026-11-27')`);
  await c.query(`insert into routines (id, child_id, title, weekdays, start_time, end_time, applies_on)
                 values ('dry28_school','p_nora','School run', array['WED'], '08:00','08:30','SCHOOL_DAY'),
                        ('dry28_bed','p_nora','Bedtime', array['WED'], '20:30','21:00','ANY_DAY')`);

  const routines = async (d) => all('select title from day_routines($1,$2) order by title', ['p_nora', d]).then((r) => r.map((x) => x.title));
  const onClosure = await routines('2026-11-25');
  const onNormal = await routines('2026-11-04');
  check('1 closure suppresses the SCHOOL_DAY routine', !onClosure.includes('School run'), onClosure.join('|') || '(none)');
  check('1 a care/household routine survives the closure', onClosure.includes('Bedtime'), onClosure.join('|'));
  check('1 both apply on a normal school day', onNormal.includes('School run') && onNormal.includes('Bedtime'), onNormal.join('|'));
  check('1 day_kind says SCHOOL_CLOSURE, not a generic holiday', (await one('select day_kind($1,$2) v', ['p_nora', '2026-11-25'])).v === 'SCHOOL_CLOSURE');

  await c.query(`insert into adult_availability (id, person_id, start_at, end_at, state, reason)
                 values ('dry28_av','p_mom','2026-11-25T09:00:00Z','2026-11-25T17:00:00Z','BUSY','shift')`);
  await asPerson('p_dad');
  const av = await one(`select state from adult_availability_free_busy where id = 'dry28_av'`);
  check('1 availability is recorded independently of the closure', av?.state === 'BUSY');
  await asService();

  // ---------------------------------------------------------------- arrangement precedence
  await c.query(`insert into holiday_arrangements
      (id, child_id, holiday_name, date_start, date_end, assigned_parent_id, pickup_duty_parent_id,
       dropoff_duty_parent_id, status, proposed_by_id)
      values ('dry28_arr','p_nora','Thanksgiving','2026-11-25','2026-11-27','p_dad','p_dad','p_dad','PROPOSED','p_dad')`);

  const sched = async (d) => one('select parent_id, source, arrangement_id from effective_schedule_for($1,$2)', ['p_nora', d]);
  const proposed = await sched('2026-11-25');
  check('2 a PROPOSED arrangement does NOT override the weekly schedule',
    proposed.source === 'WEEKLY' && proposed.parent_id === 'p_mom', `${proposed.source}/${proposed.parent_id}`);

  await asPerson('p_mom');
  await c.query(`update holiday_arrangements set status = 'APPROVED' where id = 'dry28_arr'`);
  await asService();

  const approved = { d25: await sched('2026-11-25'), d26: await sched('2026-11-26'), d27: await sched('2026-11-27') };
  check('2 the APPROVED arrangement applies on its FIRST day', approved.d25.source === 'ARRANGEMENT' && approved.d25.parent_id === 'p_dad');
  check('2 …on its middle day', approved.d26.source === 'ARRANGEMENT' && approved.d26.parent_id === 'p_dad');
  check('2 …on its LAST day (inclusive)', approved.d27.source === 'ARRANGEMENT' && approved.d27.parent_id === 'p_dad');
  const after = await sched('2026-11-28');
  check('2 the day after returns to the WEEKLY schedule', after.source === 'WEEKLY' && after.parent_id === 'p_dad',
    `${after.source}/${after.parent_id}`);
  const before = await sched('2026-11-24');
  check('2 the day before is unchanged weekly (Kendra on Tuesday)', before.source === 'WEEKLY' && before.parent_id === 'p_mom');

  // ---------------------------------------------------------------- approverFor follows it
  // `_is_approver_for` is deliberately REVOKED from authenticated (it is an internal helper), so the
  // approver semantics are proven through the public `effective_schedule_for`, and the wiring of the
  // helper onto it is proven by inspecting its definition — not by calling a function nobody may call.
  const wiring = await one(`select pg_get_functiondef(p.oid) d
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = '_is_approver_for'`);
  check('2 _is_approver_for now delegates to effective_schedule_for',
    typeof wiring?.d === 'string' && wiring.d.includes('effective_schedule_for'));
  const stillRevoked = await one(`select has_function_privilege('authenticated', p.oid, 'EXECUTE') v
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname='_is_approver_for'`);
  check('2 _is_approver_for stays internal (not callable by authenticated)', stillRevoked?.v === false);

  const approverDay = await sched('2026-11-25');
  check('2 the approver on the arrangement day is the assigned parent (Andre, not Kendra)',
    approverDay.source === 'ARRANGEMENT' && approverDay.parent_id === 'p_dad',
    `${approverDay.source}/${approverDay.parent_id}`);
  const normalDay = await sched('2026-11-04');
  check('2 on a normal Wednesday the approver is unchanged (Kendra)',
    normalDay.source === 'WEEKLY' && normalDay.parent_id === 'p_mom',
    `${normalDay.source}/${normalDay.parent_id}`);

  // ---------------------------------------------------------------- conflicts surface
  await c.query(`insert into holiday_arrangements
      (id, child_id, holiday_name, date_start, date_end, assigned_parent_id, status, proposed_by_id)
      values ('dry28_arr2','p_nora','Overlapping','2026-11-26','2026-11-26','p_mom','APPROVED','p_mom')`);
  const conflicts = await all(`select kind, on_day::text d, arrangement_ids from schedule_conflicts('p_nora','2026-11-24','2026-11-30')`);
  const overlap = conflicts.filter((x) => x.kind === 'OVERLAP').map((x) => x.d);
  check('3 overlapping approved arrangements are surfaced', overlap.includes('2026-11-26'), overlap.join(',') || 'none');

  await c.query(`delete from parenting_schedules where child_id = 'p_nora' and parent_id = 'p_dad' and 'SUN' = any(weekdays)`);
  const gaps = (await all(`select kind, on_day::text d from schedule_conflicts('p_nora','2026-11-29','2026-11-29')`))
    .filter((x) => x.kind === 'GAP');
  check('3 a day no rule covers is surfaced as a GAP (never auto-resolved)', gaps.length === 1, gaps.map((g) => g.d).join(',') || 'none');

  // ---------------------------------------------------------------- approval authority
  await c.query(`insert into holiday_arrangements
      (id, child_id, holiday_name, date_start, date_end, assigned_parent_id, status, proposed_by_id)
      values ('dry28_self','p_nora','Self-approval','2026-12-05','2026-12-05','p_mom','PROPOSED','p_mom')`);
  await asPerson('p_mom');
  let selfApprovalRefused = false;
  await c.query('savepoint dry28_self');
  try {
    await c.query(`update holiday_arrangements set status = 'APPROVED' where id = 'dry28_self'`);
  } catch { selfApprovalRefused = true; }
  await c.query('rollback to savepoint dry28_self');
  check('4 the proposer cannot approve her own swap (BOTH_PARENTS default)', selfApprovalRefused);

  const rule = await one('select swap_approval_rule($1) v', ['p_nora']);
  check('4 the policy defaults to BOTH_PARENTS', rule.v === 'BOTH_PARENTS', rule.v);

  await asPerson('p_dad');
  let otherApproval = true;
  await c.query('savepoint dry28_other');
  try {
    await c.query(`update holiday_arrangements set status = 'APPROVED' where id = 'dry28_self'`);
  } catch { otherApproval = false; }
  await c.query('rollback to savepoint dry28_other');
  check('4 the OTHER parent can approve it', otherApproval);

  await c.query('reset role');
} finally {
  await c.query('rollback');
  await c.end();
}

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${failed} failure(s); transaction rolled back`);
process.exit(failed === 0 ? 0 : 1);
