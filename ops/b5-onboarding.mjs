/**
 * B5 remainder — Dana's live onboarding against Postgres, and #18 as Walter.
 *
 * Runs entirely through the router, as the named caller, with the caller's own JWT.
 * The only write path is the graph's own mutations (approveRelationship, grantAccess);
 * the reset goes through the subgraph's documented /__reset control endpoint.
 *
 * Sequence:
 *   1. as Kendra: Dana is not a pickup candidate for Nora (baseline)
 *   2. as Kendra: approveRelationship(r_dana_friend_parent)  -> ACTIVE
 *   3. as Kendra: grantAccess(p_dana, p_nora, [pickup.request])
 *   4. as Kendra: pickupCandidates(p_nora) now includes Dana  (no restart between 3 and 4)
 *   5. as Kendra: re-read in a NEW request           -> still there (persisted, not in memory)
 *   6. db:reset -> baseline; Dana is gone again
 *   7. as Walter: pickupCandidates(p_nora) -> UNAUTHORIZED (grandparent, no pickup rights)
 *
 * Tokens are never printed or written. Evidence is written to docs/evidence/25-dana-onboarding-walter.md.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactBearer, tokenForPersonId } from './auth.mjs';

const ENDPOINT = process.env.FRIDGEGRAPH_ROUTER ?? 'http://127.0.0.1:4012/';
const RESET_URL = process.env.FRIDGEGRAPH_RESET_URL ?? 'http://127.0.0.1:4001/__reset';
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'docs', 'evidence', '25-dana-onboarding-walter.md');

const steps = [];

async function gql({ person, query, variables }) {
  const bearer = person ? await tokenForPersonId(person) : undefined;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  return { status: res.status, body, auth: redactBearer(bearer) };
}

function candidates(body) {
  const list = body?.data?.pickupCandidates;
  if (!Array.isArray(list)) return null;
  return list.map((c) => c.person?.displayName ?? c.person?.id);
}

async function step(title, request, check) {
  const result = await gql(request);
  const names = candidates(result.body);
  const codes = (result.body.errors ?? []).map((e) => e.extensions?.code ?? e.message);
  const verdict = check({ names, codes, body: result.body });
  steps.push({ title, request, result, names, codes, verdict });
  console.log(`--- ${title}`);
  console.log(`    status=${result.status} codes=${codes.join('|') || 'none'} names=${names ? names.join(', ') : '(n/a)'}`);
  console.log(`    verdict=${verdict}`);
  return result;
}

const CANDIDATE_QUERY = `query Candidates($childId: ID!) {
  pickupCandidates(childId: $childId) { person { id displayName } reason }
}`;

await step(
  '1. Baseline as Kendra — Dana is NOT a candidate for Nora',
  { person: 'p_mom', query: CANDIDATE_QUERY, variables: { childId: 'p_nora' } },
  ({ names }) => (names && !names.includes('Dana Coleman') ? 'PASS (absent)' : 'FAIL (already present)'),
);

await step(
  '2. As Kendra — approveRelationship(r_dana_friend_parent)',
  {
    person: 'p_mom',
    query: `mutation Approve($id: ID!) { approveRelationship(relationshipId: $id) { id status } }`,
    variables: { id: 'r_dana_friend_parent' },
  },
  ({ body }) => (body?.data?.approveRelationship?.status === 'ACTIVE' ? 'PASS (ACTIVE)' : 'FAIL'),
);

await step(
  '3. As Kendra — grantAccess(p_dana, p_nora, [pickup.request])',
  {
    person: 'p_mom',
    query: `mutation Grant($actor: ID!, $child: ID!) {
      grantAccess(actorId: $actor, childId: $child, scopes: ["pickup.request"]) {
        id actor { id } child { id } scopes grantedBy { id }
      }
    }`,
    variables: { actor: 'p_dana', child: 'p_nora' },
  },
  ({ body }) => (body?.data?.grantAccess?.scopes?.includes('pickup.request') ? 'PASS (granted)' : 'FAIL'),
);

await step(
  '4. As Kendra — Dana now appears as a candidate (no restart)',
  { person: 'p_mom', query: CANDIDATE_QUERY, variables: { childId: 'p_nora' } },
  ({ names }) => (names && names.includes('Dana Coleman') ? 'PASS (present)' : 'FAIL (absent)'),
);

await step(
  '5. As Kendra — new request, still present (persisted in Postgres, not memory)',
  { person: 'p_mom', query: CANDIDATE_QUERY, variables: { childId: 'p_nora' } },
  ({ names }) => (names && names.includes('Dana Coleman') ? 'PASS (persisted)' : 'FAIL (lost)'),
);

// Reset to the seeded baseline through the documented control endpoint.
const reset = await fetch(RESET_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
const resetBody = await reset.json();
steps.push({
  title: '6. db:reset -> baseline (control endpoint /__reset)',
  request: { query: 'POST /__reset', variables: {} },
  result: { status: reset.status, body: resetBody, auth: '(control endpoint, no caller identity)' },
  names: null,
  codes: [],
  verdict: resetBody?.ok ? `PASS (rows deleted: ${JSON.stringify(resetBody.db?.deleted ?? null)})` : 'FAIL',
});
console.log(`--- 6. reset status=${reset.status} ok=${resetBody?.ok}`);

await step(
  '7. After reset — Dana is gone (baseline restored)',
  { person: 'p_mom', query: CANDIDATE_QUERY, variables: { childId: 'p_nora' } },
  ({ names }) => (names && !names.includes('Dana Coleman') ? 'PASS (absent)' : 'FAIL (leaked)'),
);

await step(
  '8. #18 as Walter — grandparent, no pickup rights -> UNAUTHORIZED',
  { person: 'p_walter', query: CANDIDATE_QUERY, variables: { childId: 'p_nora' } },
  ({ codes }) => (codes.includes('UNAUTHORIZED') ? 'PASS (UNAUTHORIZED)' : 'FAIL (not refused)'),
);

const md = [
  '# 25 — Dana onboarding against Postgres, and #18 as Walter',
  '',
  `- endpoint: \`${ENDPOINT}\``,
  `- run: ${new Date().toISOString()}`,
  '- identity: real Supabase password-grant JWTs per caller; tokens redacted, never stored',
  '- writes: only the graph mutations (`approveRelationship`, `grantAccess`); reset via `/__reset`',
  '',
  '## Steps',
  '',
  ...steps.flatMap((s) => [
    `### ${s.title}`,
    '',
    `- identity: ${s.result.auth}`,
    `- HTTP: ${s.result.status}${s.codes.length ? ` · codes: ${s.codes.join(', ')}` : ''}`,
    `- verdict: **${s.verdict}**`,
    '',
    '```graphql',
    String(s.request.query).trim(),
    '```',
    '',
    '```json',
    JSON.stringify(s.result.body, null, 2),
    '```',
    '',
  ]),
  '## What this proves',
  '',
  '- Onboarding is a real database change: the candidate list changed in a later request with no',
  '  restart, which only a database read can produce.',
  '- The reset restored the seeded baseline, so the shared database is left as it was found.',
  '- Authorization is unchanged by any of it: Walter, a grandparent with no pickup grant, is',
  '  refused with `UNAUTHORIZED` rather than an empty list.',
  '',
].join('\n');

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, md);

const failed = steps.filter((s) => s.verdict.startsWith('FAIL'));
console.log(`\nWROTE ${OUT}`);
console.log(`RESULT: ${failed.length === 0 ? 'ALL PASS' : `${failed.length} FAILED`}`);
if (failed.length > 0) process.exitCode = 1;
