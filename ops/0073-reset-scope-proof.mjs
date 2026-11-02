#!/usr/bin/env node
/**
 * 0073 scope proof — the demo reset removes demo school-report rows and nothing else.
 *
 * Runs inside ONE transaction and rolls back: it writes two proposals and two reports (one demo-
 * authored, one non-demo) and shows which survive the scoped reset. A scoped delete that also removes
 * a non-demo row would be worse than the leftover it fixes.
 *
 * Exit: 0 all PASS · 1 FAIL · 2 refused (needs a database URL).
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

const url = process.env.PROOF_DB_URL ?? (() => {
  try {
    const line = readFileSync('.env', 'utf8').split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='));
    return line ? line.slice('SUPABASE_DB_URL='.length).replace(/["'\s\r]/g, '') : null;
  } catch { return null; }
})();
if (!url) { console.error('REFUSED: no database URL'); process.exit(2); }

let fail = 0;
const check = (l, ok, d = '') => { if (!ok) fail += 1; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${d ? ' — ' + d : ''}`); };

const c = new pg.Client({ connectionString: url, application_name: 'fg-0073-proof' });
await c.connect();
const S = `z73${Date.now().toString(36).slice(-6)}`;

try {
  await c.query('begin');
  await c.query("set local statement_timeout = '20000ms'");

  const demoActor = (await c.query(
    `select person_id from identity_map order by person_id limit 1`)).rows[0]?.person_id;
  if (!demoActor) throw new Error('no demo identity in identity_map');

  // Use an EXISTING person with no demo identity rather than synthesising one: `people` has more
  // NOT NULL columns than a fixture needs, and a proof should not invent schema knowledge.
  const outside = (await c.query(
    `select p.id from people p
      where not exists (select 1 from identity_map m where m.person_id = p.id)
      order by p.id limit 1`)).rows[0]?.id;
  if (!outside) throw new Error('no non-demo person exists to prove the boundary');
  await c.query(
    `insert into school_reports (id, child_id, kind, text, at) values
       ($1, 'p_nora', 'DAY', 'demo-authored report', current_date),
       ($2, 'p_nora', 'DAY', 'non-demo report', current_date)`,
    [`sr_${S}_demo`, `sr_${S}_out`]);
  await c.query(
    `insert into school_report_proposals (id, actor_id, child_id, kind, text, expires_at, confirmed_report_id, confirmed_at)
     values ($1, $2, 'p_nora', 'DAY', 'demo-authored proposal', now() + interval '1 hour', $3, now()),
            ($4, $5, 'p_nora', 'DAY', 'non-demo proposal', now() + interval '1 hour', $6, now())`,
    [`srp_${S}_demo`, demoActor, `sr_${S}_demo`, `srp_${S}_out`, outside, `sr_${S}_out`]);

  const res = (await c.query('select reset_demo_school_reports() as r')).rows[0].r;
  console.log(`  reset returned: ${JSON.stringify(res)}`);

  const left = async (table, id) => (await c.query(`select count(*)::int n from ${table} where id = $1`, [id])).rows[0].n;

  check('a demo-authored proposal is removed', (await left('school_report_proposals', `srp_${S}_demo`)) === 0);
  check('the report that proposal confirmed is removed', (await left('school_reports', `sr_${S}_demo`)) === 0);
  check('a NON-demo proposal survives', (await left('school_report_proposals', `srp_${S}_out`)) === 1);
  check('a NON-demo report survives', (await left('school_reports', `sr_${S}_out`)) === 1);
  check('the scoped reset reports what it removed', Number(res?.proposals) >= 1 && Number(res?.reports) >= 1,
    `proposals=${res?.proposals} reports=${res?.reports}`);
} catch (e) {
  check('scope proof ran', false, e.message);
} finally {
  await c.query('rollback').catch(() => undefined);
  await c.end().catch(() => undefined);
}

console.log(fail ? `\nSCOPE PROOF FAILED — ${fail}` : '\nSCOPE PROOF PASS — demo rows removed, non-demo rows untouched');
process.exit(fail ? 1 : 0);
