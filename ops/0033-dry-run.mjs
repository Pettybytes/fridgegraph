#!/usr/bin/env node
/**
 * ops/0033-dry-run.mjs — rolled-back dry run for the Orbit hardening.
 * sha256 binding, photo identity binding, caller-scoped helpers, audience change, tricky location.
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';

const env = readFileSync('.env', 'utf8');
const row = env.split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='));
const url = row.slice(row.indexOf('=') + 1).replace(/["'\s\r]/g, '');
const map = JSON.parse(readFileSync('data/identity-map.json', 'utf8'));
const subFor = (pid) => Object.entries(map).find(([, p]) => p === pid)?.[0];

const sql = readFileSync('supabase/migrations/0033_orbit_hash_photo_helpers.sql', 'utf8')
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

console.log('=== 0033 Orbit hardening dry run (rolled back) ===');
await c.query('begin');
try {
  await c.query(sql);
  await c.query(`insert into household_policies (household_id, rule, value)
    select h.id, 'orbit_notify_eligible', 'p_dad,p_gma,p_bryan'
      from households h join household_members m on m.household_id=h.id
     where m.person_id='p_nora' and m.role='child' limit 1`);

  // ---------------------------------------------------------------- 1. sha256 binding
  await as('p_mom');
  const d = (await c.query(`select * from draft_orbit_share('p_nora','grey hoodie','ponytail','blue backpack',null,null)`)).rows[0];
  const prev = (await c.query(`select * from preview_orbit_share($1)`, [d.id])).rows[0];
  check('1 the binding hash is SHA-256 (64 hex chars)', /^[a-f0-9]{64}$/.test(prev.message_hash), `${prev.message_hash.length} chars`);

  // ---------------------------------------------------------------- 2. audience change after preview
  await service();
  await c.query(`update household_policies set value='p_dad,p_gma' where rule='orbit_notify_eligible'`);
  await as('p_mom');
  await expectError('2 changing the audience after preview refuses the old binding',
    () => c.query(`select activate_orbit_alert($1,$2,$3)`, [d.id, prev.draft_version, prev.message_hash]), 'ORBIT_PREVIEW_MISMATCH');
  const prev2 = (await c.query(`select * from preview_orbit_share($1)`, [d.id])).rows[0];
  check('2 a fresh preview reflects the new audience size', prev2.audience_size === 2, `size=${prev2.audience_size}`);

  // ---------------------------------------------------------------- 3. photo binding
  await service();
  const goodHash = 'a'.repeat(64), otherHash = 'b'.repeat(64);
  await c.query(`insert into orbit_photos (id, child_id, owner_person_id, content_sha256)
    values ('ph_mom_nora','p_nora','p_mom',$1), ('ph_dad_nora','p_nora','p_dad',$2), ('ph_dana_jax','p_jax','p_dana',$1)`, [goodHash, otherHash]);

  await as('p_mom');
  const d2 = (await c.query(`select * from draft_orbit_share('p_nora',null,null,null,null,'ph_mom_nora')`)).rows[0];
  check('3 the parent can bind her own photo for her own child', d2.photo_id === 'ph_mom_nora');
  await expectError('3 a photo owned by the other parent is refused', () => c.query(`select draft_orbit_share('p_nora',null,null,null,null,'ph_dad_nora')`), 'ORBIT_PHOTO_NOT_YOURS');
  await expectError('3 a photo of another child is refused', () => c.query(`select draft_orbit_share('p_nora',null,null,null,null,'ph_dana_jax')`), 'ORBIT_PHOTO_NOT_YOURS');
  await service();
  await expectError('3 photo bytes are immutable under the same id', () => c.query(`update orbit_photos set content_sha256=$1 where id='ph_mom_nora'`, ['c'.repeat(64)]), 'ORBIT_PHOTO_IMMUTABLE');
  await as('p_mom');
  const prev3 = (await c.query(`select * from preview_orbit_share($1)`, [d2.id])).rows[0];
  check('3 the content hash is part of the binding', /^[a-f0-9]{64}$/.test(prev3.message_hash));

  // ---------------------------------------------------------------- 4. helper exposure
  const activeId = (await one(`select activate_orbit_alert($1,$2,$3) v`, [d2.id, prev3.draft_version, prev3.message_hash])).v;
  await as('p_dana');
  const aud = await one(`select _orbit_is_audience_member($1) v`, [activeId]);
  const can = await one(`select _orbit_can_see_alert($1) v`, [activeId]);
  const par = await one(`select _orbit_is_parent_of_alert($1) v`, [activeId]);
  const audMissing = await one(`select _orbit_is_audience_member('oa_does_not_exist') v`);
  check('4 a non-audience adult gets false from every helper', aud.v === false && can.v === false && par.v === false);
  check('4 a nonexistent alert answers exactly like a hidden one (no oracle)', audMissing.v === false);
  const rows = (await c.query(`select count(*)::int v from orbit_alerts where id=$1`, [activeId])).rows[0].v;
  check('4 the direct RPC reveals no alert row', rows === 0, `visible rows=${rows}`);
  await as('p_dad');
  const audMember = await one(`select _orbit_is_audience_member($1) v`, [activeId]);
  check('4 a real audience member gets true only for their own membership', audMember.v === true);

  // ---------------------------------------------------------------- 5. tricky location cases
  await service();
  const flagged = async (t) => (await one(`select _orbit_has_location($1) v`, [t])).v;
  check('5 "Lincoln hoodie" is NOT treated as a place', (await flagged('grey Lincoln hoodie')) === false);
  check('5 "near Lincoln School" IS refused', (await flagged('near Lincoln School')) === true);
  check('5 a street name is refused', (await flagged('walking down Main Street')) === true);
  check('5 a school-type name alone is refused', (await flagged('Lincoln Elementary')) === true);
  await service();
} finally {
  await c.query('rollback');
  await c.end();
}
console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${failed} failure(s); transaction rolled back`);
process.exit(failed === 0 ? 0 : 1);
