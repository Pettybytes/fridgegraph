/**
 * Milestone 1 evidence runner.
 *
 * Runs every checkpoint through the Apollo Router (localhost:4010), and writes the query and the
 * raw response to docs/evidence/. Run order matters: the mutation block (11) changes state and
 * the last step resets it.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactBearer, tokenForPersonId } from './auth.mjs';

const ENDPOINT = process.env.FRIDGEGRAPH_ROUTER ?? 'http://127.0.0.1:4010/';
const RESET_URL = process.env.FRIDGEGRAPH_RESET_URL ?? 'http://127.0.0.1:4001/__reset';
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'docs', 'evidence');
mkdirSync(OUT_DIR, { recursive: true });

async function gql({ user, date, query, variables, extraHeaders }) {
  // Real sign-in per caller. Tokens stay in memory; only a redacted form reaches disk.
  const bearer = user ? await tokenForPersonId(user) : undefined;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...(date ? { 'x-demo-date': date } : {}),
      ...(extraHeaders ?? {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  return { status: res.status, body: await res.json(), auth: redactBearer(bearer) };
}

function writeEvidence(slug, { title, user, date, query, variables, extraHeaders, note }, result) {
  const md = [
    `# ${title}`,
    '',
    `- endpoint: \`${ENDPOINT}\``,
    `- identity: ${result.auth}  (verified Supabase JWT; token redacted, never stored)`,
    `- x-demo-date: \`${date ?? '(not sent)'}\`  (test clock; honoured only while DEMO_CLOCK=1)`,
    ...(extraHeaders ? [`- extra headers: \`${JSON.stringify(extraHeaders)}\``] : []),
    ...(note ? [`- note: ${note}`] : []),
    `- HTTP status: ${result.status}`,
    '',
    '## Query',
    '',
    '```graphql',
    query.trim(),
    '```',
    '',
    '## Variables',
    '',
    '```json',
    JSON.stringify(variables ?? {}, null, 2),
    '```',
    '',
    '## Response',
    '',
    '```json',
    JSON.stringify(result.body, null, 2),
    '```',
    '',
  ].join('\n');
  writeFileSync(join(OUT_DIR, `${slug}.md`), md);
}

// ---------------------------------------------------------------- assertions
// One expectation table keyed by slug. The cases and their titles above are unchanged; this only
// decides whether what came back is correct. A wrong status, a missing authorization code, a
// changed candidate count, or a denied caller seeing candidate names fails the run with a
// nonzero exit code.
const BASELINE_CANDIDATES = ['Loretta Brooks', 'Bryan Brooks', 'Tasha Ellison', 'Monique Davis'];
const DANA = 'Dana Coleman';
const ALL_CANDIDATES = [...BASELINE_CANDIDATES, DANA];

const failures = [];
let checksRun = 0;

function record(slug, label, ok, detail) {
  checksRun += 1;
  if (!ok) failures.push({ slug, label, detail });
}

const codesOf = (body) => (body?.errors ?? []).map((e) => e.extensions?.code ?? e.message);
const namesOf = (body) =>
  (body?.data?.pickupCandidates ?? []).map((c) => c.person?.displayName).filter(Boolean);

/**
 * A refused caller must not receive candidate data. This catches the failure mode where the
 * correct error code is returned alongside leaked rows.
 */
function noCandidateDisclosure(body, ok) {
  const raw = JSON.stringify(body ?? {});
  const leaked = ALL_CANDIDATES.filter((name) => raw.includes(name));
  ok('no candidate disclosure', leaked.length === 0, `leaked: ${leaked.join(', ')}`);
}

