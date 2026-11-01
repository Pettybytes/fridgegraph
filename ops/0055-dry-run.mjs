#!/usr/bin/env node
/**
 * ops/0055-dry-run.mjs — rolled-back proof of the post-close redaction boundary.
 *
 * Everything here is a REAL caller assumption (role `authenticated` + jwt claims), not a reading of
 * the source, and the whole migration runs inside a transaction that is rolled back.
 *
 *   * the EFFECTIVE grant is what matters: table-level SELECT is gone, a sensitive column read fails,
 *     a safe column read works — all as `authenticated`;
 *   * the accessor answers a parent/guardian always, a frozen audience member ONLY while ACTIVE, and
 *     an unrelated caller or the demo guide never;
 *   * after the close: no descriptors, no message, no photo id, no place, no time — but the outcome,
 *     the thank-you and the caller's own response remain;
 *   * the photo gate still refuses a closed recipient and still allows the parent;
 *   * EXECUTE to PUBLIC is gone from the sensitive functions.
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
const guide = async () => {
  await c.query('reset role');
  await c.query('set local role authenticated');
  await c.query(`select set_config('request.jwt.claims',$1,true)`,
    [JSON.stringify({ sub: subFor('kendra'), role: 'authenticated', app_metadata: { demo_guide: 'true' } })]);
};
const service = async () => c.query('reset role');
const denied = async (label, fn) => {
  await c.query('savepoint d');
  let err = null;
  try { await fn(); } catch (e) { err = e; }
  await c.query('rollback to savepoint d');
  check(label, Boolean(err) && String(err.code) === '42501', err ? `${err.code}` : 'no error');
};

console.log('=== 0055 post-close redaction dry run (rolled back) ===');
await c.query('begin');
try {
  // baseline: before the migration, the table grant is what lets a caller read everything
  const before = await one(`select count(*)::int n from information_schema.role_table_grants
     where table_name='orbit_alerts' and grantee='authenticated' and privilege_type='SELECT'`);
  check('BEFORE: authenticated holds TABLE-level SELECT (so column revokes would do nothing)', before.n === 1);

  await c.query(strip('supabase/migrations/0055_orbit_post_close_redaction.sql'));

  // ---------------------------------------------------------------- the grant boundary
  await service();
  const after = await one(`select count(*)::int n from information_schema.role_table_grants
     where table_name='orbit_alerts' and grantee='authenticated' and privilege_type='SELECT'`);
  check('AFTER: table-level SELECT is revoked', after.n === 0);

  const pubExec = await one(`select proacl::text a from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='orbit_photo_access'`);
  // PUBLIC's entry has an EMPTY grantee: '=X/postgres'. A naive includes('=X') also matches
  // 'postgres=X/postgres', so parse the entries instead of substring-matching them.
  const aclEntries = String(pubExec.a).replace(/^\{|\}$/g, '').split(',');
  check('orbit_photo_access no longer grants EXECUTE to PUBLIC',
    !aclEntries.some((e) => e.startsWith('=')), String(pubExec.a).slice(0, 60));

  // ---------------------------------------------------------------- build an alert
  await c.query(`delete from household_policies p using household_members m
     where m.household_id=p.household_id and m.person_id='p_nora' and m.role='child'
       and p.rule='orbit_notify_eligible'`);
  await c.query(`insert into household_policies (household_id, rule, value)
    select h.id, 'orbit_notify_eligible', 'p_gma,p_bryan'
      from households h join household_members m on m.household_id=h.id
     where m.person_id='p_nora' and m.role='child' limit 1`);

  const place = await one(`select id from recorded_places where household_id='h_a' and label='Maple Grove Park'`);
  await as('p_mom', { demo: 'true' });
  // A real registered photo, so "refused after closure" is a measurement rather than a vacuous pass.
  const photoId = (await c.query(`select register_orbit_photo($1,$2,$3) id`,
    ['p_nora', 'a'.repeat(64), 'orbit/proof-0055.png'])).rows[0].id;
  // Signature order: child, wearColor, wearGarment, hair, carryColor, carryItem, photo, place, time.
  const draftId = (await c.query(`select (draft_orbit_share($1,'Blue','Jacket',null,null,null,$2,$3,$4)).id id`,
    ['p_nora', photoId, place.id, '2026-11-01T15:00:00Z'])).rows[0].id;
  const prev = await one(`select * from preview_orbit_share($1)`, [draftId]);
  const alertId = (await c.query(`select activate_orbit_alert($1,$2,$3) id`, [draftId, prev.draft_version, prev.message_hash])).rows[0].id;
  // The draft stored the registered photo. Read it as the service role: after 0055 a caller cannot
  // read photo_id at all, which is the whole point.
  await service();
  const storedPhoto = (await one(`select photo_id from orbit_alerts where id=$1`, [alertId]))?.photo_id ?? null;
  check('the alert carries the registered photo', storedPhoto === photoId, `${storedPhoto} vs ${photoId}`);
  check('an ACTIVE alert exists to test against', Boolean(alertId), alertId);

  // ---------------------------------------------------------------- ACTIVE: recipient gets details
  await as('p_gma', { demo: 'true' });
  const activeRow = await one(`select * from orbit_share_for($1)`, [alertId]);
  check('ACTIVE recipient gets the descriptors', activeRow?.wear_color === 'Blue' && activeRow?.wear_garment === 'Jacket',
    JSON.stringify({ c: activeRow?.wear_color, g: activeRow?.wear_garment }));
  check('ACTIVE recipient gets the stored message', typeof activeRow?.minimal_message === 'string' && activeRow.minimal_message.length > 0);
  check('ACTIVE recipient gets the place and time',
    activeRow?.place_label === 'Maple Grove Park' && activeRow?.last_seen_at != null,
    `${activeRow?.place_label} @ ${activeRow?.last_seen_at}`);
  const activePlace = await one(`select * from orbit_place_for($1)`, [alertId]);
  check('ACTIVE recipient gets the place row', activePlace?.label === 'Maple Grove Park');
  const activePhoto = await one(`select access, storage_path from orbit_photo_access($1)`, [photoId]);
  check('ACTIVE recipient may fetch the photo (audience-level, path returned)',
    activePhoto?.access === 'AUDIENCE' && Boolean(activePhoto?.storage_path), String(activePhoto?.access ?? 'null'));

  // ---------------------------------------------------------------- ACTIVE: unrelated callers get nothing
  await as('p_dana');
  check('an unrelated caller gets no share row', (await c.query(`select * from orbit_share_for($1)`, [alertId])).rows.length === 0);
  check('an unrelated caller gets no place', (await c.query(`select * from orbit_place_for($1)`, [alertId])).rows.length === 0);

  await guide();
  check('the demo guide gets no share row', (await c.query(`select * from orbit_share_for($1)`, [alertId])).rows.length === 0);
  check('the demo guide gets no place', (await c.query(`select * from orbit_place_for($1)`, [alertId])).rows.length === 0);

  // ---------------------------------------------------------------- the raw column boundary
  await as('p_gma', { demo: 'true' });
  await denied('a recipient cannot SELECT the sensitive column directly', () =>
    c.query(`select wear_color from orbit_alerts where id=$1`, [alertId]));
  await denied('the stored message column is refused directly', () =>
    c.query(`select minimal_message from orbit_alerts where id=$1`, [alertId]));
  await denied('the photo reference column is refused directly', () =>
    c.query(`select photo_id from orbit_alerts where id=$1`, [alertId]));
  const safe = await one(`select id, status, close_outcome from orbit_alerts where id=$1`, [alertId]);
  check('the safe columns are still readable', safe?.id === alertId && safe?.status === 'ACTIVE',
    `${safe?.status}`);

  // ---------------------------------------------------------------- close it
  await as('p_mom', { demo: 'true' });
  await c.query(`select close_orbit_alert($1,'FOUND_SAFE')`, [alertId]);

  // ---------------------------------------------------------------- CLOSED: recipient loses details
  await as('p_gma', { demo: 'true' });
  check('CLOSED recipient gets NO share row (no descriptors, message, photo, place, time)',
    (await c.query(`select * from orbit_share_for($1)`, [alertId])).rows.length === 0);
  check('CLOSED recipient gets NO place row',
    (await c.query(`select * from orbit_place_for($1)`, [alertId])).rows.length === 0);
  const still = await one(`select id, status, close_outcome from orbit_alerts where id=$1`, [alertId]);
  check('CLOSED recipient still sees status and outcome', still?.status === 'CLOSED' && still?.close_outcome === 'FOUND_SAFE');
  const thankyou = await one(`select orbit_thankyou_for($1) t`, [alertId]);
  check('CLOSED recipient still gets the thank-you', /found safe and sound/.test(thankyou?.t ?? ''), thankyou?.t ?? 'none');
  const ownResponse = await c.query(`select person_id, response from orbit_responses where orbit_alert_id=$1`, [alertId]);
  check('CLOSED recipient still sees their own response rows', ownResponse.rows.every((r) => r.person_id === 'p_gma'),
    ownResponse.rows.map((r) => r.person_id).join(',') || 'none');
  const closedPhoto = await one(`select access, storage_path from orbit_photo_access($1)`, [photoId]);
  check('CLOSED recipient photo access is refused (no access, no path)',
    closedPhoto?.access == null && closedPhoto?.storage_path == null, String(closedPhoto?.access ?? 'null'));

  // ---------------------------------------------------------------- CLOSED: parent keeps everything
  await as('p_mom', { demo: 'true' });
  const parentRow = await one(`select * from orbit_share_for($1)`, [alertId]);
  check('the parent keeps the descriptors after closure', parentRow?.wear_color === 'Blue' && parentRow?.wear_garment === 'Jacket');
  check('the parent keeps the message after closure', typeof parentRow?.minimal_message === 'string' && parentRow.minimal_message.length > 0);
  check('the parent keeps the place and time after closure',
    parentRow?.place_label === 'Maple Grove Park' && parentRow?.last_seen_at != null);
  const parentPhoto = await one(`select access from orbit_photo_access($1)`, [photoId]);
  check('the parent keeps photo access after closure', parentPhoto?.access === 'PARENT', String(parentPhoto?.access ?? 'null'));

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
