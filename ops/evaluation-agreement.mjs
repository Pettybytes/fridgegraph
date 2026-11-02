#!/usr/bin/env node
/**
 * Evaluation agreement — OPERATOR EVIDENCE, read-only.
 *
 * WHAT THIS IS, AND WHAT IT IS NOT
 * The caller-authorization assertions live in `ops/served-proof-suite.mjs`: they answer "may this
 * caller see / do this?" through real HTTP and real claims. This script answers a different question
 * with a different instrument: after a real authorized pickup flow has run, does the row the policy
 * engine wrote (`candidate_evaluations`) agree with itself and with the job it belongs to?
 *
 * It therefore reads the database directly, in a READ ONLY transaction, with a statement timeout.
 * It never writes, never mints a session, never calls an endpoint, and never prints a connection
 * string. Its output is labelled OPERATOR EVIDENCE so it cannot be mistaken for the served proof.
 *
 * Agreement checked:
 *   - exactly one decision row, and the decision matches the job's status and over_limit_candidate_id
 *   - a stored amount is miles × the declared rate, to the cent
 *   - the basis string is one of the two the code can produce, and the halves are never partial
 *     (cost without miles, or miles without basis, is a defect, not a missing value)
 *   - an OVER_POLICY amount is actually over the household cap
 *
 * Usage:
 *   PROOF_JOB_ID=<job id from the real pickup flow> node ops/evaluation-agreement.mjs
 *
 * Exit: 0 every assertion PASS · 1 any FAIL · 3 BLOCKED (precondition missing) · 2 refused.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

const LABEL = 'OPERATOR EVIDENCE';
const results = { pass: 0, fail: 0, blocked: 0 };
const pass = (l, d = '') => { results.pass += 1; console.log(`  PASS  ${l}${d ? ' — ' + d : ''}`); };
const fail = (l, d = '') => { results.fail += 1; console.log(`  FAIL  ${l}${d ? ' — ' + d : ''}`); };
const blocked = (l, r) => { results.blocked += 1; console.log(`  BLOCK ${l} — ${r}`); };
const check = (l, ok, d = '') => (ok ? pass(l, d) : fail(l, d));

const jobId = process.env.PROOF_JOB_ID;
const projectUrl = (() => {
  try {
    const line = readFileSync('.env', 'utf8').split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='));
    return line ? line.slice('SUPABASE_DB_URL='.length).replace(/["'\s\r]/g, '') : null;
  } catch { return null; }
})();
const url = process.env.PROOF_DB_URL ?? projectUrl;

console.log(`${LABEL} — evaluation agreement (read-only database inspection)`);
console.log('  separate from the served caller-authorization assertions; no HTTP, no session, no write');

if (!url) {
  blocked('database connection', 'SUPABASE_DB_URL absent from .env and PROOF_DB_URL not set');
  console.log('\nBLOCKED at connection: nothing about the row is claimed.');
  process.exit(3);
}
if (process.env.PROOF_DB_URL && projectUrl && process.env.PROOF_DB_URL.replace(/\s/g, '') === projectUrl) {
  console.error('REFUSED: PROOF_DB_URL is the project database. This check reads the project database in a');
  console.error('read-only transaction; point PROOF_DB_URL at a different database only if you mean to.');
  process.exit(2);
}
if (!jobId) {
  blocked('job', 'PROOF_JOB_ID not set — create the job through the real request + reply path first');
  console.log('\nBLOCKED: no job, so no row is inspected and nothing is claimed.');
  process.exit(3);
}

const client = new pg.Client({ connectionString: url, application_name: 'fg-eval-agreement-proof' });
try {
  await client.connect();
} catch (e) {
  blocked('database connection', `could not connect (${e.code ?? e.message})`);
  process.exit(3);
}

const BASIS_OK = (b) => typeof b === 'string' && /^FridgeGraph/.test(b)
  && (/stored road distance/i.test(b) || /haversine/i.test(b));
let snapshot = null;

try {
  await client.query('begin transaction read only');
  await client.query("set local statement_timeout = '15000ms'");

  const job = (await client.query(
    `select id, status, child_id, request_version, discovery_timeout_seconds,
            over_limit_candidate_id, failure_reason, version
       from coordination_jobs where id = $1`, [jobId])).rows[0];
  if (!job) {
    blocked('job row', `no coordination_jobs row for ${jobId}`);
    throw new Error('missing job');
  }
  pass('the job exists and is readable', `${job.status} · v${job.version}`);

  const evals = (await client.query(
    `select candidate_id, reason_code, available, decline_reason, late_reply,
            distance_miles::text as miles, estimated_ride_cost_usd::text as cost,
            cost_basis, location_provenance, cost_calculated_at
       from candidate_evaluations where job_id = $1 order by candidate_id`, [jobId])).rows;
  const decisions = evals.filter((e) => ['RECOMMENDED', 'APPROVAL_PENDING', 'OVER_POLICY'].includes(e.reason_code));
  check('the job carries exactly one decision row', decisions.length === 1,
    `${decisions.length} decision row(s) of ${evals.length}`);
  check('no evaluation is still PENDING after ranking',
    evals.every((e) => e.reason_code !== 'PENDING'), `${evals.filter((e) => e.reason_code === 'PENDING').length} pending`);

  if (decisions.length === 1) {
    const d = decisions[0];
    snapshot = d;
    check('the decision candidate is the job’s over-limit candidate, when one is set',
      job.over_limit_candidate_id === null || job.over_limit_candidate_id === d.candidate_id,
      `job ${job.over_limit_candidate_id ?? '—'} / row ${d.candidate_id}`);
    check('the decision agrees with the job status',
      (job.status === 'awaiting_approval' && ['APPROVAL_PENDING', 'RECOMMENDED', 'OVER_POLICY'].includes(d.reason_code))
      || (job.status === 'confirmed' && d.reason_code === 'RECOMMENDED')
      || ['failed', 'expired'].includes(job.status),
      `status ${job.status} vs ${d.reason_code}`);

    // Money and miles are written together or not at all; a half-derived figure is a defect.
    const halvesAgree = (d.cost === null) === (d.miles === null);
    check('amount and miles are both present or both absent', halvesAgree,
      `cost ${d.cost ?? 'null'} / miles ${d.miles ?? 'null'}`);
    check('a stored amount carries a basis', d.cost === null || Boolean(d.cost_basis),
      d.cost_basis ?? 'no basis');

    if (d.cost !== null && d.miles !== null) {
      const expected = (await client.query('select round($1::numeric * 1.40, 2)::text as c', [d.miles])).rows[0].c;
      check('the amount is miles × the declared $1.40 rate, to the cent', expected === d.cost,
        `${d.miles} mi × 1.40 = ${expected}, stored ${d.cost}`);
      check('the basis is one of the two the code can produce', BASIS_OK(d.cost_basis),
        String(d.cost_basis));
      check('a priced row carries its calculation timestamp', Boolean(d.cost_calculated_at),
        d.cost_calculated_at ? new Date(d.cost_calculated_at).toISOString() : 'null');
    }

    if (d.reason_code === 'OVER_POLICY') {
      const cap = (await client.query(
        `select hp.value::text as cap from household_policies hp
          where hp.rule = 'ride_cost_cap_usd'
            and hp.household_id in (select hm.household_id from household_members hm
                                     where hm.person_id = $1 and hm.role = 'child')
          limit 1`, [job.child_id])).rows[0]?.cap;
      if (cap === undefined) {
        blocked('over-cap comparison', 'no ride_cost_cap_usd policy for the child’s households');
      } else {
        check('an OVER_POLICY amount is over the household cap',
          d.cost !== null && Number(d.cost) > Number(cap), `${d.cost} vs cap ${cap}`);
      }
    }
  }

  // The row must be stable while it is observed: no write path ran during the read.
  const again = (await client.query(
    `select candidate_id, reason_code, distance_miles::text as miles,
            estimated_ride_cost_usd::text as cost, cost_basis
       from candidate_evaluations where job_id = $1 order by candidate_id`, [jobId])).rows;
  const decisionAgain = snapshot ? again.find((e) => e.candidate_id === snapshot.candidate_id) : null;
  const comparable = (r) => (r ? JSON.stringify({
    candidate_id: r.candidate_id, reason_code: r.reason_code,
    miles: r.miles, cost: r.cost, cost_basis: r.cost_basis,
  }) : 'none');
  check('the decision row did not change during the read-only inspection',
    comparable(snapshot) === comparable(decisionAgain),
    snapshot ? `${snapshot.candidate_id} stable` : 'no decision to compare');
} catch (e) {
  if (e.message !== 'missing job') fail('inspection aborted', e.message);
} finally {
  await client.query('rollback').catch(() => undefined);
  await client.end().catch(() => undefined);
}

const total = results.pass + results.fail + results.blocked;
console.log(`\n${LABEL} SUMMARY: ${results.pass} PASS · ${results.fail} FAIL · ${results.blocked} BLOCKED of ${total}`);
console.log('These are database facts about the row. They are not caller-authorization results.');
process.exit(results.fail > 0 ? 1 : results.blocked > 0 ? 3 : 0);
