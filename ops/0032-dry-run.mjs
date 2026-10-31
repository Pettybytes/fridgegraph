#!/usr/bin/env node
/**
 * ops/0032-dry-run.mjs — rolled-back dry run for the Orbit minimal slice.
 *
 * Proves: drafts are parent/guardian-only and send nothing; preview binds version + hash; activation
 * is atomic and unique per child; the audience is frozen from policy with no ranking; responses are
 * append-only and WITH_ME does not close; closure is parent/guardian-only; location content is
 * refused; and no location column exists anywhere.
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';

const env = readFileSync('.env', 'utf8');
const row = env.split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='));
if (!row) { console.log('no SUPABASE_DB_URL'); process.exit(2); }
const url = row.slice(row.indexOf('=') + 1).replace(/["'\s\r]/g, '');
const map = JSON.parse(readFileSync('data/identity-map.json', 'utf8'));
const subFor = (pid) => Object.entries(map).find(([, p]) => p === pid)?.[0];

const sql = readFileSync('supabase/migrations/0032_orbit_minimal.sql', 'utf8')
  .split('\n').filter((l) => !/^\s*(begin|commit);\s*$/.test(l)).join('\n');

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
let failed = 0;
const check = (label, ok, detail = '') => { if (!ok) failed += 1; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ': ' + detail : ''}`); };
const as = async (pid) => {
  await c.query('reset role');
  await c.query('set local role authenticated');
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: subFor(pid), role: 'authenticated' })]);
};
const service = async () => c.query('reset role');
const one = async (q, p = []) => (await c.query(q, p)).rows[0];
const expectError = async (label, fn, code) => {
  await c.query('savepoint e');
  let err = null;
  try { await fn(); } catch (e) { err = e; }
  await c.query('rollback to savepoint e');
  check(label, Boolean(err) && (!code || String(err.code) === code || String(err.message).includes(code)),
    err ? `${err.code}:${String(err.message).split('\n')[0]}` : 'no error');
};

console.log('=== 0032 Orbit dry run (rolled back) ===');
await c.query('begin');
try {
  await c.query(sql);
  // Explicit per-child policy (Decided #6): co-parent + two village adults. Deliberately NOT pickup's list.
  await c.query(`insert into household_policies (household_id, rule, value)
    select h.id, 'orbit_notify_eligible', 'p_dad,p_gma,p_bryan'
      from households h join household_members m on m.household_id = h.id
     where m.person_id = 'p_nora' and m.role = 'child' limit 1`);

  // ---------------------------------------------------------------- 1. draft authority + silence
  await as('p_dana');
  await expectError('1 an out-of-network adult cannot draft', () => c.query(`select draft_orbit_share('p_nora','grey hoodie')`), '42501');

  await as('p_mom');
  const draft = (await c.query(`select * from draft_orbit_share('p_nora','grey hoodie','ponytail','blue backpack',null,null)`)).rows[0];
  check('1 a parent creates a PENDING_ACTIVATION draft', draft?.status === 'PENDING_ACTIVATION', draft?.status);
  check('1 the draft sends nothing (no active alert, no audience)', (await one(`select count(*)::int v from orbit_audience_members where orbit_alert_id=$1`, [draft.id])).v === 0);
  check('1 no job exists yet', (await one(`select count(*)::int v from coordination_jobs where idempotency_key like 'orbit:%'`)).v === 0);

  // ---------------------------------------------------------------- 2. preview binding
  const prev = (await c.query(`select * from preview_orbit_share($1)`, [draft.id])).rows[0];
  const childName = (await one(`select display_name v from people where id='p_nora'`)).v.split(' ')[0];
  check('2 preview names the child and the signal', prev.message.includes(childName) && prev.message.includes('check-in not recorded'));
  check('2 preview carries version + hash + audience size', prev.draft_version === draft.draft_version && Boolean(prev.message_hash) && prev.audience_size === 3,
    `v${prev.draft_version} size=${prev.audience_size}`);
  check('2 the preview contains no place words or coordinates', !/\d{1,3}\.\d{3,}|street|school|road|near/i.test(prev.message));

  await expectError('2 a stale draftVersion is refused', () => c.query(`select activate_orbit_alert($1,$2,$3)`, [draft.id, prev.draft_version - 1, prev.message_hash]), 'ORBIT_DRAFT_STALE');
  await expectError('2 a mismatched messageHash is refused', () => c.query(`select activate_orbit_alert($1,$2,$3)`, [draft.id, prev.draft_version, 'deadbeef']), 'ORBIT_PREVIEW_MISMATCH');

  // editing after preview bumps the version, so the old binding is dead
  const draft2 = (await c.query(`select * from draft_orbit_share('p_nora','grey hoodie','ponytail','blue backpack','red boots',null)`)).rows[0];
  check('2 an edit after preview bumps the draft version', draft2.draft_version === draft.draft_version + 1, `v${draft2.draft_version}`);
  await expectError('2 the pre-edit hash no longer activates', () => c.query(`select activate_orbit_alert($1,$2,$3)`, [draft.id, prev.draft_version, prev.message_hash]), 'ORBIT_DRAFT_STALE');

  // ---------------------------------------------------------------- 3. location refusal
  await expectError('3 a location-bearing field is refused at draft time',
    () => c.query(`select draft_orbit_share('p_nora','grey hoodie near Lincoln Elementary on Main Street',null,null,null,null)`), 'ORBIT_SHARE_HAS_LOCATION');
  await expectError('3 "usually near" is refused', () => c.query(`select draft_orbit_share('p_nora',null,null,null,'usually near the park',null)`), 'ORBIT_SHARE_HAS_LOCATION');
  check('3 the detector flags a school name', (await one(`select _orbit_has_location('walking by Lincoln Elementary') v`)).v === true);
  check('3 the detector does not flag ordinary description', (await one(`select _orbit_has_location('grey hoodie and blue backpack') v`)).v === false);

  // ---------------------------------------------------------------- 4. activation
  const prev2 = (await c.query(`select * from preview_orbit_share($1)`, [draft.id])).rows[0];
  const alertId = (await one(`select activate_orbit_alert($1,$2,$3) v`, [draft.id, prev2.draft_version, prev2.message_hash])).v;
  const act = await one(`select * from orbit_alerts where id=$1`, [alertId]);
  check('4 activation moves the alert to ACTIVE', act.status === 'ACTIVE' && act.activated_by === 'p_mom');
  check('4 activation created an ORBIT_ALERT job', (await one(`select type, status from coordination_jobs where id=$1`, [act.job_id])).type === 'ORBIT_ALERT');
  const aud = (await c.query(`select person_id, notify_order, notification_outcome from orbit_audience_members where orbit_alert_id=$1 order by notify_order`, [alertId])).rows;
  check('4 the audience is exactly the frozen policy list, flat order, no ranking',
    aud.map((a) => a.person_id).join(',') === 'p_dad,p_gma,p_bryan' && aud.every((a) => a.notification_outcome === 'SIMULATED'),
    aud.map((a) => a.person_id).join(','));
  check('4 the delivered message equals the confirmed preview',
    act.minimal_message === prev2.message && act.message_hash === prev2.message_hash);

  // concurrency: a second draft cannot produce a second active alert
  await as('p_dad');
  const d3 = (await c.query(`select * from draft_orbit_share('p_nora','blue coat',null,null,null,null)`)).rows[0];
  const p3 = (await c.query(`select * from preview_orbit_share($1)`, [d3.id])).rows[0];
  await expectError('4 a second activation for the same child is refused', () => c.query(`select activate_orbit_alert($1,$2,$3)`, [d3.id, p3.draft_version, p3.message_hash]), 'ORBIT_ALREADY_ACTIVE');

  // ---------------------------------------------------------------- 5. responses
  await as('p_dad');
  await c.query(`select respond_to_orbit_alert($1,'WITH_ME')`, [alertId]);
  check('5 a lone WITH_ME does NOT close the alert', (await one(`select status from orbit_alerts where id=$1`, [alertId])).status === 'ACTIVE');
  await as('p_priya');
  await expectError('5 a non-audience adult cannot respond', () => c.query(`select respond_to_orbit_alert($1,'ON_WAY')`, [alertId]), '42501');
  await as('p_gma');
  await c.query(`select respond_to_orbit_alert($1,'ON_WAY')`, [alertId]);
  await as('p_dad');
  await c.query(`select respond_to_orbit_alert($1,'CANNOT_HELP')`, [alertId]);
  const hist = (await c.query(`select person_id, response from orbit_responses where orbit_alert_id=$1 order by responded_at`, [alertId])).rows;
  check('5 a changed response appends history (earlier row intact)', hist.filter((h) => h.person_id === 'p_dad').length === 2,
    hist.map((h) => `${h.person_id}:${h.response}`).join(' '));
  await service();
  await expectError('5 responses are append-only (UPDATE refused)', () => c.query(`update orbit_responses set response='WITH_ME' where orbit_alert_id=$1`, [alertId]), 'ORBIT_RESPONSES_APPEND_ONLY');
  await expectError('5 responses are append-only (DELETE refused)', () => c.query(`delete from orbit_responses where orbit_alert_id=$1`, [alertId]), 'ORBIT_RESPONSES_APPEND_ONLY');

  // ---------------------------------------------------------------- 6. closure
  await as('p_dana');
  await expectError('6 an out-of-network adult cannot close', () => c.query(`select close_orbit_alert($1)`, [alertId]), '42501');
  await as('p_gma');
  await expectError('6 an audience member cannot close', () => c.query(`select close_orbit_alert($1)`, [alertId]), '42501');
  await as('p_mom');
  await c.query(`select close_orbit_alert($1)`, [alertId]);
  const closed = await one(`select status, closed_by from orbit_alerts where id=$1`, [alertId]);
  check('6 a parent closes it, and closure is recorded', closed.status === 'CLOSED' && closed.closed_by === 'p_mom');

  // ---------------------------------------------------------------- 7. no location anywhere
  const cols = (await c.query(`select table_name, column_name from information_schema.columns
    where table_schema='public' and table_name like 'orbit_%'`)).rows;
  const suspicious = cols.filter((r) => /location|lat|lng|lon|coord|address|geo/i.test(r.column_name));
  check('7 no orbit table has a location-shaped column', suspicious.length === 0, suspicious.map((s) => `${s.table_name}.${s.column_name}`).join(',') || 'none');

  await service();
} finally {
  await c.query('rollback');
  await c.end();
}
console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${failed} failure(s); transaction rolled back`);
process.exit(failed === 0 ? 0 : 1);
