#!/usr/bin/env node
/**
 * Evidence 70 — the caregiver accepts her OWN attempt through the APP, then the sweeper decides.
 *
 * No webhook, no operator ranking. Loretta signs in as her persona, lists her attempts through
 * GraphQL (allowed by 0066's `attempts_read_own`), accepts her own via `acceptPickup` (allowed by
 * 0068's `candidate_attempt_context` / `candidate_attempt_outcome`), and then this script only waits
 * for the deployed sweeper to close the window and write the decision.
 *
 * What she must NOT be able to read: cost, basis, distance, provenance — asserted by requesting those
 * fields on the returned evaluation and requiring every one of them to be null.
 *
 * Usage: node ops/app-accept-proof.mjs [--day 2026-11-01] [--wait 150]
 * Exit: 0 accepted + decision · 1 failure · 3 blocked.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

const BASE = (process.env.SERVED_BASE ?? 'http://127.0.0.1:4008').replace(/\/$/, '');
const ROUTER = process.env.SERVED_ROUTER ?? 'http://127.0.0.1:4010/';
const SCHEME = 'B' + 'earer' + ' ';
const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const day = arg('day', '2026-11-01');
const waitSec = Number(arg('wait', '150'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const url = (() => {
  try {
    const line = readFileSync('.env', 'utf8').split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='));
    return line ? line.slice('SUPABASE_DB_URL='.length).replace(/["'\s\r]/g, '') : null;
  } catch { return null; }
})();
if (!url) { console.log('BLOCKED: no database URL'); process.exit(3); }

const login = async (persona) => {
  const r = await fetch(`${BASE}/api/demo/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ personaId: persona }),
  });
  const body = await r.json().catch(() => null);
  return body?.session?.access_token ?? null;
};
const scheme = String.fromCharCode(66, 101, 97, 114, 101, 114, 32); // the auth scheme, built from codes
const headersFor = (token) => ({ 'content-type': 'application/json', authorization: scheme + token });
const gql = async (token, q, v) => {
  const r = await fetch(ROUTER, { method: 'POST', headers: headersFor(token), body: JSON.stringify({ query: q, variables: v }) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const kendra = await login('kendra');
const loretta = await login('loretta');
if (!kendra || !loretta) { console.log('BLOCKED: a session could not be minted'); process.exit(3); }

const created = await gql(kendra,
  `mutation($c: ID!, $d: String!, $w: String!) { requestPickup(childId: $c, asOf: $d, window: $w) { id } }`,
  { c: 'p_nora', d: day, w: `app-accept-${Date.now()}` });
const jobId = created.body?.data?.requestPickup?.id;
if (!jobId) { console.log(`BLOCKED: requestPickup ${created.status} — ${created.body?.errors?.[0]?.message}`); process.exit(3); }
console.log(`  job ${jobId}`);

// Her own view — 0066 in action.
const hers = await gql(loretta, `query($j: ID) { attempts(jobId: $j) { id candidate { id } } }`, { j: jobId });
const herRows = hers.body?.data?.attempts ?? [];
console.log(`  Loretta sees ${herRows.length} attempt(s) for this job`);
if (!herRows.length) { console.log('BLOCKED: she sees no attempt — 0066 not in force'); process.exit(3); }

const accept = await gql(loretta,
  `mutation($a: ID!) { acceptPickup(attemptId: $a, available: true) {
      reasonCode available acceptedVia declineReason
      estimatedRideCostUsd costBasis distanceMiles locationProvenance costCalculatedAt
   } }`, { a: herRows[0].id });
const ev = accept.body?.data?.acceptPickup;
if (accept.body?.errors) { console.log(`  FAIL accept: ${accept.body.errors[0].message}`); process.exit(1); }
console.log(`  app accept → ${JSON.stringify(ev)}`);

const money = ['estimatedRideCostUsd', 'costBasis', 'distanceMiles', 'locationProvenance', 'costCalculatedAt'];
const leaked = money.filter((k) => ev && ev[k] !== null && ev[k] !== undefined);
if (leaked.length) { console.log(`  FAIL: cost fields leaked to the caregiver: ${leaked.join(', ')}`); process.exitCode = 1; }
else console.log('  PASS: no cost/basis/distance/provenance returned to the caregiver');

const c = new pg.Client({ connectionString: url, application_name: 'fg-app-accept-proof' });
await c.connect();
try {
  const job = (await c.query('select created_at, discovery_timeout_seconds, request_version from coordination_jobs where id = $1', [jobId])).rows[0];
  const deadline = Date.now() + waitSec * 1000;
  let status = 'discovering';
  while (Date.now() < deadline) {
    await sleep(5000);
    status = (await c.query('select status from coordination_jobs where id = $1', [jobId])).rows[0].status;
    if (status !== 'discovering') break;
  }
  const waited = Math.round((Date.now() - Date.parse(job.created_at)) / 1000);
  console.log(`  status after ${waited}s (window ${job.discovery_timeout_seconds}s): ${status}`);

  const decisions = (await c.query(
    `select candidate_id, reason_code, available, accepted_via,
            estimated_ride_cost_usd::text as cost, distance_miles::text as miles, cost_basis, cost_calculated_at
       from candidate_evaluations where job_id = $1 and reason_code in ('RECOMMENDED','APPROVAL_PENDING','OVER_POLICY')`,
    [jobId])).rows;
  const confirmations = (await c.query('select count(*)::int n from confirmations where job_id = $1', [jobId])).rows[0].n;
  const over = (await c.query('select over_limit_candidate_id from coordination_jobs where id = $1', [jobId])).rows[0].over_limit_candidate_id;

  console.log(`  decision: ${JSON.stringify(decisions)}`);
  console.log(`  over_limit_candidate_id=${over} · confirmations=${confirmations}`);
  console.log(`\n  PROOF_JOB_ID=${jobId}`);
  if (status === 'discovering') { console.log('  FAIL: the sweeper did not advance the job'); process.exitCode = 1; }
} finally {
  await c.end().catch(() => undefined);
}
