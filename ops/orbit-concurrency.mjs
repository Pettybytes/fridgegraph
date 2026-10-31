#!/usr/bin/env node
/**
 * ops/orbit-concurrency.mjs — REAL concurrency: two simultaneous activations on separate connections.
 *
 * Committed rows (not a rolled-back transaction), because two transactions are the point. Every row
 * this script creates is tracked and removed at the end; the baseline is untouched.
 *
 * Proves: exactly one ACTIVE alert per child, the loser refused with ORBIT_ALREADY_ACTIVE, and no
 * second ACTIVE row ever exists.
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';

const env = readFileSync('.env', 'utf8');
const row = env.split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='));
const url = row.slice(row.indexOf('=') + 1).replace(/["'\s\r]/g, '');
const map = JSON.parse(readFileSync('data/identity-map.json', 'utf8'));
const subFor = (pid) => Object.entries(map).find(([, p]) => p === pid)?.[0];

let failed = 0;
const check = (l, ok, d = '') => { if (!ok) failed += 1; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${d ? ': ' + d : ''}`); };

const connect = async (personId) => {
  const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  if (personId) {
    await c.query('set role authenticated');
    await c.query(`select set_config('request.jwt.claims',$1,false)`, [JSON.stringify({ sub: subFor(personId), role: 'authenticated' })]);
  }
  return c;
};

const admin = await connect(null);
console.log('=== Orbit real concurrency ===');

const created = { alerts: [], jobs: [] };
let createdPolicy = false;

try {
  // A per-child policy is required for an audience. Track whether we added it.
  const pol = await admin.query(`select 1 from household_policies where rule='orbit_notify_eligible' limit 1`);
  if (pol.rowCount === 0) {
    await admin.query(`insert into household_policies (household_id, rule, value)
      select h.id, 'orbit_notify_eligible', 'p_dad,p_gma'
        from households h join household_members m on m.household_id=h.id
       where m.person_id='p_nora' and m.role='child' limit 1`);
    createdPolicy = true;
  }

  const kendra = await connect('p_mom');
  const andre = await connect('p_dad');

  const d1 = (await kendra.query(`select * from draft_orbit_share('p_nora','grey hoodie',null,null,null,null)`)).rows[0];
  const d2 = (await andre.query(`select * from draft_orbit_share('p_nora','blue coat',null,null,null,null)`)).rows[0];
  created.alerts.push(d1.id, d2.id);
  const p1 = (await kendra.query(`select * from preview_orbit_share($1)`, [d1.id])).rows[0];
  const p2 = (await andre.query(`select * from preview_orbit_share($1)`, [d2.id])).rows[0];

  const results = await Promise.allSettled([
    kendra.query(`select activate_orbit_alert($1,$2,$3) v`, [d1.id, p1.draft_version, p1.message_hash]),
    andre.query(`select activate_orbit_alert($1,$2,$3) v`, [d2.id, p2.draft_version, p2.message_hash]),
  ]);

  const ok = results.filter((r) => r.status === 'fulfilled');
  const bad = results.filter((r) => r.status === 'rejected');
  check('1 exactly ONE activation succeeds', ok.length === 1 && bad.length === 1, `ok=${ok.length} refused=${bad.length}`);
  if (bad.length === 1) {
    const code = bad[0].reason?.code ?? String(bad[0].reason?.message ?? '');
    check('1 the loser is refused with ORBIT_ALREADY_ACTIVE', String(code).includes('23505') || String(code).includes('ORBIT_ALREADY_ACTIVE'), String(code));
  }
  const active = (await admin.query(`select id from orbit_alerts where child_id='p_nora' and status='ACTIVE'`)).rows;
  check('2 exactly one ACTIVE alert exists for the child', active.length === 1, `${active.length} active`);
  if (active[0]) created.alerts.push(active[0].id);

  const jobs = (await admin.query(`select id from coordination_jobs where idempotency_key like 'orbit:%'`)).rows;
  check('3 exactly one ORBIT_ALERT job was created', jobs.length === 1, `${jobs.length} job(s)`);
  created.jobs.push(...jobs.map((j) => j.id));

  await kendra.end(); await andre.end();
} finally {
  // Tracked cleanup: only the ids this run created.
  for (const j of created.jobs) {
    await admin.query(`delete from orbit_alerts where job_id=$1`, [j]).catch(() => {});
    await admin.query(`delete from coordination_jobs where id=$1`, [j]).catch(() => {});
  }
  for (const a of created.alerts) {
    await admin.query(`delete from orbit_responses where orbit_alert_id=$1`, [a]).catch(() => {});
    await admin.query(`delete from orbit_audience_members where orbit_alert_id=$1`, [a]).catch(() => {});
    await admin.query(`delete from orbit_alerts where id=$1`, [a]).catch(() => {});
  }
  if (createdPolicy) await admin.query(`delete from household_policies where rule='orbit_notify_eligible'`).catch(() => {});
  const left = (await admin.query(`select count(*)::int v from orbit_alerts`)).rows[0].v;
  check('4 cleanup leaves no orbit rows behind', left === 0, `${left} row(s)`);
  await admin.end();
}

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${failed} failure(s)`);
process.exit(failed === 0 ? 0 : 1);
