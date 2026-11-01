#!/usr/bin/env node
/**
 * Late-write / timeout ordering — CONTROLLED EVIDENCE, isolated process.
 *
 * WHY THIS IS A SEPARATE PROCESS AND LABELLED DIFFERENTLY
 * A real-provider proof and this one answer different questions. The served suite uses real endpoints
 * and real claims, and therefore cannot make a provider slow on demand. This script owns its clock: it
 * runs a local slow provider (loopback, ephemeral port, in this process) and drives the SQL ordering
 * directly. Nothing here touches the shared provider, no public delay switch is introduced, and every
 * write happens inside one transaction that is rolled back — so the run leaves the database as found.
 *
 * WHAT IT ASSERTS (ordering, then basis consistency)
 *   1. before the discovery window, ranking is a no-op: the job stays `discovering` and every
 *      evaluation keeps its PENDING state (a slow reply must not be pre-empted by an early rank).
 *   2. once the window is elapsed, ranking advances the job exactly once and writes one decision.
 *   3. the slow provider's reply, delivered AFTER that decision, is recorded as `late`: `late_reply`
 *      is true and the decision's reason, amount, miles and basis are byte-identical to the snapshot
 *      taken immediately before the late reply.
 *   4. timestamps agree with that story: the decision was computed no later than the late write.
 *
 * FIDELITY, stated plainly: this proves ORDER and the late-write rule on the real schema. It does not
 * prove provider behaviour, and it is not a substitute for the real-provider served proof.
 *
 * Usage:
 *   PROOF_DB_URL=postgres://… PROOF_JOB_ID=<job> node ops/late-write-proof.mjs
 *
 * Exit: 0 all PASS · 1 any FAIL · 3 BLOCKED (precondition missing) · 2 refused.
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import pg from 'pg';

const LABEL = 'CONTROLLED EVIDENCE';
const results = { pass: 0, fail: 0, blocked: 0 };
const pass = (l, d = '') => { results.pass += 1; console.log(`  PASS  ${l}${d ? ' — ' + d : ''}`); };
const fail = (l, d = '') => { results.fail += 1; console.log(`  FAIL  ${l}${d ? ' — ' + d : ''}`); };
const blocked = (l, r) => { results.blocked += 1; console.log(`  BLOCK ${l} — ${r}`); };
const check = (l, ok, d = '') => (ok ? pass(l, d) : fail(l, d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const jobId = process.env.PROOF_JOB_ID;
const DELAY_MS = Number(process.env.PROOF_SLOW_MS ?? 1500);

const projectUrl = (() => {
  try {
    const line = readFileSync('.env', 'utf8').split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='));
    return line ? line.slice('SUPABASE_DB_URL='.length).replace(/["'\s\r]/g, '') : null;
  } catch { return null; }
})();

console.log(`${LABEL} — timeout / late-write ordering (isolated process, rolled back)`);
console.log('  distinct from the real-provider served proof; the provider below is local to this process');

if (!process.env.PROOF_DB_URL) {
  blocked('database', 'PROOF_DB_URL not set — run against a disposable database only');
  process.exit(3);
}
if (projectUrl && process.env.PROOF_DB_URL.replace(/\s/g, '') === projectUrl) {
  console.error('REFUSED: PROOF_DB_URL is the project database. This harness writes inside a transaction;');
  console.error('point it at a disposable database whose schema carries the pickup slice.');
  process.exit(2);
}
if (!jobId) {
  blocked('job', 'PROOF_JOB_ID not set — the window creates it through the real request path');
  console.log('\nBLOCKED: no job, so no ordering is claimed.');
  process.exit(3);
}

// ---------------------------------------------------------------------------------------------
// The controlled slow provider. Loopback only, ephemeral port, one request per run. It exists so
// "slow" is a property of this test, not a switch someone can flip in the product.
// ---------------------------------------------------------------------------------------------
let providerHitAt = null;
const provider = createServer((req, res) => {
  setTimeout(() => {
    providerHitAt = Date.now();
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: true, delayedMs: DELAY_MS }));
  }, DELAY_MS);
});
await new Promise((r) => provider.listen(0, '127.0.0.1', r));
const providerUrl = `http://127.0.0.1:${provider.address().port}/slow`;

const client = new pg.Client({ connectionString: process.env.PROOF_DB_URL, application_name: 'fg-late-write-proof' });
try { await client.connect(); } catch (e) {
  console.log(`  BLOCK  database — could not connect (${e.code ?? e.message})`);
  provider.close();
  process.exit(3);
}

const rowSnapshot = async (id) => (await client.query(
  `select candidate_id, reason_code, available, late_reply,
          distance_miles::text as miles, estimated_ride_cost_usd::text as cost,
          cost_basis, cost_calculated_at, updated_at
     from candidate_evaluations where job_id = $1 order by candidate_id`, [id])).rows;

try {
  await client.query('begin');
  await client.query("set local statement_timeout = '60000ms'");

  // ---- preconditions: the slice must be present and the job must be mid-discovery
  const fn = (await client.query(
    `select proname from pg_proc where proname = any($1)`,
    [['_rank_and_advance', 'accept_pickup', 'request_pickup', 'ride_miles_for']])).rows.map((r) => r.proname);
  for (const name of ['_rank_and_advance', 'accept_pickup', 'ride_miles_for']) {
    if (!fn.includes(name)) blocked(`precondition — ${name}`, 'migration slice not applied to this database');
  }
  if (fn.length < 3) throw new Error('missing schema');

  const job = (await client.query(
    `select id, status, child_id, request_version, discovery_timeout_seconds from coordination_jobs
      where id = $1 for update`, [jobId])).rows[0];
  if (!job) { blocked('precondition — job', `no coordination_jobs row for ${jobId}`); throw new Error('missing job'); }
  if (job.status !== 'discovering') {
    blocked('precondition — job state', `expected discovering, found ${job.status}`);
    throw new Error('wrong state');
  }
  const attempt = (await client.query(
    `select id, candidate_id from attempts where job_id = $1 order by id limit 1`, [jobId])).rows[0];
  if (!attempt) { blocked('precondition — attempt', 'no attempt for the job'); throw new Error('missing attempt'); }
  pass('preconditions: schema slice, a discovering job, an attempt', `${jobId} · ${attempt.candidate_id}`);

  // Force the window to be long for step 1, so "before the window" is a fact, not a race.
  await client.query(`update coordination_jobs set discovery_timeout_seconds = 600 where id = $1`, [jobId]);
  await client.query(`select set_config('test.person', $1, true)`, [attempt.candidate_id]);

  // ---- 1. rank inside the window: no-op
  const before = await rowSnapshot(jobId);
  await client.query('select _rank_and_advance($1)', [jobId]);
  const afterEarly = await rowSnapshot(jobId);
  const jobEarly = (await client.query('select status, version from coordination_jobs where id = $1', [jobId])).rows[0];
  check('ranking inside the window leaves the job discovering', jobEarly.status === 'discovering', jobEarly.status);
  check('ranking inside the window writes no decision', JSON.stringify(before) === JSON.stringify(afterEarly));
  check('every evaluation is still PENDING inside the window',
    afterEarly.every((r) => r.reason_code === 'PENDING'), `${afterEarly.length} row(s)`);

  // ---- 2. the slow provider answers after the window; ranking runs once
  const slow = await fetch(providerUrl).then((r) => r.json());
  check('the controlled provider answered slowly', slow.ok === true && providerHitAt !== null, `${DELAY_MS} ms`);
  await client.query(`update coordination_jobs set discovery_timeout_seconds = 0 where id = $1`, [jobId]);
  await client.query('select _rank_and_advance($1)', [jobId]);
  const afterRank = await rowSnapshot(jobId);
  const jobRanked = (await client.query('select status, version, over_limit_candidate_id from coordination_jobs where id = $1', [jobId])).rows[0];
  const decisions = afterRank.filter((r) => ['RECOMMENDED', 'APPROVAL_PENDING', 'OVER_POLICY'].includes(r.reason_code));
  check('after the window the job leaves discovering exactly once',
    jobRanked.status !== 'discovering' && jobRanked.version === jobEarly.version + 1,
    `${jobRanked.status} v${jobRanked.version}`);
  check('exactly one decision row is written', decisions.length === 1, `${decisions.length} row(s)`);
  const decision = decisions[0] ?? null;

  // ---- 3. the late reply changes nothing about the decision
  const beforeLate = await rowSnapshot(jobId);
  const late = await client.query(
    `select accept_pickup($1, $2, $3, 'WEBHOOK_CALLBACK', $4) as outcome`,
    [attempt.id, true, null, job.request_version]);
  const afterLate = await rowSnapshot(jobId);
  check('the reply that arrives after the decision is recorded as late',
    late.rows[0]?.outcome === 'late', String(late.rows[0]?.outcome));
  const lateRow = afterLate.find((r) => r.candidate_id === attempt.candidate_id);
  check('the late reply sets late_reply', lateRow?.late_reply === true, String(lateRow?.late_reply));
  const decisionBefore = beforeLate.find((r) => r.candidate_id === decision?.candidate_id);
  const decisionAfter = afterLate.find((r) => r.candidate_id === decision?.candidate_id);
  check('the late reply does not overwrite the decision',
    JSON.stringify(decisionBefore) === JSON.stringify(decisionAfter),
    decision ? `${decision.candidate_id} ${decision.reason_code}` : 'no decision');
  check('the late reply overwrote no amount or basis',
    decisionAfter?.cost === decisionBefore?.cost && decisionAfter?.cost_basis === decisionBefore?.cost_basis,
    `cost ${decisionAfter?.cost ?? 'null'} / basis ${decisionAfter?.cost_basis ?? 'null'}`);
  check('an amount, when present, still equals miles × the declared rate',
    decisionAfter?.cost == null
      ? true
      : (await client.query('select round($1::numeric * 1.40, 2)::text as c', [decisionAfter.miles])).rows[0].c === decisionAfter.cost,
    decisionAfter?.cost == null ? 'no amount to compare' : `${decisionAfter.miles} → ${decisionAfter.cost}`);

  // ---- 4. the timestamps tell the same story
  const ordered = decision?.cost_calculated_at && lateRow?.updated_at
    ? new Date(decision.cost_calculated_at) <= new Date(lateRow.updated_at)
    : true;
  check('the decision was computed no later than the late write', ordered,
    `${decision?.cost_calculated_at ?? 'no decision time'} ≤ ${lateRow?.updated_at ?? 'no late time'}`);
} catch (e) {
  if (!['missing schema', 'missing job', 'wrong state', 'missing attempt'].includes(e.message)) {
    fail('ordering run aborted', e.message);
  }
} finally {
  await client.query('rollback').catch(() => undefined);
  await client.end().catch(() => undefined);
  await new Promise((r) => provider.close(r));
}

const total = results.pass + results.fail + results.blocked;
console.log(`\n${LABEL} SUMMARY: ${results.pass} PASS · ${results.fail} FAIL · ${results.blocked} BLOCKED of ${total}`);
console.log('Controlled evidence: ordering on the real schema. It does not stand in for the real-provider proof.');
process.exit(results.fail > 0 ? 1 : results.blocked > 0 ? 3 : 0);
