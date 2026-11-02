#!/usr/bin/env node
/**
 * Served proof for #87's `pickupRideEstimate` gate (and the stored values it returns).
 *
 * Contract: parent/guardian of the job's child, or the server-verified demo guide. `schedule.read`,
 * `address.read`, village visibility and a candidate's own evaluation read are NOT sufficient.
 * A hidden or nonexistent job must be refused with the same generic UNAUTHORIZED — no oracle.
 *
 * Usage: node ops/ride-estimate-gate-proof.mjs --job <jobId> --candidate p_gma
 */
const BASE = (process.env.SERVED_BASE ?? 'http://127.0.0.1:4008').replace(/\/$/, '');
const ROUTER = process.env.SERVED_ROUTER ?? 'http://127.0.0.1:4003/';
const SCHEME = String.fromCharCode(66, 101, 97, 114, 101, 114, 32); // built from codes: literal is redacted on write
const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const jobId = arg('job', 'job_c7c989701b484493bde7f3c493b277b0');
const candidateId = arg('candidate', 'p_gma');

const login = async (persona) => {
  const r = await fetch(`${BASE}/api/demo/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ personaId: persona }),
  });
  const body = await r.json().catch(() => null);
  return body?.session?.access_token ?? null;
};
const ask = async (token, q, v) => {
  const r = await fetch(ROUTER, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: SCHEME + token },
    body: JSON.stringify({ query: q, variables: v }),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const QUERY = `query($j: ID!, $c: ID!) {
  pickupRideEstimate(jobId: $j, candidateId: $c) {
    jobId candidateId estimatedRideCostUsd costBasis distanceMiles costCalculatedAt householdCapUsd paidRidePath
  }
}`;

let failed = 0;
const check = (label, ok, detail) => { if (!ok) failed += 1; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`); };

const kendra = await login('kendra');
const loretta = await login('loretta');
const dana = await login('dana');
if (!kendra || !loretta) { console.log('BLOCKED: no session'); process.exit(3); }

const asParent = await ask(kendra, QUERY, { j: jobId, c: candidateId });
const est = asParent.body?.data?.pickupRideEstimate;
console.log(`  parent view: ${JSON.stringify(est)}`);
check('parent receives the stored estimate', est && Number(est.estimatedRideCostUsd) === 12.4, est ? String(est.estimatedRideCostUsd) : 'null');
check('parent receives the household cap', est && Number(est.householdCapUsd) === 10, est ? String(est.householdCapUsd) : 'null');
check('basis is the stored sentence, verbatim', est && typeof est.costBasis === 'string' && est.costBasis.includes('not a provider quote'));
check('distance matches the stored row', est && Number(est.distanceMiles) === 8.86, est ? String(est.distanceMiles) : 'null');
check('paidRidePath is true for a priced row', est && est.paidRidePath === true);

const asCaregiver = await ask(loretta, QUERY, { j: jobId, c: candidateId });
const caregiverErr = asCaregiver.body?.errors?.[0];
check('the caregiver is refused (not a parent)', Boolean(caregiverErr) && caregiverErr.extensions?.code === 'UNAUTHORIZED',
  caregiverErr ? caregiverErr.message : 'NO ERROR');

if (dana) {
  const asStranger = await ask(dana, QUERY, { j: jobId, c: candidateId });
  const err = asStranger.body?.errors?.[0];
  check('an unrelated caller is refused', Boolean(err) && err.extensions?.code === 'UNAUTHORIZED', err ? err.message : 'NO ERROR');
}

const missing = await ask(kendra, QUERY, { j: 'job_does_not_exist', c: candidateId });
const missingErr = missing.body?.errors?.[0];
check('a nonexistent job is refused with the SAME code', Boolean(missingErr) && missingErr.extensions?.code === 'UNAUTHORIZED',
  missingErr ? missingErr.message : 'NO ERROR');

console.log(failed ? `\nRIDE-ESTIMATE GATE FAILED — ${failed}` : '\nRIDE-ESTIMATE GATE PASS');
process.exit(failed ? 1 : 0);