const CHECKS = {
  '01-kendra-full-view': (r, ok) => {
    ok('status 200', r.status === 200, `got ${r.status}`);
    ok('no errors', codesOf(r.body).length === 0, codesOf(r.body).join('|'));
    ok('child is p_nora', r.body?.data?.child?.id === 'p_nora', String(r.body?.data?.child?.id));
    const names = namesOf(r.body);
    ok('candidate count 4', names.length === 4, `got ${names.length}`);
    ok('Dana absent before onboarding', !names.includes(DANA), names.join(', '));
    ok(
      'approver is Kendra',
      r.body?.data?.approverFor?.approver?.displayName === 'Kendra Ellison',
      String(r.body?.data?.approverFor?.approver?.displayName),
    );
  },

  '01b-query-plan': (r, ok) => {
    ok('status 200', r.status === 200, `got ${r.status}`);
    ok('no errors', codesOf(r.body).length === 0, codesOf(r.body).join('|'));
    ok('candidate count 4', namesOf(r.body).length === 4, `got ${namesOf(r.body).length}`);
  },

  '02-approver-thursday': (r, ok) => {
    ok('status 200', r.status === 200, `got ${r.status}`);
    ok('no errors', codesOf(r.body).length === 0, codesOf(r.body).join('|'));
    ok(
      'Thursday approver is Andre',
      r.body?.data?.approverFor?.approver?.displayName === 'Andre Ellison',
      String(r.body?.data?.approverFor?.approver?.displayName),
    );
    const fyi = (r.body?.data?.approverFor?.fyiParents ?? []).map((p) => p.displayName);
    ok('Kendra is FYI', fyi.includes('Kendra Ellison'), fyi.join(', '));
  },

  '03-supervision-age-boundary': (r, ok) => {
    ok('status 200', r.status === 200, `got ${r.status}`);
    ok('no errors', codesOf(r.body).length === 0, codesOf(r.body).join('|'));
    const at26 = (r.body?.data?.at1026 ?? []).map((c) => c.person?.displayName);
    const at29 = (r.body?.data?.at1029 ?? []).map((c) => c.person?.displayName);
    ok('Leo excluded at 15', !at26.includes('Leo Ellison'), at26.join(', '));
    ok('Leo included at 16', at29.includes('Leo Ellison'), at29.join(', '));
    ok('Priya present both days', at26.includes('Priya Nair') && at29.includes('Priya Nair'), `${at26.join(',')} / ${at29.join(',')}`);
  },

  '04-loretta-goals-careplan-contact': (r, ok) => {
    ok('status 200', r.status === 200, `got ${r.status}`);
    const codes = codesOf(r.body);
    ok('two denials', codes.length === 2, codes.join('|'));
    ok('both UNAUTHORIZED', codes.every((c) => c === 'UNAUTHORIZED'), codes.join('|'));
    ok('carePlan withheld', r.body?.data?.carePlan === null, JSON.stringify(r.body?.data?.carePlan));
    ok('contactMethods withheld', r.body?.data?.person === null, JSON.stringify(r.body?.data?.person));
    ok(
      'approved goal still visible',
      r.body?.data?.goals?.[0]?.status === 'APPROVED',
      String(r.body?.data?.goals?.[0]?.status),
    );
  },

  '05a-walter-no-pickup': (r, ok) => {
    ok('status 200', r.status === 200, `got ${r.status}`);
    ok('UNAUTHORIZED', codesOf(r.body).includes('UNAUTHORIZED'), codesOf(r.body).join('|'));
    noCandidateDisclosure(r.body, ok);
  },

  '05c-dana-supervision-jax-empty': (r, ok) => {
    ok('status 200', r.status === 200, `got ${r.status}`);
    ok('no errors', codesOf(r.body).length === 0, codesOf(r.body).join('|'));
    ok(
      'empty list, not an error',
      Array.isArray(r.body?.data?.supervisionCandidates) && r.body.data.supervisionCandidates.length === 0,
      JSON.stringify(r.body?.data?.supervisionCandidates),
    );
  },

  '06a-daniel-careplan-today': (r, ok) => {
    ok('status 200', r.status === 200, `got ${r.status}`);
    ok('no errors', codesOf(r.body).length === 0, codesOf(r.body).join('|'));
    ok('carePlan visible', Boolean(r.body?.data?.carePlan?.text), JSON.stringify(r.body?.data?.carePlan));
  },

  '06b-chris-careplan-expired': (r, ok) => {
    ok('status 200', r.status === 200, `got ${r.status}`);
    ok('UNAUTHORIZED (window closed)', codesOf(r.body).includes('UNAUTHORIZED'), codesOf(r.body).join('|'));
    ok('carePlan withheld', r.body?.data?.carePlan === null, JSON.stringify(r.body?.data?.carePlan));
  },

  '06c-daniel-goals-denied': (r, ok) => {
    ok('status 200', r.status === 200, `got ${r.status}`);
    ok('UNAUTHORIZED', codesOf(r.body).includes('UNAUTHORIZED'), codesOf(r.body).join('|'));
  },

  '07a-gary-busroster-allowed': (r, ok) => {
    ok('status 200', r.status === 200, `got ${r.status}`);
    ok('no errors', codesOf(r.body).length === 0, codesOf(r.body).join('|'));
    ok('route 14', r.body?.data?.busRoster?.route === 'Route 14', String(r.body?.data?.busRoster?.route));
    ok('riding true', r.body?.data?.busRoster?.riding === true, String(r.body?.data?.busRoster?.riding));
  },

  '07b-gary-schedule-denied': (r, ok) => {
    ok('status 200', r.status === 200, `got ${r.status}`);
    ok('UNAUTHORIZED', codesOf(r.body).includes('UNAUTHORIZED'), codesOf(r.body).join('|'));
  },

  '07c-gary-careplan-denied': (r, ok) => {
    ok('status 200', r.status === 200, `got ${r.status}`);
    ok('UNAUTHORIZED', codesOf(r.body).includes('UNAUTHORIZED'), codesOf(r.body).join('|'));
    ok('carePlan withheld', r.body?.data?.carePlan === null, JSON.stringify(r.body?.data?.carePlan));
  },

  '08-angela-pickup-verify-vehicles': (r, ok) => {
    ok('status 200', r.status === 200, `got ${r.status}`);
    ok('no errors', codesOf(r.body).length === 0, codesOf(r.body).join('|'));
    ok('candidate count 4', namesOf(r.body).length === 4, `got ${namesOf(r.body).length}`);
  },

  '09a-ray-jax-careplan': (r, ok) => {
    ok('status 200', r.status === 200, `got ${r.status}`);
    ok('no errors', codesOf(r.body).length === 0, codesOf(r.body).join('|'));
    ok('carePlan visible to parent', Boolean(r.body?.data?.carePlan?.text), JSON.stringify(r.body?.data?.carePlan));
  },

  '09b-evelyn-jax-careplan': (r, ok) => {
    ok('status 200', r.status === 200, `got ${r.status}`);
    ok('UNAUTHORIZED', codesOf(r.body).includes('UNAUTHORIZED'), codesOf(r.body).join('|'));
    ok('carePlan withheld', r.body?.data?.carePlan === null, JSON.stringify(r.body?.data?.carePlan));
  },

  '10a-dana-nora-schedule-denied': (r, ok) => denyCase(r, ok),
  '10b-dana-nora-goals-denied': (r, ok) => denyCase(r, ok),
  '10c-dana-nora-careplan-denied': (r, ok) => denyCase(r, ok),
  '10d-loretta-jax-denied': (r, ok) => denyCase(r, ok),

  '11a-dana-absent-before': (r, ok) => {
    ok('status 200', r.status === 200, `got ${r.status}`);
    ok('no errors', codesOf(r.body).length === 0, codesOf(r.body).join('|'));
    const names = namesOf(r.body);
    ok('candidate count 4', names.length === 4, `got ${names.length}`);
    ok('Dana absent', !names.includes(DANA), names.join(', '));
  },

  '11b-loretta-cannot-approve': (r, ok) => {
    ok('status 200', r.status === 200, `got ${r.status}`);
    ok('UNAUTHORIZED', codesOf(r.body).includes('UNAUTHORIZED'), codesOf(r.body).join('|'));
    ok('no status change', r.body?.data?.approveRelationship === null, JSON.stringify(r.body?.data?.approveRelationship));
  },

  '11c-kendra-approves': (r, ok) => {
    ok('status 200', r.status === 200, `got ${r.status}`);
    ok('no errors', codesOf(r.body).length === 0, codesOf(r.body).join('|'));
    ok('ACTIVE', r.body?.data?.approveRelationship?.status === 'ACTIVE', String(r.body?.data?.approveRelationship?.status));
  },

  '11c2-kendra-grants': (r, ok) => {
    ok('status 200', r.status === 200, `got ${r.status}`);
    ok('no errors', codesOf(r.body).length === 0, codesOf(r.body).join('|'));
    const scopes = r.body?.data?.grantAccess?.scopes ?? [];
    ok('pickup.request granted', scopes.includes('pickup.request'), scopes.join(','));
    ok('validUntil 2026-11-30', r.body?.data?.grantAccess?.validUntil === '2026-11-30', String(r.body?.data?.grantAccess?.validUntil));
  },

  '11c3-approvals-exist': (r, ok) => {
    ok('status 200', r.status === 200, `got ${r.status}`);
    ok('no errors', codesOf(r.body).length === 0, codesOf(r.body).join('|'));
    const rows = r.body?.data?.approvals ?? [];
    ok('two approval rows', rows.length === 2, `got ${rows.length}`);
    const decisions = rows.map((a) => a.decision).sort();
    ok('APPROVED + GRANTED', JSON.stringify(decisions) === JSON.stringify(['APPROVED', 'GRANTED']), decisions.join(','));
  },

  '11d-dana-now-candidate': (r, ok) => {
    ok('status 200', r.status === 200, `got ${r.status}`);
    ok('no errors', codesOf(r.body).length === 0, codesOf(r.body).join('|'));
    const names = namesOf(r.body);
    ok('candidate count 5', names.length === 5, `got ${names.length}`);
    ok('Dana appears exactly once', names.filter((n) => n === DANA).length === 1, names.join(', '));
  },

  '11e-dana-careplan-still-denied': (r, ok) => {
    ok('status 200', r.status === 200, `got ${r.status}`);
    ok('UNAUTHORIZED (scope is pickup.request only)', codesOf(r.body).includes('UNAUTHORIZED'), codesOf(r.body).join('|'));
    ok('carePlan withheld', r.body?.data?.carePlan === null, JSON.stringify(r.body?.data?.carePlan));
  },

  '11f2-dana-absent-after-reset': (r, ok) => {
    ok('status 200', r.status === 200, `got ${r.status}`);
    ok('no errors', codesOf(r.body).length === 0, codesOf(r.body).join('|'));
    const names = namesOf(r.body);
    ok('candidate count 4', names.length === 4, `got ${names.length}`);
    ok('Dana gone after reset', !names.includes(DANA), names.join(', '));
  },

  '14a-no-token': (r, ok) => {
    ok('status 200', r.status === 200, `got ${r.status}`);
    ok('UNAUTHENTICATED', codesOf(r.body).includes('UNAUTHENTICATED'), codesOf(r.body).join('|'));
    noCandidateDisclosure(r.body, ok);
  },

  // Rejection may come from the router (401 AUTH_ERROR) or downstream (200 UNAUTHENTICATED).
  '14b-garbage-token': (r, ok) => {
    const codes = codesOf(r.body);
    const edge = r.status === 401 && codes.includes('AUTH_ERROR');
    const downstream = r.status === 200 && codes.includes('UNAUTHENTICATED');
    ok('rejected at edge or downstream', edge || downstream, `status=${r.status} codes=${codes.join('|') || 'none'}`);
    noCandidateDisclosure(r.body, ok);
  },
};

