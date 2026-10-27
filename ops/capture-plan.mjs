/**
 * Captures the query plan for evidence #1 through the router, using a real verified token.
 * Writes docs/evidence/01c-query-plan-full.md. Token is never written.
 */
import { writeFileSync } from 'node:fs';
import { redactBearer, tokenForPersonId } from './auth.mjs';

const ENDPOINT = process.env.FRIDGEGRAPH_ROUTER ?? 'http://127.0.0.1:4010/';
const QUERY = `query KendraView($childId: ID!, $date: String!) {
  child(id: $childId) { id person { displayName birthDate age(asOf: $date) } }
  events(childId: $childId, date: $date) { title start end location }
  practices(childId: $childId, date: $date) { start location group { name } }
  approverFor(childId: $childId, date: $date) { approver { displayName } fyiParents { displayName } }
  pickupCandidates(childId: $childId, asOf: $date) {
    person {
      displayName
      contactMethods(childId: $childId) { channel value preferred verified }
      vehicles { year make model color plate }
    }
    reason authorization availability
  }
}`;

const bearer = await tokenForPersonId('p_mom');

const res = await fetch(ENDPOINT, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    authorization: `Bearer ${bearer}`,
    'x-demo-date': '2026-10-26',
    'apollo-expose-query-plan': 'true',
  },
  body: JSON.stringify({ query: QUERY, variables: { childId: 'p_nora', date: '2026-10-26' } }),
});
const body = await res.json();
if (!body.extensions?.apolloQueryPlan) {
  console.error('router returned no query plan:', JSON.stringify(body).slice(0, 300));
  process.exit(1);
}

const plan = body.extensions.apolloQueryPlan.object.node;
const out = [];
(function walk(node, depth) {
  if (!node) return;
  if (node.kind === 'Fetch') out.push(`${' '.repeat(depth)}Fetch -> ${node.serviceName}`);
  if (node.kind === 'Flatten') out.push(`${' '.repeat(depth)}Flatten [${node.path.join('.')}]`);
  if (node.kind === 'Sequence' || node.kind === 'Parallel') {
    out.push(`${' '.repeat(depth)}${node.kind}`);
    node.nodes.forEach((child) => walk(child, depth + 1));
  } else if (node.node) walk(node.node, depth);
})(plan, 0);

const md = [
  '# Query plan for evidence #1 (full Kendra view)',
  '',
  `- endpoint: \`${ENDPOINT}\``,
  `- identity: ${redactBearer(bearer)}  (verified Supabase JWT; token redacted)`,
  '- x-demo-date: `2026-10-26` (test clock)',
  '- Router: 2.18.0',
  '',
  '## Fetch order (traversal of `extensions.apolloQueryPlan`)',
  '',
  '```',
  ...out,
  '```',
  '',
  '## Raw plan',
  '',
  '```json',
  JSON.stringify(body.extensions, null, 2),
  '```',
  '',
].join('\n');

writeFileSync('docs/evidence/01c-query-plan-full.md', md);
console.log('wrote docs/evidence/01c-query-plan-full.md');
console.log(out.join('\n'));
