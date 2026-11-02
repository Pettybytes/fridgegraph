#!/usr/bin/env node
/**
 * Pricing proof through the REPLY WEBHOOK path.
 *
 * WHY THIS PATH
 * A caregiver cannot accept her own attempt in the app: `attempts` is FORCE RLS with a parent-only
 * read policy, so `accept_pickup` called by the candidate cannot even see the row. The documented
 * reply path is the trusted handler: `accept_pickup_webhook` (EXECUTE to service_role only), where the
 * candidate is DERIVED from the attempt — never supplied by the caller. That is what the
 * TEST_RESPONDER attempts were built for, and it needs no caregiver session and no real SMS/call.
 *
 * WHAT IT DOES
 *   1. Kendra creates a real pickup request (unique window so it cannot be an idempotent no-op).
 *   2. The parent reads the attempts the simulated dispatch opened.
 *   3. One attempt is answered through `accept_pickup_webhook` as the service role.
 *   4. It prints the job id for `ops/evaluation-agreement.mjs`.
 *
 * One open attempt per candidate is respected by construction: it only uses attempts that exist on
 * the new job.
 *
 * Usage: node ops/pricing-webhook-proof.mjs [--child p_nora] [--day 2026-11-02]
 * Exit: 0 reply recorded · 1 failure · 3 blocked.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const BASE = (process.env.SERVED_BASE ?? 'http://127.0.0.1:4008').replace(/\/$/, '');
const ROUTER = process.env.SERVED_ROUTER ?? 'http://127.0.0.1:4010/';
const SCHEME = 'B' + 'earer' + ' ';
const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const child = arg('child', 'p_nora');
const day = arg('day', '2026-11-02');
const windowTag = arg('window', 'proof-' + Date.now());

const url = (() => {
  try {
    const line = readFileSync('.env', 'utf8').split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='));
    return line ? line.slice('SUPABASE_DB_URL='.length).replace(/["'\s\r]/g, '') : null;
  } catch { return null; }
})();
if (!url) { console.log('BLOCKED: no database URL for the service-role reply'); process.exit(3); }

const login = await fetch(`${BASE}/api/demo/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ personaId: 'kendra' }),
});
const session = (await login.json().catch(() => null))?.session?.access_token;
if (!session) { console.log(`BLOCKED: kendra login ${login.status}`); process.exit(3); }

const gql = async (q, v) => {
  const r = await fetch(ROUTER, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: SCHEME + session },
    body: JSON.stringify({ query: q, variables: v }),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const created = await gql(
  `mutation($c: ID!, $d: String!, $w: String!) { requestPickup(childId: $c, asOf: $d, window: $w) { id status } }`,
  { c: child, d: day, w: windowTag });
const jobId = created.body?.data?.requestPickup?.id;
if (!jobId) {
  console.log(`BLOCKED: requestPickup ${created.status} — ${created.body?.errors?.[0]?.message ?? 'no job'}`);
  process.exit(3);
}
console.log(`  job ${jobId} (${created.body.data.requestPickup.status})`);

const list = await gql(
  `query($j: ID) { attempts(jobId: $j) { id candidate { id displayName } destinationMode } }`, { j: jobId });
const attempts = list.body?.data?.attempts ?? [];
if (!attempts.length) {
  console.log('BLOCKED: the simulated dispatch opened no attempt on the new job');
  process.exit(3);
}
const chosen = attempts[0];
console.log(`  attempt ${chosen.id} · ${chosen.candidate?.displayName ?? '?'} · ${chosen.destinationMode}`);

const c = new pg.Client({ connectionString: url, application_name: 'fg-pricing-webhook-proof' });
await c.connect();
try {
  const job = (await c.query('select request_version, status from coordination_jobs where id = $1', [jobId])).rows[0];
  if (!job) { console.log('BLOCKED: job row not found'); process.exit(3); }
  if (job.status !== 'discovering') { console.log(`BLOCKED: job is ${job.status}, not discovering`); process.exit(3); }

  const payload = JSON.stringify({ attempt: chosen.id, available: true });
  const sha = createHash('sha256').update(payload).digest('hex');
  const eventId = `evt_proof_${Date.now()}`;

  const out = await c.query(
    `select accept_pickup_webhook($1, $2, $3, $4, $5, $6) as outcome`,
    [chosen.id, true, null, job.request_version, eventId, sha]);
  console.log(`  accept_pickup_webhook → ${out.rows[0].outcome}`);

  const after = (await c.query('select status, version from coordination_jobs where id = $1', [jobId])).rows[0];
  console.log(`  job now ${after.status} v${after.version}`);
  console.log(`\n  NEXT: PROOF_JOB_ID=${jobId} node ops/evaluation-agreement.mjs`);
} catch (e) {
  console.log(`  FAIL  ${e.code ?? ''} ${e.message}`);
  process.exitCode = 1;
} finally {
  await c.end().catch(() => undefined);
}
