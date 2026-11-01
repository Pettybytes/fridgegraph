#!/usr/bin/env node
/**
 * ops/0053-dry-run.mjs — rolled-back dry run for recorded places.
 *
 * Proves what a CHECK on `kind` cannot:
 *   * the label set is curated — a label carrying digits or a street word cannot exist at all, and no
 *     write path accepts a caller-supplied label;
 *   * a place from ANOTHER family is refused on write (draft and the structural trigger) and is
 *     invisible on read (RLS), with the same answer for "not mine" and "does not exist";
 *   * the last-seen place and time reach the rendered message AND the hash, so a preview minted
 *     before either changed can no longer activate;
 *   * `_orbit_has_location()` still refuses place words in the description fields.
 *
 * Nothing is committed: the migration runs inside a transaction that is rolled back.
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
const as = async (pid) => {
  await c.query('reset role');
  await c.query('set local role authenticated');
  await c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: subFor(pid), role: 'authenticated' })]);
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

console.log('=== 0053 recorded-places dry run (rolled back) ===');
await c.query('begin');
try {
  await c.query(strip('supabase/migrations/0053_orbit_recorded_places.sql'));

  const cat = await one(`select count(*)::int n from recorded_place_catalog`);
  check('catalog is seeded', cat.n >= 7, `${cat.n} labels`);
  await expectError('a label with a street number is refused', () =>
    c.query(`insert into recorded_place_catalog(label) values ('Elm Street 42')`), 'recorded_place_catalog');
  await expectError('a label with a street word is refused', () =>
    c.query(`insert into recorded_place_catalog(label) values ('Halsey Boulevard')`), 'recorded_place_catalog');

  const seeded = await one(`select count(*)::int n from recorded_places where fixture`);
  check('demo places are seeded', seeded.n > 0, `${seeded.n} places`);
  const labels = (await c.query(`select label from recorded_places`)).rows.map((r) => r.label);
  check('every seeded label is curated (no digits)', labels.every((l) => !/[0-9]/.test(l)), labels.slice(0, 3).join(' / '));
  check('the table has no address/coordinate column', (await one(`select count(*)::int n from information_schema.columns
    where table_name='recorded_places' and column_name ~ '(lat|lon|coord|address|street|postal|zip)'`)).n === 0);

  const hA = await one(`select id from recorded_places where household_id='h_a' and label='Lincoln Elementary School'`);
  const hC = await one(`select id from recorded_places where household_id='h_c' order by label limit 1`);
  check('both families used by this proof have a place', Boolean(hA?.id && hC?.id), `h_a=${hA?.id} h_c=${hC?.id}`);

  await as('p_mom');
  const mine = (await c.query(`select id, household_id from recorded_places`)).rows;
  check('a parent sees only her own family\'s places',
    mine.length > 0 && mine.every((r) => r.household_id === 'h_a' || r.household_id === 'h_b'),
    `${mine.length} rows in ${[...new Set(mine.map((r) => r.household_id))].join(',')}`);
  check('another family\'s place is invisible on read', !mine.some((r) => r.id === hC.id));

  // Dana is a parent in h_c (Jax's household): she must see HER family's places and nothing else.
  await as('p_dana');
  const danaRows = (await c.query(`select household_id from recorded_places`)).rows;
  check('another family sees only its own places',
    danaRows.length > 0 && danaRows.every((r) => r.household_id === 'h_c'),
    `${danaRows.length} rows in ${[...new Set(danaRows.map((r) => r.household_id))].join(',')}`);
  check('h_a\'s places are invisible to that family', !danaRows.some((r) => r.household_id === 'h_a'));

  await service();
  const outsider = await one(`select p.id from people p
    where not exists (select 1 from household_members m where m.person_id = p.id)
      and exists (select 1 from identity_map i where i.person_id = p.id)
    order by p.id limit 1`);
  if (outsider?.id) {
    await as(outsider.id);
    check(`a person in no household sees no places (${outsider.id})`,
      (await c.query(`select 1 from recorded_places`)).rows.length === 0);
  }

  await as('p_mom');
  await expectError('a draft naming another family\'s place is refused', () =>
    c.query(`select draft_orbit_share($1, null, null, null, null, null, null, $2, now())`, ['p_nora', hC.id]), 'ORBIT_PLACE_NOT_YOURS');
  await expectError('a draft naming a place that does not exist is refused the same way', () =>
    c.query(`select draft_orbit_share($1, null, null, null, null, null, null, 'rp_nope', now())`, ['p_nora']), 'ORBIT_PLACE_NOT_YOURS');

  const draftId = (await c.query(`select (draft_orbit_share($1, 'Blue', 'Jacket', null, null, null, null, $2, $3)).id as id`,
    ['p_nora', hA.id, '2026-11-01T15:00:00Z'])).rows[0].id;
  const prev1 = await one(`select * from preview_orbit_share($1)`, [draftId]);
  check('the preview names the curated place', /Last seen: Lincoln Elementary School/.test(prev1.message), prev1.message);
  check('the preview names the time', /at 10:00 AM/.test(prev1.message), prev1.message);
  check('the message still asks in human words', /Reply 1 = With me/.test(prev1.message));
  const prevAgain = await one(`select * from preview_orbit_share($1)`, [draftId]);
  check('an unchanged preview keeps its hash', prevAgain.message_hash === prev1.message_hash);

  const park = await one(`select id from recorded_places where household_id='h_a' and label='Maple Grove Park'`);
  await c.query(`select draft_orbit_share($1, 'Blue', 'Jacket', null, null, null, null, $2, $3)`,
    ['p_nora', park.id, '2026-11-01T15:00:00Z']);
  const prev2 = await one(`select * from preview_orbit_share($1)`, [draftId]);
  check('changing the place changes the hash', prev2.message_hash !== prev1.message_hash,
    `${prev1.message_hash.slice(0, 8)} -> ${prev2.message_hash.slice(0, 8)}`);
  check('changing the place changes the wording', prev2.message !== prev1.message);

  await c.query(`select draft_orbit_share($1, 'Blue', 'Jacket', null, null, null, null, $2, $3)`,
    ['p_nora', park.id, '2026-11-01T19:30:00Z']);
  const prev3 = await one(`select * from preview_orbit_share($1)`, [draftId]);
  check('changing only the time changes the hash', prev3.message_hash !== prev2.message_hash);
  check('the new time is in the message', /at 2:30 PM/.test(prev3.message), prev3.message);

  await expectError('a preview minted before the place/time change cannot activate', () =>
    c.query(`select activate_orbit_alert($1, $2, $3)`, [draftId, prev1.draft_version, prev1.message_hash]), 'ORBIT_DRAFT_STALE');

  await expectError('a place typed into a description field is still refused', () =>
    c.query(`select draft_orbit_share($1, 'Blue', 'Jacket near Maple Grove Park', null, null, null, null, $2, now())`,
      ['p_nora', park.id]), 'ORBIT_SHARE_HAS_LOCATION');

  await service();
  const alertRow = await one(`select id, last_seen_place_id from orbit_alerts where id=$1`, [draftId]);
  check('the draft stores the place id', alertRow.last_seen_place_id === park.id);
  await expectError('a direct write of another family\'s place is refused by the trigger', () =>
    c.query(`update orbit_alerts set last_seen_place_id=$1 where id=$2`, [hC.id, alertRow.id]), 'ORBIT_PLACE_NOT_YOURS');

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