/** Shared shape for the cross-village denials: refused, and nothing leaked with the refusal. */
function denyCase(r, ok) {
  ok('status 200', r.status === 200, `got ${r.status}`);
  ok('UNAUTHORIZED', codesOf(r.body).includes('UNAUTHORIZED'), codesOf(r.body).join('|'));
  noCandidateDisclosure(r.body, ok);
}

function assertCase(slug, result) {
  const spec = CHECKS[slug];
  if (!spec) {
    record(slug, 'has an expectation', false, 'no assertion defined for this case');
    return;
  }
  spec(result, (label, pass, detail) => record(slug, label, pass, detail));
}

async function run(slug, title, req) {
  const result = await gql(req);
  writeEvidence(slug, { title, ...req }, result);
  assertCase(slug, result);
  const codes = (result.body.errors ?? []).map((e) => e.extensions?.code ?? e.message);
  const dataKeys = Object.keys(result.body.data ?? {});
  const summary = JSON.stringify(result.body).replace(/\s+/g, ' ');
  console.log(
    `--- ${slug} [${req.user ?? 'no-user'}${req.date ? ` @${req.date}` : ''}] status=${result.status} keys=${dataKeys.join(',')} errors=${codes.length ? codes.join('|') : 'none'}`,
  );
  console.log(summary.length > 900 ? `${summary.slice(0, 900)}…` : summary);
  return result;
}

