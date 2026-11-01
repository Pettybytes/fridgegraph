#!/usr/bin/env node
/**
 * ops/0054-dry-run.mjs — rolled-back dry run for the close outcome and the thank-you.
 *
 * Proves:
 *   * a close records FOUND_SAFE and status stays CLOSED (no new state);
 *   * the thank-you reaches exactly the FROZEN audience, once per member, in the SAME explicit close;
 *   * the close and the thank-you are IDEMPOTENT — a retry returns the existing close and writes no
 *     second thank-you;
 *   * only a parent or guardian closes: an audience member cannot, and WITH_ME never closes;
 *   * an outcome other than FOUND_SAFE is refused, and an outcome cannot exist on a non-closed alert;
 *   * a demo caller's thank-you is SIMULATED, like activation.
 *
 * Nothing is committed: 0053 + 0054 run inside a transaction that is rolled back.
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';

const env = readFileSync('.env', 'utf8');
const row = env.split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='));
const url = row.slice(row.indexOf('=') + 1).replace(/["'\s\r]/g, '');
const map = JSON.parse(readFileSync('data/identity-map.json', 'utf8'));
const subFor = (pid) => Object.entries(map).find(([, p]) => p === pid)?.[0];

const strip = (path) => readFileSync(path, 'utf8')
  .split('\n').filter((l) => !/^\s*(begin|commit);\s*$/.test(l)).join('\n');

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

let failed = 0;
const check = (l, ok, d = '') => { if (!ok) failed += 1; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${d ? ' — ' + d : ''}`); };
const one = async (q, p = []) => (await c.query(q, p)).rows[0];
const as = async (pid, meta = {}) => {
  await c.query('reset role');
  await c.query('set local role authenticated');
  await c.query(`select set_config('request.jwt.claims',$1,true)`,
    [JSON.stringify({ sub: subFor(pid), role: 'authenticated', app_metadata: meta })]);
};
const service = async () => c.query('reset role');
const expectError = async (label, fn, code) => {
  await c.query('savepoint e');
  let err = null;
  try { await fn(); } catch (e) { err = e; }
  await c.query('rollback to savepoint e');
  check(label, Boolean(err) && (!code || String(err.code) === code || String(err.message).includes(code)),
    err ? `${err.code}:${String(err.message).split('\n')[0]}` : 'no error');
};

console.log('=== 0054 close-outcome dry run (rolled back) ===');
await c.query('begin');
try {
  await c.query(strip('supabase/migrations/0053_orbit_recorded_places.sql'));
  await c.query(strip('supabase/migrations/0054_orbit_close_outcome.sql'));

  // audience policy for Nora's household, as the 0034 proof does (replace any leftover row)
  await c.query(`delete from household_policies p using household_members m
     where m.household_id=p.household_id and m.person_id='p_nora' and m.role='child'
       and p.rule='orbit_notify_eligible'`);
  await c.query(`insert into household_policies (household_id, rule, value)
    select h.id, 'orbit_notify_eligible', 'p_gma,p_bryan'
      from households h join household_members m on m.household_id=h.id
     where m.person_id='p_nora' and m.role='child' limit 1`);

  const place = await one(`select id from recorded_places where household_id='h_a' and label='Maple Grove Park'`);

  // ---------------------------------------------------------------- activate as Kendra
  await as('p_mom', { demo: 'true' });
  const draftId = (await c.query(`select (draft_orbit_share($1, 'Blue', 'Jacket', null, null, null, null, $2, $3)).id id`,
    ['p_nora', place.id, '2026-11-01T15:00:00Z'])).rows[0].id;
  const prev = await one(`select * from preview_orbit_share($1)`, [draftId]);
  const alertId = (await c.query(`select activate_orbit_alert($1,$2,$3) id`, [draftId, prev.draft_version, prev.message_hash])).rows[0].id;
  const audience = (await c.query(`select person_id from orbit_audience_members where orbit_alert_id=$1 order by notify_order`, [alertId])).rows.map((r) => r.person_id);
  check('the alert is ACTIVE with a frozen audience', audience.length >= 2, audience.join(','));

  // ---------------------------------------------------------------- WITH_ME does not close
  await as('p_gma', { demo: 'true' });
  await c.query(`select respond_to_orbit_alert($1,'WITH_ME')`, [alertId]);
  const afterRespond = await one(`select status from orbit_alerts where id=$1`, [alertId]);
  check('a WITH_ME response does not close the alert', afterRespond.status === 'ACTIVE', afterRespond.status);

  // ---------------------------------------------------------------- audience member cannot close
  await expectError('an audience member cannot close', () =>
    c.query(`select close_orbit_alert($1,'FOUND_SAFE')`, [alertId]), 'UNAUTHORIZED');
  check('still ACTIVE after the refused close',
    (await one(`select status from orbit_alerts where id=$1`, [alertId])).status === 'ACTIVE');

  // ---------------------------------------------------------------- bad outcome refused
  await as('p_mom', { demo: 'true' });
  await expectError('an outcome other than FOUND_SAFE is refused', () =>
    c.query(`select close_orbit_alert($1,'IN_DANGER')`, [alertId]), 'ORBIT_BAD_OUTCOME');

  // The constraint is proven as the service role, because an authenticated caller has no UPDATE
  // grant on orbit_alerts at all — the table is written only through the SECURITY DEFINER actions.
  await service();
  await expectError('an outcome cannot sit on a non-closed alert', () =>
    c.query(`update orbit_alerts set close_outcome='FOUND_SAFE' where id=$1`, [alertId]), 'orbit_close_outcome_only_when_closed');

  // ---------------------------------------------------------------- the close + thank-you
  await service();
  const thankyouBefore = (await one(`select count(*)::int n from orbit_audience_members where orbit_alert_id=$1 and thankyou_at is not null`, [alertId])).n;
  check('no thank-you exists before the close', thankyouBefore === 0);

  await as('p_mom', { demo: 'true' });
  const closedId = (await c.query(`select close_orbit_alert($1,'FOUND_SAFE') id`, [alertId])).rows[0].id;
  await service();
  const closed = await one(`select status, close_outcome, closed_by from orbit_alerts where id=$1`, [alertId]);
  check('the close returns the alert id', closedId === alertId);
  check('status is still CLOSED (no new state)', closed.status === 'CLOSED', closed.status);
  check('close_outcome is FOUND_SAFE', closed.close_outcome === 'FOUND_SAFE');
  check('the closer is recorded', closed.closed_by === 'p_mom');

  const thankyou = (await c.query(`select person_id, thankyou_outcome, thankyou_at from orbit_audience_members where orbit_alert_id=$1 order by notify_order`, [alertId])).rows;
  check('every frozen member got exactly one thank-you', thankyou.length === audience.length && thankyou.every((r) => r.thankyou_at !== null),
    `${thankyou.length}/${audience.length}`);
  check('the thank-you is SIMULATED for a demo caller', thankyou.every((r) => r.thankyou_outcome === 'SIMULATED'),
    [...new Set(thankyou.map((r) => r.thankyou_outcome))].join(','));
  check('no non-audience row received a thank-you',
    (await one(`select count(*)::int n from orbit_audience_members where orbit_alert_id=$1 and person_id <> all($2::text[])`, [alertId, audience])).n === 0);

  const thankyouText = await one(`select _orbit_thankyou_for(a) t from orbit_alerts a where a.id=$1`, [alertId]);
  check('the thank-you names the child and says found safe', /Nora was found safe and sound/.test(thankyouText.t), thankyouText.t);

  // ---------------------------------------------------------------- idempotent close
  const firstAt = thankyou.map((r) => String(r.thankyou_at)).join('|');
  await as('p_mom', { demo: 'true' });
  const retryId = (await c.query(`select close_orbit_alert($1,'FOUND_SAFE') id`, [alertId])).rows[0].id;
  await service();
  const second = (await c.query(`select person_id, thankyou_at from orbit_audience_members where orbit_alert_id=$1 order by notify_order`, [alertId])).rows;
  check('a retried close returns the existing close', retryId === alertId);
  check('a retried close writes no second thank-you', second.map((r) => String(r.thankyou_at)).join('|') === firstAt);

  // ---------------------------------------------------------------- the audience sees it, nobody else
  await as('p_bryan');
  const audienceView = (await c.query(`select id, status, close_outcome, last_seen_place_id from orbit_alerts where id=$1`, [alertId])).rows;
  check('a frozen audience member can still read the closed alert', audienceView.length === 1);
  check('the audience sees the close outcome and the place', audienceView[0]?.close_outcome === 'FOUND_SAFE' && audienceView[0]?.last_seen_place_id === place.id);
  const ownThankyou = (await c.query(`select person_id from orbit_audience_members where orbit_alert_id=$1`, [alertId])).rows;
  check('an audience member sees only their own audience row', ownThankyou.length === 1 && ownThankyou[0].person_id === 'p_bryan',
    ownThankyou.map((r) => r.person_id).join(','));

  await as('p_dana');
  check('a non-member sees nothing', (await c.query(`select 1 from orbit_alerts where id=$1`, [alertId])).rows.length === 0);

  await c.query('rollback');
  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${failed} failing check${failed === 1 ? '' : 's'}`);
  process.exit(failed === 0 ? 0 : 1);
} catch (error) {
  await c.query('rollback').catch(() => {});
  console.error('DRY RUN ERROR:', error instanceof Error ? error.message : error);
  process.exit(1);
} finally {
  await c.end();
}
