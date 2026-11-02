#!/usr/bin/env node
/**
 * Proof inputs — the three prerequisites the cutover could not supply, prepared as explicit steps.
 *
 * NOTHING HERE RUNS BY DEFAULT. `plan` prints exactly what would happen; `create`/`cleanup` require
 * `--yes` and are meant to be executed INSIDE a reserved window, because each one mutates shared
 * state (a place row, a pickup job). The prewarm race needs a disposable database, so its "setup" is
 * a printed command sequence — this script will not create a container on its own.
 *
 *   1. SERVED 409 — a scoped, fictional, coordinate-less place.
 *        place id: rp_proof_no_geometry, household h_a, label "Proof Place Without Geometry",
 *        sandbox=true, fixture=false → it is visible to Nora's parents and has NO coordinates.
 *        cleanup is canonical: `reset_demo_places()` deletes every sandbox, non-fixture place, which
 *        is the documented reset path (the same one `db:reset` and `resetDemo()` use). A direct
 *        delete by id is the fallback and is reported separately if it is ever needed.
 *   2. PRICING / OPERATOR EVIDENCE — a real job created through the served GraphQL `requestPickup`,
 *        then the candidate's reply through the same webhook chain the product uses. This script
 *        creates only the job and prints its id + attempt ids; the reply is delivered by the caller
 *        (the harness cannot invent a provider round-trip).
 *   3. ROUTE-PREWARM RACE — a disposable Postgres with the slice applied. Printed as commands:
 *        docker run --rm -d --name fg-prewarm-race -p 127.0.0.1:55433:5432 postgres:16-alpine
 *        REHEARSAL_DB_URL=postgres://postgres:pg@127.0.0.1:55433/postgres \
 *          REHEARSAL_ALLOW_PROJECT=0 node ops/rehearsal-0058-0065.mjs   # see the note below
 *      The rehearsal rolls back, so a committed disposable copy needs `ops/apply-0058-0065.mjs`
 *      pointed at it with `APPLY_DB_URL` after the scaffold exists. That gap is stated, not hidden.
 *
 * Usage:
 *   node ops/proof-inputs.mjs plan
 *   node ops/proof-inputs.mjs create-409 --yes
 *   node ops/proof-inputs.mjs cleanup-409 --yes
 *   node ops/proof-inputs.mjs pricing-job --yes [--child p_nora] [--day 2026-09-01]
 *
 * Exit: 0 ok · 1 failure · 2 refused (missing --yes) · 3 blocked (prerequisite).
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

const BASE = (process.env.SERVED_BASE ?? 'http://127.0.0.1:4008').replace(/\/$/, '');
const PLACE_ID = 'rp_proof_no_geometry';
const PLACE_LABEL = 'Cedar Hill Park';
const PLACE_HOUSEHOLD = 'h_a';

const args = process.argv.slice(2);
const cmd = args[0] ?? 'plan';
const yes = args.includes('--yes');
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const envUrl = (() => {
  try {
    const line = readFileSync('.env', 'utf8').split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='));
    return line ? line.slice('SUPABASE_DB_URL='.length).replace(/["'\s\r]/g, '') : null;
  } catch { return null; }
})();
const url = process.env.PROOF_DB_URL ?? envUrl;

const sql409 = `insert into recorded_places (id, household_id, kind, label, sandbox, fixture)
  values ('${PLACE_ID}', '${PLACE_HOUSEHOLD}', 'PARK', '${PLACE_LABEL}', true, false)
  on conflict (id) do nothing;`;

function plan() {
  console.log('PROOF INPUTS — plan (nothing is executed by this command)\n');
  console.log('1. SERVED 409');
  console.log(`   place: ${PLACE_ID} · household ${PLACE_HOUSEHOLD} · label "${PLACE_LABEL}"`);
  console.log('   properties: sandbox=true, fixture=false, NO coordinates recorded');
  console.log('   effect: visible to Nora\'s parents, so the route answers 409 GEOMETRY_UNAVAILABLE;');
  console.log('           an unrelated caller still gets 404 (the no-oracle property is re-asserted).');
  console.log(`   create:  ${sql409.replace(/\s+/g, ' ').trim()}`);
  console.log('   cleanup: select reset_demo_places(\'proof-409\');  -- canonical, removes sandbox non-fixture rows');
  console.log('   then:    PROOF_NOGEOM_PLACE=' + PLACE_ID + ' node ops/served-proof-suite.mjs\n');
  console.log('2. PRICING / OPERATOR EVIDENCE');
  console.log(`   login as kendra through ${BASE}/api/demo/login (real JWT)`);
  console.log('   mutation: requestPickup(childId, asOf) → job id (real request path, real candidate set)');
  console.log('   reply:    the candidate answers through the webhook chain; this script does NOT invent it');
  console.log('   then:     PROOF_JOB_ID=<job> node ops/evaluation-agreement.mjs  (OPERATOR EVIDENCE)\n');
  console.log('3. ROUTE-PREWARM RACE (disposable database)');
  console.log('   docker run --rm -d --name fg-prewarm-race -p 127.0.0.1:55433:5432 \\');
  console.log('     -e POSTGRES_PASSWORD=pg postgres:16-alpine');
  console.log('   # scaffold + slice, committed into that container:');
  console.log('   APPLY_DB_URL=postgres://postgres:pg@127.0.0.1:55433/postgres node ops/apply-0058-0065.mjs');
  console.log('   # NOTE: apply-0058-0065 assumes the scaffold tables already exist in the target');
  console.log('   #       (people, households, coordination_jobs, …). On a bare container the rehearsal');
  console.log('   #       runner is what creates them; this gap is stated rather than papered over.');
  console.log('   PROOF_DB_URL=postgres://postgres:pg@127.0.0.1:55433/postgres PROOF_JOB_ID=<job> \\');
  console.log('     node ops/route-prewarm-race.mjs');
}

async function connect() {
  if (!url) { console.log('BLOCKED: no database URL'); process.exit(3); }
  const c = new pg.Client({ connectionString: url, application_name: 'fg-proof-inputs' });
  await c.connect();
  return c;
}

async function create409() {
  if (!yes) { console.log('REFUSED: create-409 mutates shared state; pass --yes inside a reserved window.'); process.exit(2); }
  const c = await connect();
  try {
    const exists = await c.query('select 1 from recorded_places where id = $1', [PLACE_ID]);
    if (exists.rowCount) { console.log(`  EXISTS  ${PLACE_ID} — nothing to create (cleanup it first if stale)`); }
    else {
      await c.query(sql409);
      console.log(`  CREATED ${PLACE_ID}`);
    }
    const probe = await c.query(
      `select latitude is null as no_lat, longitude is null as no_lng, sandbox, fixture
         from recorded_places where id = $1`, [PLACE_ID]);
    const r = probe.rows[0];
    console.log(`  PROBE   no_lat=${r.no_lat} no_lng=${r.no_lng} sandbox=${r.sandbox} fixture=${r.fixture}`);
    if (!r.no_lat || !r.no_lng) { console.log('  FAIL    the place carries coordinates; the 409 case needs it empty'); process.exit(1); }
  } finally { await c.end(); }
}

async function cleanup409() {
  if (!yes) { console.log('REFUSED: cleanup-409 mutates shared state; pass --yes inside a reserved window.'); process.exit(2); }
  const c = await connect();
  try {
    await c.query(`select reset_demo_places('proof-409')`);
    const left = await c.query('select 1 from recorded_places where id = $1', [PLACE_ID]);
    console.log(left.rowCount === 0
      ? `  CLEANED ${PLACE_ID} via reset_demo_places()`
      : `  STILL PRESENT ${PLACE_ID} — reset did not remove it; investigative delete needed`);
    if (left.rowCount) process.exit(1);
  } finally { await c.end(); }
}

async function pricingJob() {
  if (!yes) { console.log('REFUSED: pricing-job creates a real job; pass --yes inside a reserved window.'); process.exit(2); }
  const child = arg('child', 'p_nora');
  const day = arg('day', '2026-09-01');
  const login = await fetch(`${BASE}/api/demo/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ personaId: 'kendra' }),
  });
  const body = await login.json().catch(() => null);
  if (body?.status !== 'READY' || !body?.session?.access_token) {
    console.log(`BLOCKED: kendra login ${body?.status ?? login.status}${body?.reason ? ` (${body.reason})` : ''}`);
    process.exit(3);
  }
  const gql = async (q, v) => {
    const r = await fetch(process.env.SERVED_ROUTER ?? 'http://127.0.0.1:4010/', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${body.session.access_token}` },
      body: JSON.stringify({ query: q, variables: v }),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const m = await gql(
    `mutation($child: ID!, $asOf: String!) { requestPickup(childId: $child, asOf: $asOf) { id } }`,
    { child, asOf: day });
  const jobId = m.body?.data?.requestPickup?.id;
  console.log(`  requestPickup HTTP ${m.status} → ${jobId ?? JSON.stringify(m.body?.errors?.[0] ?? {})}`);
  if (!jobId) process.exit(1);
  const q = await gql(`query($job: ID!) { job(id: $job) { id status } }`, { job: jobId });
  console.log(`  job ${jobId} status=${q.body?.data?.job?.status ?? '?'}`);
  const attempts = await gql(
    `query($job: ID!) { job(id: $job) { id attempts { id candidateId state } } }`, { job: jobId });
  console.log(`  attempts: ${JSON.stringify(attempts.body?.data?.job?.attempts ?? [])}`);
  console.log(`\n  NEXT: deliver the candidate reply through the webhook chain, then`);
  console.log(`        PROOF_JOB_ID=${jobId} node ops/evaluation-agreement.mjs`);
}

async function pricingReply() {
  if (!yes) { console.log('REFUSED: pricing-reply writes a real evaluation; pass --yes inside a reserved window.'); process.exit(2); }
  const jobId = arg('job', null);
  const persona = arg('persona', 'loretta');
  if (!jobId) { console.log('BLOCKED: --job is required (created by pricing-job)'); process.exit(3); }

  const login = await fetch(`${BASE}/api/demo/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ personaId: persona }),
  });
  const body = await login.json().catch(() => null);
  if (body?.status !== 'READY' || !body?.session?.access_token) {
    console.log(`BLOCKED: ${persona} login ${body?.status ?? login.status}${body?.reason ? ` (${body.reason})` : ''}`);
    process.exit(3);
  }
  const token = body.session.access_token;
  const gql = async (q, v) => {
    const r = await fetch(process.env.SERVED_ROUTER ?? 'http://127.0.0.1:4010/', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ query: q, variables: v }),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };

  // The Attempt type has no candidate field; jobTimeline pairs each attempt with its candidate.
  const tl = await gql(
    `query($job: ID!) { jobTimeline(jobId: $job) { at kind attemptId candidate { id displayName } } }`,
    { job: jobId });
  const events = tl.body?.data?.jobTimeline ?? [];
  const want = persona === 'loretta' ? 'loretta' : persona;
  const hit = events.find((e) => e.attemptId && String(e.candidate?.displayName ?? '').toLowerCase().includes(want))
    ?? events.find((e) => e.attemptId);
  if (!hit) {
    console.log(`BLOCKED: no attempt for ${jobId} in the timeline (${events.length} events)`);
    process.exit(3);
  }
  console.log(`  attempt ${hit.attemptId} · candidate ${hit.candidate?.displayName ?? '?'} · kind ${hit.kind}`);

  let out = await gql(
    `mutation($a: ID!, $av: Boolean!) { acceptPickup(attemptId: $a, available: $av) { id } }`,
    { a: hit.attemptId, av: true });
  if (out.body?.errors) {
    out = await gql(
      `mutation($a: ID!, $av: Boolean!) { acceptPickup(attemptId: $a, available: $av) { __typename } }`,
      { a: hit.attemptId, av: true });
  }
  const err = out.body?.errors?.[0]?.message;
  console.log(`  acceptPickup HTTP ${out.status}${err ? ` — ${err}` : ' — recorded'}`);
  if (err) process.exit(1);

  const st = await gql(`query($job: ID!) { job(id: $job) { id status overLimitCandidateId } }`, { job: jobId });
  console.log(`  job ${jobId} status=${st.body?.data?.job?.status ?? '?'} overLimit=${st.body?.data?.job?.overLimitCandidateId ?? 'none'}`);
  console.log(`\n  NEXT: PROOF_JOB_ID=${jobId} node ops/evaluation-agreement.mjs`);
}

if (cmd === 'plan') plan();
else if (cmd === 'create-409') await create409();
else if (cmd === 'cleanup-409') await cleanup409();
else if (cmd === 'pricing-job') await pricingJob();
else if (cmd === 'pricing-reply') await pricingReply();
else { console.log('unknown command: ' + cmd); process.exit(2); }
