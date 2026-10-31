#!/usr/bin/env node
/**
 * ops/orbit-audience-proof.mjs — Scenario 8: the co-parent IS in the audience, and is notified.
 *
 * Proves, against the live stack of database functions:
 *   * the Ellison `orbit_notify_eligible` policy (fixture-owned) resolves Andre, Loretta and Bryan;
 *   * activation freezes all three and records each with notification_outcome = SIMULATED;
 *   * Andre can read his own audience row (and only his own);
 *   * Loretta (audience, not a parent) cannot resolve the list; Dana gets the no-oracle empty result;
 *   * cleanup restores the baseline checksum byte-for-byte, then the demo policy is re-seeded.
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const env = readFileSync('.env', 'utf8');
const row = env.split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='));
const url = row.slice(row.indexOf('=') + 1).replace(/["'\s\r]/g, '');
const map = JSON.parse(readFileSync('data/identity-map.json', 'utf8'));
const subFor = (pid) => Object.entries(map).find(([, p]) => p === pid)?.[0];
const db = (...args) => execFileSync('npx', ['tsx', 'scripts/db.ts', ...args], { encoding: 'utf8' });
const checksum = () => JSON.parse(db('checksum').trim());

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

console.log('=== Orbit audience proof — Scenario 8 (co-parent notified) ===');
db('cleanup:simulated');
const b0 = checksum();
db('seed:simulated');

const admin = await connect(null);
const ids = { alerts: [], jobs: [] };
try {
  const pol = (await admin.query(`select household_id, value from household_policies where rule='orbit_notify_eligible'`)).rows;
  check('1 the Ellison policy is seeded (h_a)', pol.length === 1 && pol[0].household_id === 'h_a', JSON.stringify(pol));
  check('1 the policy names the co-parent', pol[0]?.value === 'p_dad,p_gma,p_bryan', pol[0]?.value);

  const kendra = await connect('p_mom');
  const list = (await kendra.query(`select person_id from orbit_audience_for('p_nora') order by notify_order`)).rows.map((r) => r.person_id);
  check('2 the parent resolves the full list including Andre', list.join(',') === 'p_dad,p_gma,p_bryan', list.join(','));

  const d = (await kendra.query(`select * from draft_orbit_share('p_nora','yellow','raincoat','ponytail','purple','backpack',null)`)).rows[0];
  ids.alerts.push(d.id);
  const p = (await kendra.query(`select * from preview_orbit_share($1)`, [d.id])).rows[0];
  const alertId = (await kendra.query(`select activate_orbit_alert($1,$2,$3) v`, [d.id, p.draft_version, p.message_hash])).rows[0].v;
  ids.alerts.push(alertId);
  const job = (await admin.query(`select job_id from orbit_alerts where id=$1`, [alertId])).rows[0].job_id;
  ids.jobs.push(job);

  const aud = (await admin.query(`select person_id, notification_outcome, notified_at, notify_order
    from orbit_audience_members where orbit_alert_id=$1 order by notify_order`, [alertId])).rows;
  check('3 the frozen audience is exactly the policy list', aud.map((a) => a.person_id).join(',') === 'p_dad,p_gma,p_bryan', aud.map((a) => a.person_id).join(','));
  check('3 ANDRE IS NOTIFIED (row + SIMULATED + timestamp)',
    aud.some((a) => a.person_id === 'p_dad' && a.notification_outcome === 'SIMULATED' && a.notified_at !== null),
    JSON.stringify(aud.find((a) => a.person_id === 'p_dad') ?? {}));
  check('3 every member is recorded as SIMULATED with a timestamp', aud.every((a) => a.notification_outcome === 'SIMULATED' && a.notified_at !== null));

  await kendra.end();

  const andre = await connect('p_dad');
  // Andre is BOTH an audience member and Nora's parent. Parents legitimately see the whole frozen
  // audience (the "full view" rule), so the parent path is asserted here; the audience-member-only
  // path is proven with Loretta below, who is in the audience but is nobody's parent.
  const own = (await andre.query(`select person_id from orbit_audience_members where orbit_alert_id=$1`, [alertId])).rows;
  check('4 Andre (a parent) sees the whole frozen audience, including his own row',
    own.length === 3 && own.some((r2) => r2.person_id === 'p_dad'), `${own.length} row(s)`);
  const andreList = (await andre.query(`select person_id from orbit_audience_for('p_nora')`)).rows.length;
  check('4 Andre (a parent) may resolve the list', andreList === 3, `${andreList} row(s)`);
  await andre.end();

  const loretta = await connect('p_gma');
  const lorettaRows = (await loretta.query(`select person_id from orbit_audience_members where orbit_alert_id=$1`, [alertId])).rows;
  check('5 an audience member sees only her own row', lorettaRows.length === 1 && lorettaRows[0].person_id === 'p_gma', `${lorettaRows.length} row(s)`);
  const lorettaList = (await loretta.query(`select person_id from orbit_audience_for('p_nora')`)).rows.length;
  check('5 an audience member cannot resolve the list', lorettaList === 0, `${lorettaList} row(s)`);
  await loretta.end();

  const dana = await connect('p_dana');
  const danaList = (await dana.query(`select person_id from orbit_audience_for('p_nora')`)).rows;
  const missList = (await dana.query(`select person_id from orbit_audience_for('p_does_not_exist')`)).rows;
  check('6 an out-of-network adult gets no rows, identical to a nonexistent child', danaList.length === 0 && JSON.stringify(danaList) === JSON.stringify(missList));
  await dana.end();
} finally {
  const admin2 = await connect(null);
  for (const a of ids.alerts) {
    await admin2.query(`delete from orbit_responses where orbit_alert_id=$1`, [a]).catch(() => {});
    await admin2.query(`delete from orbit_audience_members where orbit_alert_id=$1`, [a]).catch(() => {});
    await admin2.query(`delete from orbit_alerts where id=$1`, [a]).catch(() => {});
  }
  for (const j of ids.jobs) await admin2.query(`delete from coordination_jobs where id=$1`, [j]).catch(() => {});
  await admin2.end();

  db('cleanup:simulated');
  const b1 = checksum();
  const changed = Object.keys(b0).filter((k) => JSON.stringify(b0[k]) !== JSON.stringify(b1[k]));
  check('7 cleanup restores the baseline checksum byte-for-byte', changed.length === 0,
    changed.length ? `changed: ${changed.map((k) => `${k} ${JSON.stringify(b0[k])}->${JSON.stringify(b1[k])}`).join(' | ')}` : 'identical');
  // Leave the demo in its ready state (the policy is what Scenario 8 needs).
  db('seed:simulated');
}

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${failed} failure(s)`);
process.exit(failed === 0 ? 0 : 1);
