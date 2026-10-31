#!/usr/bin/env node
/**
 * ops/0034-dry-run.mjs — rolled-back dry run for controlled descriptors + audience exposure.
 *
 * Proves: only vocabulary values generate the notification; unmapped text (place names, free text) is
 * REFUSED so Rosina must ask; `distinctive` never reaches the message or the hash; and
 * `orbit_audience_for()` answers only the child's parent/guardian, with a no-oracle empty result for
 * everyone else and for a nonexistent child.
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';

const env = readFileSync('.env', 'utf8');
const row = env.split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='));
const url = row.slice(row.indexOf('=') + 1).replace(/["'\s\r]/g, '');
const map = JSON.parse(readFileSync('data/identity-map.json', 'utf8'));
const subFor = (pid) => Object.entries(map).find(([, p]) => p === pid)?.[0];

const sql = readFileSync('supabase/migrations/0034_orbit_controlled_vocabulary.sql', 'utf8')
  .split('\n').filter((l) => !/^\s*(begin|commit);\s*$/.test(l)).join('\n');

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
let failed = 0;
const check = (l, ok, d = '') => { if (!ok) failed += 1; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${d ? ': ' + d : ''}`); };
const as = async (pid) => {
  await c.query('reset role');
  await c.query('set local role authenticated');
  await c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: subFor(pid), role: 'authenticated' })]);
};
const service = async () => c.query('reset role');
const one = async (q, p = []) => (await c.query(q, p)).rows[0];
const expectError = async (label, fn, code) => {
  await c.query('savepoint e');
  let err = null;
  try { await fn(); } catch (e) { err = e; }
  await c.query('rollback to savepoint e');
  check(label, Boolean(err) && (!code || String(err.code) === code || String(err.message).includes(code)), err ? `${err.code}:${String(err.message).split('\n')[0]}` : 'no error');
};

console.log('=== 0034 controlled-descriptor dry run (rolled back) ===');
await c.query('begin');
try {
  await c.query(sql);
  await c.query(`insert into household_policies (household_id, rule, value)
    select h.id, 'orbit_notify_eligible', 'p_gma,p_bryan'
      from households h join household_members m on m.household_id=h.id
     where m.person_id='p_nora' and m.role='child' limit 1`);

  // ---------------------------------------------------------------- 1. vocabulary generates text
  await as('p_mom');
  const d = (await c.query(`select * from draft_orbit_share('p_nora','yellow','raincoat','ponytail','purple','backpack',null)`)).rows[0];
  const prev = (await c.query(`select * from preview_orbit_share($1)`, [d.id])).rows[0];
  check('1 "yellow raincoat, purple backpack" is generated from vocabulary',
    /Wearing: yellow raincoat\./.test(prev.message) && /Carrying: purple backpack\./.test(prev.message), prev.message);
  check('1 hair comes from vocabulary too', /Hair: ponytail\./.test(prev.message));

  // ---------------------------------------------------------------- 2. unmapped text is refused
  await expectError('2 a place name is refused, not cleaned', () => c.query(`select draft_orbit_share('p_nora','yellow','near Lincoln School',null,null,null,null)`), 'ORBIT_VALUE_NOT_IN_VOCAB');
  await expectError('2 an unknown place name is refused', () => c.query(`select draft_orbit_share('p_nora',null,null,null,null,'by Hartwell''s',null)`), 'ORBIT_VALUE_NOT_IN_VOCAB');
  await expectError('2 free text in a color field is refused', () => c.query(`select draft_orbit_share('p_nora','yellow-ish with grass stains',null,null,null,null,null)`), 'ORBIT_VALUE_NOT_IN_VOCAB');
  await expectError('2 a sentence in the garment field is refused', () => c.query(`select draft_orbit_share('p_nora',null,'blue coat with a rip and her name tag',null,null,null,null)`), 'ORBIT_VALUE_NOT_IN_VOCAB');

  // ---------------------------------------------------------------- 3. distinctive never broadcast
  await service();
  await c.query(`update orbit_alerts set distinctive='silver locket near her school' where id=$1`, [d.id]);
  await as('p_mom');
  const prev2 = (await c.query(`select * from preview_orbit_share($1)`, [d.id])).rows[0];
  check('3 legacy distinctive text never reaches the message', !/locket|school/i.test(prev2.message));
  check('3 distinctive does not change the binding hash', prev2.message_hash === prev.message_hash);

  // ---------------------------------------------------------------- 4. activation uses the template
  await service();
  const alertId = (await one(`select activate_orbit_alert($1,$2,$3) v`, [d.id, prev2.draft_version, prev2.message_hash])).v;
  const act = await one(`select minimal_message, message_hash from orbit_alerts where id=$1`, [alertId]);
  check('4 the delivered (simulated) notification is vocabulary-generated only',
    act.minimal_message === prev2.message && !/locket/i.test(act.minimal_message) && act.message_hash === prev2.message_hash);

  // ---------------------------------------------------------------- 5. audience exposure
  await as('p_mom');
  const parentList = (await c.query(`select person_id from orbit_audience_for('p_nora')`)).rows.map((r) => r.person_id);
  check('5 the parent resolves the list', parentList.length === 2, parentList.join(','));

  await as('p_dana');
  const dana = (await c.query(`select person_id from orbit_audience_for('p_nora')`)).rows;
  const missing = (await c.query(`select person_id from orbit_audience_for('p_does_not_exist')`)).rows;
  check('5 an out-of-network adult gets no rows', dana.length === 0);
  check('5 a nonexistent child is identical (no oracle)', JSON.stringify(dana) === JSON.stringify(missing));

  await as('p_gma');
  const member = (await c.query(`select person_id from orbit_audience_for('p_nora')`)).rows;
  check('5 an audience member who is not a parent gets no rows', member.length === 0, `${member.length} row(s)`);

  // guide on a NON-sandbox child
  await service();
  await c.query(`insert into villages (id, name) values ('fx_v_audit','Audit village') on conflict do nothing`);
  await c.query(`insert into households (id, village_id, sandbox) values ('fx_h_audit','fx_v_audit',false)`);
  await c.query(`insert into people (id, display_name, birth_date) values ('fx_audit_child','Audit Child','2016-09-09') on conflict do nothing`);
  await c.query(`insert into children (person_id) values ('fx_audit_child') on conflict do nothing`);
  await c.query(`insert into household_members (person_id, household_id, role) values ('fx_audit_child','fx_h_audit','child') on conflict do nothing`);
  await as('p_demo_guide');
  await c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: subFor('p_demo_guide'), role: 'authenticated', app_metadata: { demo: true, demo_guide: true } })]);
  const guideNonSandbox = (await c.query(`select person_id from orbit_audience_for('fx_audit_child')`)).rows;
  check('5 the guide gets no rows for a NON-sandbox child', guideNonSandbox.length === 0);
  await service();
} finally {
  await c.query('rollback');
  await c.end();
}
console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${failed} failure(s); transaction rolled back`);
process.exit(failed === 0 ? 0 : 1);
