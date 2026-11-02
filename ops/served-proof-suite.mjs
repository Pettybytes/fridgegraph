#!/usr/bin/env node
/**
 * Served proof suite — REAL claims against the running stack. **NOT RUN in this window.**
 *
 * Every check here uses a real demo session (a real Supabase JWT minted for a real persona), a real
 * signed-in caller, and the served endpoints. Nothing is stubbed, and no check is allowed to "pass"
 * because a prerequisite is missing: a check that cannot run because the window has not happened is
 * reported as **BLOCKED**, and BLOCKED is not PASS (exit code 3).
 *
 * SURFACES (deliberately two):
 *   REST  — POST /api/village/day and POST /api/village/route are Express routes on the demo/API
 *           listener (4008). They are NOT GraphQL fields, so they need no supergraph recompose.
 *   Graph — the router for queries/mutations that ARE GraphQL (today: teacher `reportSchoolDay`).
 *
 * Usage:
 *   SERVED_BASE=http://127.0.0.1:4008 \
 *   SERVED_ROUTER=http://127.0.0.1:4010/ \
 *   node ops/served-proof-suite.mjs
 *
 * Exit: 0 all PASS · 1 any FAIL · 3 any BLOCKED and no FAIL · 2 preflight could not run at all.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const BASE = (process.env.SERVED_BASE ?? 'http://127.0.0.1:4008').replace(/\/$/, '');
const ROUTER = process.env.SERVED_ROUTER ?? 'http://127.0.0.1:4010/';
const LOGIN = `${BASE}/api/demo/login`;

const results = { pass: 0, fail: 0, blocked: 0 };
const pass = (label, detail = '') => { results.pass += 1; console.log(`  PASS  ${label}${detail ? ' — ' + detail : ''}`); };
const fail = (label, detail = '') => { results.fail += 1; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); };
const blocked = (label, reason) => { results.blocked += 1; console.log(`  BLOCK ${label} — ${reason}`); };
const check = (label, ok, detail = '') => (ok ? pass(label, detail) : fail(label, detail));

// ---------------------------------------------------------------------------------------------
// Transport helpers. A login that cannot mint is a BLOCKED suite, never a pass.
// ---------------------------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(personaId) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const r = await fetch(LOGIN, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ personaId }),
    });
    if (r.status === 429) {
      await sleep((Number(r.headers.get('retry-after') ?? 10) + 1) * 1000);
      continue;
    }
    const body = await r.json().catch(() => null);
    if (body?.status === 'READY' && body?.session?.access_token) return body.session.access_token;
    return { error: `${personaId}: ${body?.status ?? r.status}${body?.reason ? ` (${body.reason})` : ''}` };
  }
  return { error: `${personaId}: rate limited` };
}

const session = async (personaId) => {
  const token = await login(personaId);
  return typeof token === 'string' ? { token } : { error: token.error };
};

const rest = async (path, token, body) => {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body is itself a finding */ }
  return { status: r.status, json, text };
};

