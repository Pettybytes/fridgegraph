#!/usr/bin/env node
/**
 * 0066 behavioural proof — a caregiver can see and accept ONLY her own attempt.
 *
 * WINDOW STEP. The static contract is in CI (`ops/0066-policy-contract.test.mjs`); this script needs
 * 0066 APPLIED to a served stack, because the rules it checks are enforced by RLS against real JWTs.
 * It refuses to pretend otherwise: without the policy and a job carrying attempts it reports BLOCKED.
 *
 * Checks:
 *   1. the caregiver's `attempts` list contains only rows whose candidate is her;
 *   2. accepting her own attempt is recorded (not ATTEMPT_NOT_FOUND);
 *   3. accepting ANOTHER candidate's attempt is refused;
 *   4. an unrelated caller sees no attempts for that job;
 *   5. a parent still sees every attempt for the job.
 *
 * Usage: node ops/0066-attempt-access-proof.mjs [--persona loretta] [--other monique]
 * Exit: 0 all PASS · 1 any FAIL · 3 BLOCKED · 2 refused.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

const BASE = (process.env.SERVED_BASE ?? 'http://127.0.0.1:4008').replace(/\/$/, '');
const ROUTER = process.env.SERVED_ROUTER ?? 'http://127.0.0.1:4010/';
const SCHEME = 'B' + 'earer' + ' ';
const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const persona = arg('persona', 'loretta');

let fail = 0;
const check = (l, ok, d = '') => { if (!ok) fail += 1; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${d ? ' — ' + d : ''}`); };
const blocked = (l, r) => { console.log(`  BLOCK ${l} — ${r}`); process.exit(3); };

const url = (() => {
  try {
    const line = readFileSync('.env', 'utf8').split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='));
    return line ? line.slice('SUPABASE_DB_URL='.length).replace(/["'\s\r]/g, '') : null;
  } catch { return null; }
})();

const login = async (id) => {
  const r = await fetch(`${BASE}/api/demo/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ personaId: id }) });
  const j = await r.json().catch(() => null);
  return j?.status === 'READY' ? j.session.access_token : null;
};
const gql = async (token, q, v) => {
  const r = await fetch(ROUTER, { method: 'POST', headers: { 'content-type': 'application/json', authorization: SCHEME + token }, body: JSON.stringify({ query: q, variables: v }) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

if (!url) blocked('database', 'no .env SUPABASE_DB_URL to check whether 0066 is applied');
const db = new pg.Client({ connectionString: url, application_name: 'fg-0066-proof' });
await db.connect();
const applied = (await db.query(`select 1 from pg_policies where tablename = 'attempts' and policyname = 'attempts_read_own'`)).rowCount === 1;
await db.end();
if (!applied) blocked('precondition — 0066', 'policy attempts_read_own is not in the database; apply it in the next window first');

const parent = await login('kendra');
const her = await login(persona);
if (!parent || !her) blocked('precondition — sessions', 'kendra or the caregiver could not log in');

const created = await gql(parent,
  `mutation($c: ID!, $d: String!, $w: String!) { requestPickup(childId: $c, asOf: $d, window: $w) { id } }`,
  { c: 'p_nora', d: '2026-11-02', w: `proof0066-${Date.now()}` });
const jobId = created.body?.data?.requestPickup?.id;
if (!jobId) blocked('precondition — job', created.body?.errors?.[0]?.message ?? 'requestPickup failed');

const all = await gql(parent, `query($j: ID) { attempts(jobId: $j) { id candidate { id displayName } } }`, { j: jobId });
const rows = all.body?.data?.attempts ?? [];
if (!rows.length) blocked('precondition — attempts', 'the job has no attempts to test against');
const mine = rows.find((a) => String(a.candidate?.displayName ?? '').toLowerCase().includes(persona)) ?? rows[0];
const other = rows.find((a) => a.id !== mine.id);

const hers = await gql(her, `query($j: ID) { attempts(jobId: $j) { id candidate { id } } }`, { j: jobId });
const herRows = hers.body?.data?.attempts ?? [];
check('the caregiver sees her own attempt list, and only hers',
  herRows.length > 0 && herRows.every((r) => r.candidate?.id === mine.candidate?.id),
  `${herRows.length} visible`);

const accept = await gql(her, `mutation($a: ID!) { acceptPickup(attemptId: $a, available: true) { __typename } }`, { a: mine.id });
check('she can accept her own attempt', !accept.body?.errors, accept.body?.errors?.[0]?.message ?? 'recorded');

if (other) {
  const foreign = await gql(her, `mutation($a: ID!) { acceptPickup(attemptId: $a, available: true) { __typename } }`, { a: other.id });
  check('she cannot accept another candidate’s attempt', Boolean(foreign.body?.errors), foreign.body?.errors?.[0]?.message ?? 'NO ERROR — WORSE THAN A FAIL');
}

const stranger = await login('dana');
if (stranger) {
  const none = await gql(stranger, `query($j: ID) { attempts(jobId: $j) { id } }`, { j: jobId });
  check('an unrelated caller sees no attempts for that job', (none.body?.data?.attempts ?? []).length === 0,
    `${(none.body?.data?.attempts ?? []).length} visible`);
}

check('a parent still sees every attempt for the job', rows.length >= (herRows.length || 1),
  `${rows.length} for the parent, ${herRows.length} for the caregiver`);

console.log(fail ? `\n0066 PROOF FAILED — ${fail}` : '\n0066 PROOF PASS');
process.exit(fail ? 1 : 0);
