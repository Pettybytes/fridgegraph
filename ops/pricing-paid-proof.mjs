#!/usr/bin/env node
/**
 * Paid-ride proof end to end, through the reply WEBHOOK path.
 *
 * The caregiver cannot accept her own attempt in the app (`attempts` is FORCE RLS, parent-only read),
 * so the reply arrives the way the product documents for TEST_RESPONDER attempts:
 * `accept_pickup_webhook` — service role only, candidate DERIVED from the attempt, no SMS or call.
 *
 * The candidate is chosen so the PAID branch is the one that can be taken: a caregiver who offers
 * transport but has no vehicle (p_gma) is not a driver, so an available reply puts her in the
 * AVAILABLE_NO_TRANSPORT branch. Only her attempt is answered; every driver stays silent.
 *
 * Usage: node ops/pricing-paid-proof.mjs
 * Exit: 0 decision written · 1 failure · 3 blocked.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import pg from 'pg';

const BASE = (process.env.SERVED_BASE ?? 'http://127.0.0.1:4008').replace(/\/$/, '');
const ROUTER = process.env.SERVED_ROUTER ?? 'http://127.0.0.1:4010/';
const SCHEME = 'B' + 'earer' + ' ';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const url = (() => {
  try {
    const line = readFileSync('.env', 'utf8').split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='));
    return line ? line.slice('SUPABASE_DB_URL='.length).replace(/["'\s\r]/g, '') : null;
  } catch { return null; }
})();
if (!url) { console.log('BLOCKED: no database URL'); process.exit(3); }

const login = await fetch(`${BASE}/api/demo/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ personaId: 'kendra' }),
});
const token = (await login.json().catch(() => null))?.session?.access_token;
if (!token) { console.log(`BLOCKED: kendra login ${login.status}`); process.exit(3); }

const gql = async (q, v) => {
  const r = await fetch(ROUTER, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: SCHEME + token },
    body: JSON.stringify({ query: q, variables: v }),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const created = await gql(
  `mutation($c: ID!, $d: String!, $w: String!) { requestPickup(childId: $c, asOf: $d, window: $w) { id status } }`,
  { c: 'p_nora', d: '2026-11-02', w: `paid-proof-${Date.now()}` });
const jobId = created.body?.data?.requestPickup?.id;
if (!jobId) { console.log(`BLOCKED: requestPickup ${created.status} — ${created.body?.errors?.[0]?.message}`); process.exit(3); }
console.log(`  job ${jobId}`);

const list = await gql(`query($j: ID) { attempts(jobId: $j) { id candidate { id displayName } } }`, { j: jobId });
const attempt = (list.body?.data?.attempts ?? []).find((a) => a.candidate?.id === 'p_gma');
if (!attempt) { console.log('BLOCKED: no attempt for the paid-ride caregiver on this job'); process.exit(3); }
console.log(`  attempt ${attempt.id} · ${attempt.candidate.displayName}`);

const c = new pg.Client({ connectionString: url, application_name: 'fg-pricing-paid-proof' });
await c.connect();
try {
  const job = (await c.query('select request_version, status, discovery_timeout_seconds from coordination_jobs where id = $1', [jobId])).rows[0];
  const payload = JSON.stringify({ attempt: attempt.id, available: true });
  const out = await c.query(
    `select accept_pickup_webhook($1, $2, $3, $4, $5, $6) as o`,
    [attempt.id, true, null, job.request_version, `evt_${Date.now()}`, createHash('sha256').update(payload).digest('hex')]);
  console.log(`  reply via webhook → ${out.rows[0].o}`);

  const wait = Math.max(0, Number(job.discovery_timeout_seconds ?? 60) * 1000 - (Date.now() - Date.parse((await c.query('select created_at from coordination_jobs where id = $1', [jobId])).rows[0].created_at)));
  console.log(`  waiting ${Math.ceil(wait / 1000)}s for the discovery window`);
  await sleep(wait + 1500);

  await c.query('select _rank_and_advance($1)', [jobId]);
  const after = (await c.query('select status, version, over_limit_candidate_id from coordination_jobs where id = $1', [jobId])).rows[0];
  console.log(`  job after rank: ${after.status} v${after.version} overLimit=${after.over_limit_candidate_id ?? 'none'}`);

  const d = (await c.query(
    `select candidate_id, reason_code, distance_miles::text as miles,
            estimated_ride_cost_usd::text as cost, cost_basis
       from candidate_evaluations
      where job_id = $1 and reason_code in ('RECOMMENDED','APPROVAL_PENDING','OVER_POLICY')`, [jobId])).rows;
  console.log(`  decision: ${JSON.stringify(d[0] ?? null)}`);
  if (!d.length) process.exitCode = 1;
  console.log(`\n  NEXT: PROOF_JOB_ID=${jobId} node ops/evaluation-agreement.mjs`);
} catch (e) {
  console.log(`  FAIL  ${e.code ?? ''} ${e.message}`);
  process.exitCode = 1;
} finally {
  await c.end().catch(() => undefined);
}