const N = 'p_nora';
const J = 'p_jax';
const D_26 = '2026-10-26';
const D_29 = '2026-10-29';

// ---------------------------------------------------------------- 1
await run('01-kendra-full-view', 'As Kendra: Nora, today\'s schedule, pickupCandidates (contacts + vehicles), approverFor', {
  user: 'p_mom',
  date: D_26,
  query: `
query KendraView($childId: ID!, $date: String!) {
  child(id: $childId) {
    id
    person { displayName birthDate age(asOf: $date) }
  }
  events(childId: $childId, date: $date) { title start end location }
  practices(childId: $childId, date: $date) { start location group { name } }
  approverFor(childId: $childId, date: $date) {
    approver { displayName }
    fyiParents { displayName }
  }
  pickupCandidates(childId: $childId, asOf: $date) {
    person {
      displayName
      contactMethods(childId: $childId) { channel value preferred verified }
      vehicles { year make model color plate }
    }
    reason
    authorization
    availability
  }
}`,
  variables: { childId: N, date: D_26 },
});

// ---------------------------------------------------------------- 1b (query plan attempt)
await run('01b-query-plan', 'As Kendra: query plan for the composed operation', {
  user: 'p_mom',
  date: D_26,
  extraHeaders: { 'apollo-expose-query-plan': 'true' },
  query: `
query { pickupCandidates(childId: "p_nora", asOf: "2026-10-26") { person { displayName } reason } }`,
});

