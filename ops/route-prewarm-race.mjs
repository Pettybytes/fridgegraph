#!/usr/bin/env node
/**
 * Route-prewarm race — CONTROLLED EVIDENCE, isolated process.
 *
 * THE QUESTION THIS ANSWERS (different from ops/late-write-proof.mjs)
 * The other harness tests a late caregiver REPLY. This one tests the late ROUTE write: the pre-step
 * measures a road distance with a slow provider, the bounded wait expires so ranking proceeds, and the
 * provider result lands at one of two moments relative to SQL's `ride_miles_for` read:
 *
 *   A. released BEFORE ranking's read  → SQL may consume the stored road measurement
 *   B. released AFTER the decision     → the completed decision must not move
 *
 * It does NOT force the fallback. Whatever SQL consumes is what is reported: `basis` comes from the
 * row the policy engine wrote, not from an expectation in this file.
 *
 * ISOLATION
 *   - the "provider" is this process; no shared provider is contacted and no public delay switch exists
 *   - every write happens inside one transaction that is ROLLED BACK at the end
 *   - the job ids, coordinates and place ids are fictional and unique to this run
 *
 * FIDELITY: this proves ORDER and the late-write rule on the real functions. It is not a
 * real-provider served proof and it does not stand in for one.
 *
 * Usage:
 *   PROOF_DB_URL=postgres://… node ops/route-prewarm-race.mjs
 *   (defaults to .env's SUPABASE_DB_URL; the run is rollback-only either way)
 *
 * Exit: 0 all PASS · 1 any FAIL · 3 BLOCKED · 2 refused.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

const LABEL = 'CONTROLLED EVIDENCE';
const results = { pass: 0, fail: 0, blocked: 0 };
const pass = (l, d = '') => { results.pass += 1; console.log(`  PASS  ${l}${d ? ' — ' + d : ''}`); };
const fail = (l, d = '') => { results.fail += 1; console.log(`  FAIL  ${l}${d ? ' — ' + d : ''}`); };
const blocked = (l, r) => { results.blocked += 1; console.log(`  BLOCK ${l} — ${r}`); };
const check = (l, ok, d = '') => (ok ? pass(l, d) : fail(l, d));

const projectUrl = (() => {
  try {
    const line = readFileSync('.env', 'utf8').split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='));
    return line ? line.slice('SUPABASE_DB_URL='.length).replace(/["'\s\r]/g, '') : null;
  } catch { return null; }
})();
const url = process.env.PROOF_DB_URL ?? projectUrl;

console.log(`${LABEL} — route-prewarm timeout race (isolated process, rolled back)`);
console.log('  provider: this process only · no public delay switch · shared provider untouched');

if (!url) {
  blocked('database', 'neither PROOF_DB_URL nor .env SUPABASE_DB_URL is available');
  process.exit(3);
}
const usingProject = !process.env.PROOF_DB_URL;
if (usingProject) console.log('  database: .env SUPABASE_DB_URL, inside one rolled-back transaction');

const client = new pg.Client({ connectionString: url, application_name: 'fg-route-prewarm-race' });
try { await client.connect(); } catch (e) {
  console.log(`  BLOCK  database — could not connect (${e.code ?? e.message})`);
  process.exit(3);
}

const SUF = 'race' + Date.now().toString(36).slice(-6);
const CHILD = 'p_nora';
const CAND = 'p_gma';
const SCHOOL = { id: `loc_${SUF}_school`, lat: 42.3314, lng: -83.0458 };
const CAND_PT = { id: `loc_${SUF}_cand`, lat: 42.4039, lng: -83.0458 };
const DIST_METERS = 19_860; // ≈ 12.34 mi — a fictional road measurement, not a real figure

const storeRoad = (from, to) => client.query(
  `select public.store_route_result('driving-car', $1, $2, $3, $4, $5, $6, $7, $8)`,
  [from.id, to.id, from.lat, from.lng, to.lat, to.lng, DIST_METERS, 1_500]);

const decisionOf = async (jobId) => (await client.query(
  `select candidate_id, reason_code, distance_miles::text as miles,
          estimated_ride_cost_usd::text as cost, cost_basis, cost_calculated_at,
          location_provenance
     from candidate_evaluations where job_id = $1
      and reason_code in ('RECOMMENDED','APPROVAL_PENDING','OVER_POLICY')`, [jobId])).rows[0] ?? null;

async function makeJob(tag, timeoutSeconds) {
  const jobId = `job_${SUF}_${tag}`;
  await client.query(
    `insert into coordination_jobs (id, idempotency_key, type, child_id, status, version,
       request_version, as_of, discovery_timeout_seconds)
     values ($1, $1, 'pickup', $2, 'discovering', 0, 1, current_date, $3)`,
    [jobId, CHILD, timeoutSeconds]);
  await client.query(
    `insert into candidate_evaluations (id, job_id, request_version, candidate_id, reason_code, available)
     values ($1, $2, 1, $3, 'AVAILABLE_NO_TRANSPORT', true)`,
    [`ce_${SUF}_${tag}`, jobId, CAND]);
  return jobId;
}

try {
  await client.query('begin');
  await client.query("set local statement_timeout = '60000ms'");

  const fns = (await client.query(
    `select proname from pg_proc where proname = any($1)`,
    [['store_route_result', 'ride_miles_for', '_rank_and_advance', 'route_distance_miles']])).rows.map((r) => r.proname);
  const missing = ['store_route_result', 'ride_miles_for', '_rank_and_advance'].filter((n) => !fns.includes(n));
  if (missing.length) {
    blocked('preconditions — functions', `missing ${missing.join(', ')} (0059–0065 applied?)`);
    throw new Error('missing schema');
  }

  const people = (await client.query(
    `select id from people where id = any($1)`, [[CHILD, CAND]])).rows.map((r) => r.id);
  if (!people.includes(CHILD) || !people.includes(CAND)) {
    blocked('preconditions — cast rows', `need ${CHILD} and ${CAND} in people`);
    throw new Error('missing cast');
  }

  // Fictional, sandbox place points for this run only.
  await client.query(
    `insert into locations (id, owner_type, owner_id, label, lat, lng, source, sandbox)
     values ($1,'CHILD',$2,'school',$3,$4,'SUPPLIED',true),
            ($5,'PERSON',$6,'proof-race-origin',$7,$8,'SUPPLIED',true)`,
    [SCHOOL.id, CHILD, SCHOOL.lat, SCHOOL.lng, CAND_PT.id, CAND, CAND_PT.lat, CAND_PT.lng]);

  const capHad = (await client.query(
    `select 1 from household_policies hp where hp.rule = 'ride_cost_cap_usd'
       and hp.household_id in (select household_id from household_members where person_id = $1 and role = 'child')
      limit 1`, [CHILD])).rowCount > 0;
  if (!capHad) {
    await client.query(
      `insert into household_policies (household_id, rule, value)
       select household_id, 'ride_cost_cap_usd', 10 from household_members
        where person_id = $1 and role = 'child' limit 1`, [CHILD]);
  } else {
    pass('a ride_cost_cap_usd policy already exists for the child', 'used as-is');
  }

  // ---- CASE A: the provider result is released BEFORE ranking reads
  const jobA = await makeJob('a', 0);
  await storeRoad(CAND_PT, SCHOOL);            // the delayed provider's result, released early
  await client.query('select _rank_and_advance($1)', [jobA]);
  const a = await decisionOf(jobA);
  if (!a) {
    blocked('case A decision', 'ranking wrote no decision (cap/transport fixture may differ)');
  } else {
    pass('case A — the job reached a decision', `${a.reason_code} · ${a.candidate_id}`);
    console.log(`  NOTE  case A basis SQL actually consumed: ${a.cost_basis ?? 'none'} (${a.miles ?? '—'} mi)`);
    check('case A — the decision candidate is the evaluated caregiver', a.candidate_id === CAND);
    check('case A — miles and amount are written together',
      (a.cost === null) === (a.miles === null), `miles ${a.miles ?? 'null'} / cost ${a.cost ?? 'null'}`);
    if (a.cost !== null) {
      const expected = (await client.query('select round($1::numeric * 1.40, 2)::text as c', [a.miles])).rows[0].c;
      check('case A — the stored amount is miles × 1.40 to the cent', expected === a.cost,
        `${a.miles} × 1.40 = ${expected}, stored ${a.cost}`);
      check('case A — the basis is one of the two the code can produce',
        ['stored road distance', 'haversine'].includes(a.cost_basis), String(a.cost_basis));
      check('case A — a priced decision carries its timestamp', Boolean(a.cost_calculated_at));
    }
  }

  // ---- CASE B: the decision commits first; the provider result arrives after
  const jobB = await makeJob('b', 0);
  await client.query('select _rank_and_advance($1)', [jobB]);
  const bBefore = await decisionOf(jobB);
  if (!bBefore) {
    blocked('case B decision', 'ranking wrote no decision');
  } else {
    pass('case B — the job reached a decision before the provider landed', bBefore.reason_code);
    console.log(`  NOTE  case B basis at decision time: ${bBefore.cost_basis ?? 'none'} (${bBefore.miles ?? '—'} mi)`);
    // Use a DIFFERENT ordered snapshot for case B so case A's stored row cannot satisfy this read.
    const latePoint = { id: `loc_${SUF}_cand_b`, lat: 42.4210, lng: -83.0458 };
    await client.query(
      `insert into locations (id, owner_type, owner_id, label, lat, lng, source, sandbox)
       values ($1,'PERSON',$2,'proof-race-origin-b',$3,$4,'SUPPLIED',true)`,
      [latePoint.id, CAND, latePoint.lat, latePoint.lng]);
    await storeRoad(latePoint, SCHOOL);

    const bAfter = await decisionOf(jobB);
    const strip = (r) => JSON.stringify({ reason: r.reason_code, miles: r.miles, cost: r.cost, basis: r.cost_basis });
    check('case B — the late measurement does not alter the completed decision',
      strip(bBefore) === strip(bAfter), `${bBefore.cost_basis ?? 'none'} → ${bAfter.cost_basis ?? 'none'}`);
    check('case B — the amount is unchanged by the later write',
      bBefore.cost === bAfter.cost && bBefore.miles === bAfter.miles,
      `${bBefore.cost ?? 'null'} / ${bAfter.cost ?? 'null'}`);
    check('case B — the decision’s own basis is still one the code can produce',
      bAfter.cost === null || ['stored road distance', 'haversine'].includes(bAfter.cost_basis),
      String(bAfter.cost_basis));
  }

  // The store really did receive the case-B measurement (a negative control on "nothing happened").
  const storedB = (await client.query(
    `select route_distance_miles($1,$2,$3,$4,'driving-car') as m`,
    [42.4210, -83.0458, SCHOOL.lat, SCHOOL.lng])).rows[0];
  check('the late measurement is readable in the store (the write was real)', storedB.m !== null,
    storedB.m === null ? 'not stored' : String(storedB.m));
} catch (e) {
  if (!['missing schema', 'missing cast'].includes(e.message)) fail('race run aborted', e.message);
} finally {
  await client.query('rollback').catch(() => undefined);
  await client.end().catch(() => undefined);
}

const total = results.pass + results.fail + results.blocked;
console.log(`\n${LABEL} SUMMARY: ${results.pass} PASS · ${results.fail} FAIL · ${results.blocked} BLOCKED of ${total}`);
console.log('Basis is reported as SQL produced it — this run does not assert an expected basis.');
process.exit(results.fail > 0 ? 1 : results.blocked > 0 ? 3 : 0);
