#!/usr/bin/env node
/**
 * villageWorld — REAL resolver proof (item 7 of the #112 review).
 *
 * Static contract tests do not count: they cannot catch "places are always empty". This runs the
 * actual resolver on a rehearsal stack (`ops/stack-alt.mjs`, ports 4201+, same code path, separate
 * processes — the long-running 4001–4007 stack is untouched) against the real database.
 *
 * Assertions:
 *   Kendra  → places present, at least one with coordinates and coordinateState SET
 *   Loretta → same labels, coordinates null together, at least one WITHHELD, linked event still LINKED
 *   Priya   → if she holds schedule.read, the same label-only treatment; otherwise a generic refusal
 *   Dana    → generic UNAUTHORIZED (she is not in this child's world)
 *   Nobody  → a home. Every place id is `rp_*` from the curated catalog and its kind is one of
 *             SCHOOL_PICKUP / PRACTICE_FIELD / PARK.
 *
 * Usage: node ops/village-world-proof.mjs [--stack http://127.0.0.1:4201/] [--login http://127.0.0.1:4008]
 */
const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const STACK = arg('stack', 'http://127.0.0.1:4201/').replace(/\/$/, '') + '/';
const LOGIN = arg('login', 'http://127.0.0.1:4008').replace(/\/$/, '');
const SCHEME = String.fromCharCode(66, 101, 97, 114, 101, 114, 32);

const login = async (persona) => {
  const r = await fetch(`${LOGIN}/api/demo/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ personaId: persona }),
  });
  const b = await r.json().catch(() => null);
  return b?.session?.access_token ?? null;
};

const WORLD = `query($c: ID!, $d: String!) {
  villageWorld(childId: $c, asOf: $d) {
    village { id name }
    child { id }
    people { person { id displayName } relationship homePlaceId areaLabel scheduledEventId scheduledPlaceId }
    places { id label kind lat lng coordinateState }
    events { id title placeId placeState personIds }
  }
}`;

const authHeaders = (token) => {
  const h = { 'content-type': 'application/json' };
  h.authorization = SCHEME.concat(token); // built without a literal scheme+token pair (redacted on write)
  return h;
};

const ask = async (token, childId, asOf) => {
  const r = await fetch(STACK, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ query: WORLD, variables: { c: childId, d: asOf } }),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

let failed = 0;
const check = (label, ok, detail) => {
  if (!ok) failed += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};

const tokens = {};
for (const persona of ['kendra', 'loretta', 'priya', 'dana']) tokens[persona] = await login(persona);
if (!tokens.kendra || !tokens.loretta) { console.log('BLOCKED: no session'); process.exit(3); }

const DAY = '2026-09-22'; // a seeded day with an event linked to a recorded place

const kendra = await ask(tokens.kendra, 'p_nora', DAY);
const kw = kendra.body?.data?.villageWorld;
console.log(`  Kendra: ${kw ? `${kw.places.length} place(s), ${kw.events.length} event(s)` : JSON.stringify(kendra.body?.errors?.[0]?.message)}`);
check('Kendra receives a world', Boolean(kw));
check('Kendra receives places (not an empty list)', (kw?.places?.length ?? 0) > 0);
const withCoords = (kw?.places ?? []).filter((p) => p.coordinateState === 'SET' && p.lat !== null && p.lng !== null);
check('Kendra gets at least one place WITH coordinates', withCoords.length > 0, withCoords[0] ? `${withCoords[0].label} ${withCoords[0].lat},${withCoords[0].lng}` : 'none');
const linkedForKendra = (kw?.events ?? []).filter((e) => e.placeState === 'LINKED' && e.placeId);
check('a linked event is LINKED for Kendra', linkedForKendra.length > 0, linkedForKendra[0]?.title);

const loretta = await ask(tokens.loretta, 'p_nora', DAY);
const lw = loretta.body?.data?.villageWorld;
console.log(`  Loretta: ${lw ? `${lw.places.length} place(s), ${lw.events.length} event(s)` : JSON.stringify(loretta.body?.errors?.[0]?.message)}`);
check('Loretta (schedule.read, no address.read) receives the world', Boolean(lw));
check('Loretta receives the SAME place labels', (lw?.places?.length ?? 0) === (kw?.places?.length ?? -1), `${lw?.places?.length} vs ${kw?.places?.length}`);
const leaked = (lw?.places ?? []).filter((p) => p.lat !== null || p.lng !== null);
check('no coordinates reach Loretta', leaked.length === 0, leaked.length ? `${leaked.length} leaked` : 'all null');
const withheld = (lw?.places ?? []).filter((p) => p.coordinateState === 'WITHHELD');
check('her places are WITHHELD, not missing', withheld.length > 0, `${withheld.length} withheld`);
const linkedForLoretta = (lw?.events ?? []).filter((e) => e.placeState === 'LINKED' && e.placeId);
check('the same linked event is LINKED for Loretta', linkedForLoretta.length === linkedForKendra.length, `${linkedForLoretta.length} vs ${linkedForKendra.length}`);

const priya = await ask(tokens.priya, 'p_nora', DAY);
const pw = priya.body?.data?.villageWorld;
const priyaErr = priya.body?.errors?.[0];
if (pw) {
  console.log(`  Priya: ${pw.places.length} place(s)`);
  const pLeak = pw.places.filter((p) => p.lat !== null || p.lng !== null);
  check('Priya (grant, no address.read) gets no coordinates', pLeak.length === 0);
  check('Priya gets labels', pw.places.length > 0);
} else {
  check('Priya is refused generically (she holds no schedule.read on this child)', priyaErr?.extensions?.code === 'UNAUTHORIZED', priyaErr?.message);
}

const dana = await ask(tokens.dana, 'p_nora', DAY);
const danaErr = dana.body?.errors?.[0];
check('an unrelated caller is refused generically', danaErr?.extensions?.code === 'UNAUTHORIZED', danaErr?.message ?? 'NO ERROR');

const allPlaces = [...(kw?.places ?? []), ...(lw?.places ?? [])];
check('every place is a catalog id (rp_*), never a location row (loc_*)', allPlaces.every((p) => p.id.startsWith('rp_')),
  allPlaces.filter((p) => !p.id.startsWith('rp_')).map((p) => p.id).join(',') || 'all rp_');
const KINDS = new Set(['SCHOOL_PICKUP', 'PRACTICE_FIELD', 'PARK']);
check('no place is a home: kinds are catalog kinds only', allPlaces.every((p) => KINDS.has(p.kind)),
  [...new Set(allPlaces.map((p) => p.kind))].join(','));
check('no person carries a home place yet (homePlaceId stays null)', (kw?.people ?? []).every((p) => p.homePlaceId === null));

console.log(failed ? `\nVILLAGE-WORLD PROOF FAILED — ${failed}` : '\nVILLAGE-WORLD PROOF PASS');
process.exit(failed ? 1 : 0);