// ---------------------------------------------------------------- 2
await run('02-approver-thursday', 'approverFor on Thursday Oct 29 -> Andre, Kendra FYI', {
  user: 'p_mom',
  date: D_26,
  query: `
query { approverFor(childId: "${N}", date: "${D_29}") { approver { displayName } fyiParents { displayName } } }`,
});

// ---------------------------------------------------------------- 3
await run('03-supervision-age-boundary', 'supervisionCandidates: Leo excluded at 15, included at 16', {
  user: 'p_mom',
  date: D_26,
  query: `
query {
  at1026: supervisionCandidates(childId: "${N}", asOf: "${D_26}") { person { displayName } reason }
  at1029: supervisionCandidates(childId: "${N}", asOf: "${D_29}") { person { displayName } reason }
}`,
});

// ---------------------------------------------------------------- 4
await run('04-loretta-goals-careplan-contact', 'As Loretta: approved goal only, carePlan and Bryan contact denied', {
  user: 'p_gma',
  date: D_26,
  query: `
query {
  goals(childId: "${N}") { title status }
  carePlan(childId: "${N}") { text }
  person(id: "p_bryan") { displayName contactMethods(childId: "${N}") { channel value } }
}`,
});

// ---------------------------------------------------------------- 5
await run('05a-walter-no-pickup', 'As Walter: pickupCandidates -> UNAUTHORIZED (no pickup.verify)', {
  user: 'p_walter',
  date: D_26,
  note: 'Walter holds schedule.read and goals.read only, so he may not read the candidate list at all.',
  query: `query { pickupCandidates(childId: "${N}", asOf: "${D_26}") { person { displayName } } }`,
});

// 05b (Gloria) retired: Gloria has no Supabase auth user because the approved seed list is 13
// people and she is not among them. Walter in 05a already proves the schedule-only denial.
// Reinstating 05b requires approving a 14th identity. See docs/questions.md.

await run('05c-dana-supervision-jax-empty', 'As Dana (Jax\'s parent): supervisionCandidates(Jax) -> [] (authorized, none exist)', {
  user: 'p_dana',
  date: D_26,
  note: 'Authorized caller with no candidates returns an empty list, not an error.',
  query: `query { supervisionCandidates(childId: "${J}", asOf: "${D_26}") { person { displayName } } }`,
});

// ---------------------------------------------------------------- 6
await run('06a-daniel-careplan-today', 'As Daniel: carePlan allowed (grant window covers today)', {
  user: 'p_okafor',
  note: 'Daniel holds careplan.read for a window that covers the demo dates (2026-10-20..2026-11-30). No date header is sent, so this does not depend on DEMO_CLOCK.',
  query: `query { carePlan(childId: "${N}") { text } }`,
});

await run('06b-chris-careplan-expired', 'As Chris: carePlan -> UNAUTHORIZED (grant window closed 2026-09-30)', {
  user: 'p_chris',
  note: 'Chris holds careplan.read for Nora, but the window ended 2026-09-30 — before today, with no clock manipulation. Scope is present, so only the date check can explain the denial.',
  query: `query { carePlan(childId: "${N}") { text } }`,
});