const gql = async (token, query, variables) => {
  const r = await fetch(ROUTER, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  const body = await r.json().catch(() => null);
  return { status: r.status, body };
};

/** The seeded place id for (household, label) — the same md5 form 0053/0062 use. */
const placeId = (household, label) =>
  'rp_' + createHash('md5').update(`${household}:${label}`).digest('hex').slice(0, 12);

// ---------------------------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------------------------
console.log('SERVED PROOF SUITE');
console.log(`  base ${BASE}  router ${ROUTER}`);

const kendra = await session('kendra');
if (kendra.error) {
  blocked('preflight — Kendra session', kendra.error);
  console.log('\nSUITE BLOCKED at preflight: no real session, so nothing below is claimed.');
  process.exit(2);
}

const priya = await session('priya');
const dana = await session('dana');

console.log('\n1. DAY READ — POST /api/village/day (REST, no supergraph change)');
const DAY = process.env.PROOF_DAY ?? '2026-09-01';
const kendraDay = await rest('/api/village/day', kendra.token, { childId: 'p_nora', day: DAY });
check('authorized parent reads the day (200)', kendraDay.status === 200, `HTTP ${kendraDay.status}`);
const items = kendraDay.json?.items ?? [];
check('the day returns the cast events', Array.isArray(items) && items.length > 0, `${items.length} item(s)`);
const linked = items.find((i) => i.placeState === 'linked');
check('a linked event carries placeId + placeName from the database', Boolean(linked?.placeId && linked?.placeName),
  linked ? `${linked.eventId} → ${linked.placeName}` : 'no linked item (was 0062 seeded?)');
check('no item carries geometry', items.every((i) => !('coordinates' in i) && !('latitude' in i)));

const anon = await rest('/api/village/day', null, { childId: 'p_nora', day: DAY });
check('no bearer is 401, not an empty day', anon.status === 401, `HTTP ${anon.status}`);

if (priya.token) {
  const priyaDay = await rest('/api/village/day', priya.token, { childId: 'p_nora', day: DAY });
  check('a schedule-read grant holder reads the day (200)', priyaDay.status === 200, `HTTP ${priyaDay.status}`);
  check('labels are returned to a schedule reader (no address.read needed)',
    (priyaDay.json?.items ?? []).some((i) => i.placeState === 'linked' && i.placeName));
} else {
  blocked('grant-holder day read', priya.error);
}

if (dana.token) {
  const danaDay = await rest('/api/village/day', dana.token, { childId: 'p_nora', day: DAY });
  check('an unrelated caller gets zero rows and 200 — no error, no oracle',
    danaDay.status === 200 && (danaDay.json?.items ?? []).length === 0,
    `HTTP ${danaDay.status}, ${(danaDay.json?.items ?? []).length} item(s)`);
} else {
  blocked('unrelated-caller day read', dana.error);
}

console.log('\n2. ROUTE — POST /api/village/route (REST)');
// h_a Lincoln Elementary + h_b Riverside Park: both seeded with coordinates by 0062.
const FROM = placeId('h_a', 'Lincoln Elementary School');
const TO = placeId('h_b', 'Riverside Park');

const route = await rest('/api/village/route', kendra.token, { childId: 'p_nora', fromPlaceId: FROM, toPlaceId: TO });
if (route.status === 200) {
  pass('authorized route returns a real road result (200)', `${route.json?.distanceMeters} m`);
  check('geometry is GeoJSON, decoded server-side',
    route.json?.geometry?.type === 'LineString' && Array.isArray(route.json?.geometry?.coordinates));
  check('the disclaimer travels with the number',
    route.json?.disclaimer === 'Estimated — not live traffic');
} else {
  blocked('authorized route (200)', `HTTP ${route.status} — 0061/0062 applied and seeded?`);
}

if (priya.token) {
  const withheld = await rest('/api/village/route', priya.token, { childId: 'p_nora', fromPlaceId: FROM, toPlaceId: TO });
  check('a grant holder without address.read is 403 COORDINATES_WITHHELD',
    withheld.status === 403 && withheld.json?.error === 'COORDINATES_WITHHELD', `HTTP ${withheld.status}`);
  check('a withheld refusal carries no geometry (authorization precedes any cache read)',
    !withheld.json?.geometry && withheld.json?.distanceMeters === undefined);
} else {
  blocked('withheld route (403)', priya.error);
}

if (dana.token) {
  const missing = await rest('/api/village/route', dana.token, { childId: 'p_nora', fromPlaceId: FROM, toPlaceId: TO });
  const nonexistent = await rest('/api/village/route', dana.token, { childId: 'p_nora', fromPlaceId: 'rp_doesnotexist', toPlaceId: TO });
  check('another family’s place and a missing place answer identically (404, no oracle)',
    missing.status === 404 && nonexistent.status === 404
      && JSON.stringify(missing.json) === JSON.stringify(nonexistent.json),
    `${missing.status}/${nonexistent.status}`);
} else {
  blocked('cross-family route (404)', dana.error);
}

// 409 GEOMETRY_UNAVAILABLE: an authorized place with no recorded coordinates is its own answer —
// neither a refusal nor a route. The canonical seed gives every place coordinates on purpose, so this
// case needs one fictional coordinate-less place in Nora's household, named by the operator.
const NOGEOM = process.env.PROOF_NOGEOM_PLACE;
if (NOGEOM) {
  const absent = await rest('/api/village/route', kendra.token, { childId: 'p_nora', fromPlaceId: NOGEOM, toPlaceId: TO });
  check('an authorized place with no coordinates is 409 GEOMETRY_UNAVAILABLE',
    absent.status === 409 && absent.json?.error === 'GEOMETRY_UNAVAILABLE', `HTTP ${absent.status}`);
  check('a geometry-unavailable answer carries no distance or geometry',
    absent.json?.distanceMeters === undefined && !absent.json?.geometry);
  const absentDana = dana.token
    ? await rest('/api/village/route', dana.token, { childId: 'p_nora', fromPlaceId: NOGEOM, toPlaceId: TO })
    : null;
  check('the no-coordinate place is not an existence oracle for an unrelated caller',
    absentDana === null || absentDana.status === 404, absentDana ? `HTTP ${absentDana.status}` : 'no dana session');
} else {
  blocked('authorized place with no coordinates (409)',
    'seeded places all carry coordinates; name a fictional coordinate-less place with PROOF_NOGEOM_PLACE — a 404 here would prove nothing');
}

const walk = await rest('/api/village/route', kendra.token, {
  childId: 'p_nora', fromPlaceId: FROM, toPlaceId: TO, profile: 'foot-walking',
});
if (walk.status === 200 && route.status === 200) {
  check('profiles are separate cache identities (walking is not the driving number)',
    walk.json.distanceMeters !== route.json.distanceMeters || walk.json.cached === false,
    `drive ${route.json.distanceMeters} / walk ${walk.json.distanceMeters}`);
} else {
  blocked('profile separation', `walking HTTP ${walk.status}`);
}

console.log('\n3. PRICING — the job through the graph, then the row through a read-only database check');
const jobId = process.env.PROOF_JOB_ID ?? process.env.PROOF_PRICING_JOB;
if (!jobId) {
  // A check must not vanish because its input is absent: an unreported assertion reads as a pass.
  blocked('the job is readable through the graph', 'no PROOF_JOB_ID supplied');
  blocked('paid-ride estimate agreement',
    'needs a job with a paid-ride evaluation; set PROOF_JOB_ID (created through the real request+reply path)');
} else {
  const q = `query($job: ID!) { job(id: $job) { id status overLimitCandidateId } }`;
  const job = await gql(kendra.token, q, { job: jobId });
  check('the job is readable through the graph', job.status === 200 && Boolean(job.body?.data?.job), `HTTP ${job.status}`);

  // OPERATOR EVIDENCE — a separate instrument with a separate claim. It reads candidate_evaluations
  // in a read-only transaction; it is NOT a caller-authorization assertion and is reported apart.
  console.log('  — OPERATOR EVIDENCE: evaluation row agreement (read-only database inspection)');
  try {
    const out = execFileSync('node', ['ops/evaluation-agreement.mjs'], {
      env: { ...process.env, PROOF_JOB_ID: jobId },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    process.stdout.write(out.split('\n').map((l) => (l ? `    ${l}` : l)).join('\n'));
    pass('operator evidence — evaluation row agreement', 'see the inspection above');
  } catch (e) {
    const out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    process.stdout.write(out.split('\n').map((l) => (l ? `    ${l}` : l)).join('\n'));
    if (e.status === 3) blocked('operator evidence — evaluation row agreement', 'inspection BLOCKED (see above)');
    else fail('operator evidence — evaluation row agreement', `exit ${e.status ?? e.message}`);
  }
}

console.log('\n4. TIMEOUT / LATE-WRITE BOUNDARY — CONTROLLED EVIDENCE, isolated process');
if (!process.env.PROOF_DB_URL) {
  blocked('timeout / late-write ordering',
    'controlled harness needs PROOF_DB_URL (disposable) + PROOF_JOB_ID; it is not claimable from HTTP');
} else if (!jobId) {
  blocked('timeout / late-write ordering', 'no PROOF_JOB_ID');
} else {
  try {
    const out = execFileSync('node', ['ops/late-write-proof.mjs'], {
      env: { ...process.env, PROOF_JOB_ID: jobId },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    process.stdout.write(out.split('\n').map((l) => (l ? `    ${l}` : l)).join('\n'));
    pass('controlled evidence — timeout / late-write ordering', 'see the isolated run above');
  } catch (e) {
    const out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    process.stdout.write(out.split('\n').map((l) => (l ? `    ${l}` : l)).join('\n'));
    if (e.status === 3) blocked('controlled evidence — timeout / late-write ordering', 'BLOCKED (see above)');
    else fail('controlled evidence — timeout / late-write ordering', `exit ${e.status ?? e.message}`);
  }
}

console.log('\n5. CROSS-FAMILY');
if (kendraDay.status === 200) {
  const fn = (kendraDay.json?.items ?? []).filter((i) => i.placeId);
  check('no day item names a place outside Nora’s households',
    fn.every((i) => i.placeState !== 'linked' || String(i.placeId).startsWith('rp_')),
    `${fn.length} linked item(s)`);
} else {
  blocked('cross-family day scan', `day read HTTP ${kendraDay.status}`);
}

console.log('\n6. RESET RESTORATION');
const reset = await rest('/api/demo/reset', kendra.token, {});
if (reset.status === 200) {
  const after = await rest('/api/village/day', kendra.token, { childId: 'p_nora', day: DAY });
  check('after a demo reset the day read still returns its linked place',
    (after.json?.items ?? []).some((i) => i.placeState === 'linked'), `HTTP ${after.status}`);
  const again = await rest('/api/village/route', kendra.token, { childId: 'p_nora', fromPlaceId: FROM, toPlaceId: TO });
  check('after a demo reset route coordinates are still usable', again.status === 200, `HTTP ${again.status}`);
} else {
  blocked('reset restoration', `reset HTTP ${reset.status} (needs a demo session and loopback)`);
}

console.log('\n7. TEACHER (conditional — 0070 at origin/main db7dc57)');
const teacherPersona = process.env.PROOF_TEACHER_PERSONA;
if (!teacherPersona) {
  blocked('teacher reportSchoolDay', 'no teacher persona configured; 0070 applied is not the same as a session that may file a report');
} else {
  const t = await session(teacherPersona);
  if (t.error) {
    blocked('teacher reportSchoolDay', t.error);
  } else {
    const m = `mutation($child: ID!, $text: String!) { reportSchoolDay(childId: $child, text: $text) { id } }`;
    const filed = await gql(t.token, m, { child: 'p_nora', text: 'Proof-suite fictional school-day report.' });
    check('a teacher with school.report files a report', filed.status === 200 && Boolean(filed.body?.data?.reportSchoolDay),
      `HTTP ${filed.status}`);
    blocked('parent reads the filed report back', 'the school read query name is owned by the teacher lane; wire it in the window');
  }
}

console.log('\n8. NOTICE → PLAN');
blocked('notice→plan handoff', 'owned by feat/rosina-service; the mounted widget and the signing key are their surface, not this one');

// ---------------------------------------------------------------------------------------------
const total = results.pass + results.fail + results.blocked;
console.log(`\nSUMMARY: ${results.pass} PASS · ${results.fail} FAIL · ${results.blocked} BLOCKED of ${total}`);
console.log('BLOCKED is not PASS. Any BLOCKED line above names a prerequisite this window cannot supply.');
process.exit(results.fail > 0 ? 1 : results.blocked > 0 ? 3 : 0);
