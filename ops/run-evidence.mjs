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

const ENDPOINT = process.env.FRIDGEGRAPH_ROUTER ?? 'http://127.0.0.1:4010/';
const RESET_URL = process.env.FRIDGEGRAPH_RESET_URL ?? 'http://127.0.0.1:4001/__reset';
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'docs', 'evidence');
mkdirSync(OUT_DIR, { recursive: true });

async function gql({ user, date, query, variables, extraHeaders }) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(user ? { 'x-demo-user': user } : {}),
      ...(date ? { 'x-demo-date': date } : {}),
      ...(extraHeaders ?? {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  return { status: res.status, body: await res.json() };
}

function writeEvidence(slug, { title, user, date, query, variables, extraHeaders, note }, result) {
  const md = [
    `# ${title}`,
    '',
    `- endpoint: \`${ENDPOINT}\``,
    `- x-demo-user: \`${user ?? '(none)'}\`  (INSECURE dev header)`,
    `- x-demo-date: \`${date ?? '(not sent)'}\``,
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

async function run(slug, title, req) {
  const result = await gql(req);
  writeEvidence(slug, { title, ...req }, result);
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

await run('05b-gloria-no-pickup', 'As Gloria: pickupCandidates -> UNAUTHORIZED (no pickup.verify)', {
  user: 'p_gloria',
  date: D_26,
  note: 'Gloria holds schedule.read and goals.read only.',
  query: `query { pickupCandidates(childId: "${N}", asOf: "${D_26}") { person { displayName } } }`,
});

await run('05c-dana-supervision-jax-empty', 'As Dana (Jax\'s parent): supervisionCandidates(Jax) -> [] (authorized, none exist)', {
  user: 'p_dana',
  date: D_26,
  note: 'Authorized caller with no candidates returns an empty list, not an error.',
  query: `query { supervisionCandidates(childId: "${J}", asOf: "${D_26}") { person { displayName } } }`,
});

// ---------------------------------------------------------------- 6
await run('06a-daniel-careplan-on-26', 'As Daniel (grant valid only Oct 26): carePlan allowed', {
  user: 'p_okafor',
  date: D_26,
  query: `query { carePlan(childId: "${N}") { text } }`,
});

await run('06b-daniel-careplan-on-27', 'As Daniel on Oct 27 (grant expired): carePlan denied', {
  user: 'p_okafor',
  date: '2026-10-27',
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
}

await run('11f2-dana-absent-after-reset', 'After reset: Dana is gone from pickupCandidates again', {
  user: 'p_mom',
  date: D_26,
  query: `query { pickupCandidates(childId: "${N}", asOf: "${D_26}") { person { displayName } } }`,
});

console.log('\nDone. Evidence written to docs/evidence/');