await run('06c-daniel-goals-denied', 'As Daniel: goals denied', {
  user: 'p_okafor',
  date: D_26,
  query: `query { goals(childId: "${N}") { title } }`,
});

// ---------------------------------------------------------------- 7
// Split per field: a non-null list that is denied nulls the whole `data`, which would hide an
// allowed sibling field and make the evidence unreadable.
await run('07a-gary-busroster-allowed', 'As Gary: busRoster allowed (transport.read)', {
  user: 'p_holt',
  date: D_26,
  query: `query { busRoster(childId: "${N}", date: "${D_26}") { route riding date child { id } } }`,
});

await run('07b-gary-schedule-denied', 'As Gary: Nora\'s schedule denied', {
  user: 'p_holt',
  date: D_26,
  query: `query { events(childId: "${N}", date: "${D_26}") { title } }`,
});

await run('07c-gary-careplan-denied', 'As Gary: Nora\'s carePlan denied', {
  user: 'p_holt',
  date: D_26,
  query: `query { carePlan(childId: "${N}") { text } }`,
});

// ---------------------------------------------------------------- 8
await run('08-angela-pickup-verify-vehicles', 'As Angela: vehicles of Nora\'s pickupCandidates allowed (pickup.verify)', {
  user: 'p_price',
  date: D_26,
  query: `
query { pickupCandidates(childId: "${N}", asOf: "${D_26}") { person { displayName vehicles { plate } } } }`,
});

// ---------------------------------------------------------------- 9
await run('09a-ray-jax-careplan', "Ray Coleman (parent) has full access to Jax's carePlan", {
  user: 'p_ray',
  date: D_26,
  note: "Ray Coleman is Jax's parent. A parent of the child has full access, so this is correct.",
  query: `query { carePlan(childId: "${J}") { text } }`,
});

await run('09b-evelyn-jax-careplan', "Evelyn Carter (grandmother, no careplan.read) is UNAUTHORIZED", {
  user: 'p_evelyn',
  date: D_26,
  note: 'Her grant is [pickup.request, schedule.read]; CarePlan requires careplan.read. No grant was changed.',
  query: `query { carePlan(childId: "${J}") { text } }`,
});

// ---------------------------------------------------------------- 10
await run('10a-dana-nora-schedule-denied', 'As Dana: Nora\'s schedule denied (cross-village)', {
  user: 'p_dana',
  date: D_26,
  query: `query { events(childId: "${N}", date: "${D_26}") { title } }`,
});

await run('10b-dana-nora-goals-denied', 'As Dana: Nora\'s goals denied', {
  user: 'p_dana',
  date: D_26,
  query: `query { goals(childId: "${N}") { title } }`,
});

await run('10c-dana-nora-careplan-denied', 'As Dana: Nora\'s carePlan denied', {
  user: 'p_dana',
  date: D_26,
  query: `query { carePlan(childId: "${N}") { text } }`,
});

await run('10d-loretta-jax-denied', 'As Loretta: Jax\'s schedule denied (grant scoped to Nora)', {
  user: 'p_gma',
  date: D_26,
  query: `query { events(childId: "${J}", date: "${D_26}") { title } }`,
});

// ---------------------------------------------------------------- 11a
await run('11a-dana-absent-before', 'Before approving: Dana is not a pickupCandidate for Nora', {
  user: 'p_mom',
  date: D_26,
  query: `query { pickupCandidates(childId: "${N}", asOf: "${D_26}") { person { displayName } } }`,
});

// ---------------------------------------------------------------- 11b
await run('11b-loretta-cannot-approve', 'As Loretta: approveRelationship denied (not a parent)', {
  user: 'p_gma',
  date: D_26,
  query: `mutation { approveRelationship(relationshipId: "r_dana_friend_parent") { id status } }`,
});

// ---------------------------------------------------------------- 11c
await run('11c-kendra-approves', 'As Kendra: approveRelationship -> ACTIVE', {
  user: 'p_mom',
  date: D_26,
  query: `mutation { approveRelationship(relationshipId: "r_dana_friend_parent") { id status history { at event } } }`,
});

await run('11c2-kendra-grants', 'As Kendra: grantAccess Dana pickup.request until Nov 30', {
  user: 'p_mom',
  date: D_26,
  query: `
mutation {
  grantAccess(actorId: "p_dana", childId: "${N}", scopes: ["pickup.request"], validUntil: "2026-11-30") {
    id actor { displayName } scopes validFrom validUntil grantedBy { displayName }
  }
}`,
});

await run('11c3-approvals-exist', 'Two Approval rows exist after the two mutations', {
  user: 'p_mom',
  date: D_26,
  query: `query { approvals { id approver { displayName } subjectType subjectId decision at } }`,
});

// ---------------------------------------------------------------- 11d
await run('11d-dana-now-candidate', 'After grant: Dana appears once as a pickupCandidate with the Pacifica', {
  user: 'p_mom',
  date: D_26,
  query: `
query {
  pickupCandidates(childId: "${N}", asOf: "${D_26}") {
    person { displayName vehicles { year make model color plate } }
    reason
  }
  danaOnly: person(id: "p_dana") { displayName vehicles { year make model color plate } }
}`,
});

// ---------------------------------------------------------------- 11e
await run('11e-dana-careplan-still-denied', 'As Dana: Nora\'s carePlan still denied (scope is pickup.request only)', {
  user: 'p_dana',
  date: D_26,
  query: `query { carePlan(childId: "${N}") { text } }`,
});

// ---------------------------------------------------------------- 11f
{
  const res = await fetch(RESET_URL, { method: 'POST' });
  const body = await res.text();
  writeFileSync(
    join(OUT_DIR, '11f-reset.md'),
    [
      '# Reset restores the fixtures',
      '',
      `- endpoint: \`${RESET_URL}\` (same Node process, shared in-memory store)`,
      `- HTTP status: ${res.status}`,
      '',
      '## Response',
      '',
      '```json',
      body,
      '```',
      '',
    ].join('\n'),
  );
  console.log(`--- 11f-reset status=${res.status} body=${body}`);
  record('11f-reset', 'status 200', res.status === 200, `got ${res.status}`);
  let parsed = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = null;
  }
  record('11f-reset', 'reset reported ok', parsed?.ok === true && parsed?.reset === true, body.slice(0, 200));
}

await run('11f2-dana-absent-after-reset', 'After reset: Dana is gone from pickupCandidates again', {
  user: 'p_mom',
  date: D_26,
  query: `query { pickupCandidates(childId: "${N}", asOf: "${D_26}") { person { displayName } } }`,
});

// ---------------------------------------------------------------- 14 (identity failures)
await run('14a-no-token', 'No Authorization header -> UNAUTHENTICATED (unknown caller)', {
  date: D_26,
  note: 'No identity is sent at all. Failure code is UNAUTHENTICATED, not UNAUTHORIZED.',
  query: `query { pickupCandidates(childId: "${N}", asOf: "${D_26}") { reason } }`,
});

await run('14b-garbage-token', 'Malformed bearer token -> rejected (edge AUTH_ERROR or downstream UNAUTHENTICATED)', {
  date: D_26,
  extraHeaders: { authorization: 'Bearer not-a-jwt' },
  note: 'Rejection may come from the router (AUTH_ERROR) or the subgraph (UNAUTHENTICATED) depending on whether router-level JWT is active. Either way no data is returned and the caller stays unknown. The edge-specific assertion lives in evidence 16.',
  query: `query { pickupCandidates(childId: "${N}", asOf: "${D_26}") { reason } }`,
});

// ---------------------------------------------------------------- summary
const bySlug = new Map();
for (const f of failures) {
  if (!bySlug.has(f.slug)) bySlug.set(f.slug, []);
  bySlug.get(f.slug).push(f);
}

console.log(`\nAssertions: ${checksRun} checks across ${Object.keys(CHECKS).length + 1} cases`);
if (failures.length === 0) {
  console.log('ASSERTIONS: PASS — every case matched its expected status, code, count and disclosure rule.');
} else {
  console.error(`ASSERTIONS: FAIL — ${failures.length} failed check(s) in ${bySlug.size} case(s):`);
  for (const [slug, list] of bySlug) {
    for (const f of list) console.error(`  ${slug}: ${f.label} (${f.detail})`);
  }
  process.exitCode = 1;
}

console.log('Done. Evidence written to docs/evidence/');
