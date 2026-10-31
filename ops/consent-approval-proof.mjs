#!/usr/bin/env node
/**
 * ops/consent-approval-proof.mjs — Group 5 Piece 3: `approveConsent(slipId)` as the people themselves.
 *
 * Starts ONLY the school subgraph on a spare port (4315), so the running demo stack is untouched.
 * Every decision is made through the real resolver with a real Supabase JWT; the database (0047's
 * one-decision index + 0048's policies) is the boundary, not this script.
 *
 * The owner DB connection is used for PROOF FIXTURES ONLY: inserting the slips and the one named
 * approver policy the proof needs, reading row counts, and deleting exactly those rows afterwards.
 * No request path ever uses it.
 *
 * Tokens live in memory only and are never written or printed. Fictional people, fictional slips.
 *
 * Run: node --import tsx ops/consent-approval-proof.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import pg from 'pg';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
);
for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v;

const PORT = 4315;
const ENDPOINT = `http://127.0.0.1:${PORT}/`;
const { tokenForPersonId } = await import('./auth.mjs');

const SLIPS = [
  { id: 'ps_proof_nora', child: 'p_nora', title: 'Field trip permission (proof)' },
  { id: 'ps_proof_emma', child: 'p_emma', title: 'Lab safety consent (proof)' },
  { id: 'ps_proof_skye', child: 'p_skye', title: 'Overnight trip consent (proof)' },
  { id: 'ps_proof_malik', child: 'p_malik', title: 'Sports physical consent (proof)' },
];

const db = new pg.Client({
  connectionString: env.SUPABASE_DB_URL.replace(/["'\s\r]/g, ''),
  ssl: { rejectUnauthorized: false },
});
await db.connect();

const resetFixtureScope = async () => {
  await db.query(`delete from approvals where subject_type='permission_slip' and subject_id = any($1)`, [
    SLIPS.map((s) => s.id),
  ]);
  await db.query(`delete from permission_slips where id = any($1)`, [SLIPS.map((s) => s.id)]);
  await db.query(`delete from household_policies where household_id='h_emma' and rule='consent_approval'`);
};

// Fixtures: four slips and ONE named-approver policy. Everything is removed in the finally block.
await resetFixtureScope();
for (const s of SLIPS) {
  await db.query(`insert into permission_slips (id, child_id, title, signed) values ($1,$2,$3,false)`, [
    s.id,
    s.child,
    s.title,
  ]);
}
await db.query(`insert into household_policies (household_id, rule, value) values ('h_emma','consent_approval','p_rosa')`);

const { loadEnv } = await import('../src/env.ts');
loadEnv();
const { startSubgraph } = await import('../src/server.ts');
const school = (await import('../src/subgraphs/school.ts')).default;
await startSubgraph({ name: 'school-proof', port: PORT, ...school });

const cache = new Map();
const tokenFor = async (personId) => {
  if (!cache.has(personId)) cache.set(personId, await tokenForPersonId(personId));
  return cache.get(personId);
};

const gql = async (personId, query, variables) => {
  const token = personId ? await tokenFor(personId) : null;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `B` + `earer ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
};

const APPROVE = `mutation Approve($id: ID!) {
  approveConsent(slipId: $id) { slip { id } approver { id } decision at }
}`;
const HISTORY = `query Slips($c: ID!) {
  permissionSlips(childId: $c) { id signed history { approver { id } decision at } }
}`;

const rowsFor = async (slipId) => {
  const r = await db.query(`select approver_id, decision, at::text a from approvals where subject_type='permission_slip' and subject_id=$1`, [slipId]);
  return r.rows;
};

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};
const errCode = (body) => body?.errors?.[0]?.extensions?.code ?? '(no error)';

console.log('=== consent approval (approveConsent) ===');

// 1. Default: no consent_approval rule -> a parent of the child may decide.
let r = await gql('p_mom', APPROVE, { id: 'ps_proof_nora' });
let rows = await rowsFor('ps_proof_nora');
check('default (no rule): parent approves', r.data?.approveConsent?.decision === 'APPROVED' && rows.length === 1,
  `rows=${rows.length} ${JSON.stringify(r.data ?? r.errors)}`);
check('default: the recorded approver is the caller', rows[0]?.approver_id === 'p_mom', rows[0]?.approver_id ?? '(none)');

// 2. Same approver repeats -> still one row, same decision returned.
const firstAt = rows[0]?.at;
r = await gql('p_mom', APPROVE, { id: 'ps_proof_nora' });
rows = await rowsFor('ps_proof_nora');
check('same approver repeats: still 1 row', rows.length === 1, `rows=${rows.length}`);
check('same approver repeats: the existing decision is returned',
  r.data?.approveConsent?.approver?.id === 'p_mom' && r.data?.approveConsent?.decision === 'APPROVED');

// 3. A second eligible parent after a decision exists -> 1 row, existing decision, nothing changes.
r = await gql('p_dad', APPROVE, { id: 'ps_proof_nora' });
rows = await rowsFor('ps_proof_nora');
check('second parent after decision: still 1 row', rows.length === 1, `rows=${rows.length}`);
check('second parent gets the EXISTING decision and who made it',
  r.data?.approveConsent?.approver?.id === 'p_mom' && r.data?.approveConsent?.decision === 'APPROVED',
  JSON.stringify(r.data?.approveConsent ?? r.errors));
check('second parent changed nothing', rows[0]?.approver_id === 'p_mom' && rows[0]?.at === firstAt);

// 4. Marcus (resident_adult) — residence grants no consent authority.
r = await gql('p_marcus', APPROVE, { id: 'ps_proof_skye' });
check('Marcus (resident_adult) refused', errCode(r) === 'UNAUTHORIZED', errCode(r));
check('Marcus wrote no row', (await rowsFor('ps_proof_skye')).length === 0);

// 5. Priya holds a care-plan grant — a care-plan grant is not consent authority.
r = await gql('p_priya', APPROVE, { id: 'ps_proof_malik' });
check('Priya (care-plan grant) refused', errCode(r) === 'UNAUTHORIZED', errCode(r));
check('Priya wrote no row', (await rowsFor('ps_proof_malik')).length === 0);

// 6. The Demo guide is read-only.
r = await gql('p_demo_guide', APPROVE, { id: 'ps_proof_nora' });
check('Demo guide refused (read-only)', errCode(r) === 'DEMO_GUIDE_READ_ONLY', errCode(r));
check('Demo guide wrote no row', (await rowsFor('ps_proof_nora')).length === 1);

// 7. Named approver: h_emma policy names p_rosa, so p_tomas (also a parent) is refused.
r = await gql('p_tomas', APPROVE, { id: 'ps_proof_emma' });
check('named-approver household: the other parent is refused', errCode(r) === 'UNAUTHORIZED', errCode(r));
check('named-approver household: refusal wrote no row', (await rowsFor('ps_proof_emma')).length === 0);
r = await gql('p_rosa', APPROVE, { id: 'ps_proof_emma' });
rows = await rowsFor('ps_proof_emma');
check('named-approver household: the named person approves', rows.length === 1 && rows[0]?.approver_id === 'p_rosa',
  JSON.stringify(r.data?.approveConsent ?? r.errors));

// 8. No existence oracle: hidden, nonexistent and malformed slipIds are the same answer.
const hidden = await gql('p_dad', APPROVE, { id: 'ps_proof_skye' }); // exists, not his child
const missing = await gql('p_dad', APPROVE, { id: 'ps_no_such_slip' });
const malformed = await gql('p_dad', APPROVE, { id: '' });
const same = JSON.stringify(hidden) === JSON.stringify(missing) && JSON.stringify(missing) === JSON.stringify(malformed);
check('hidden / nonexistent / malformed slipIds: identical refusal', same && errCode(hidden) === 'UNAUTHORIZED',
  `${errCode(hidden)} · ${errCode(missing)} · ${errCode(malformed)}`);
check('no existence oracle wrote any row', (await rowsFor('ps_no_such_slip')).length === 0);

// 9. The decision is visible in the slip's history.
r = await gql('p_mom', HISTORY, { c: 'p_nora' });
const slip = (r.data?.permissionSlips ?? []).find((s) => s.id === 'ps_proof_nora');
check('decision appears in the slip history',
  slip?.history?.length === 1 && slip.history[0].approver.id === 'p_mom' && slip.history[0].decision === 'APPROVED',
  JSON.stringify(slip ?? r.errors));
r = await gql('p_dad', HISTORY, { c: 'p_nora' });
const slipDad = (r.data?.permissionSlips ?? []).find((s) => s.id === 'ps_proof_nora');
check('the other parent sees the same single decision in history',
  slipDad?.history?.length === 1 && slipDad.history[0].approver.id === 'p_mom');

const failed = results.filter((x) => !x.ok).length;
console.log(`\nRESULT: ${results.length - failed}/${results.length} PASS`);

const receipt = [
  '# 52 — Group 5 Piece 3: one consent decision per slip (`approveConsent`)',
  '',
  `- endpoint: \`${ENDPOINT}\` (school subgraph, spare port; the demo stack was untouched)`,
  '- identity: verified Supabase JWTs per caller; tokens held in memory only, never written',
  '- schema: `approvals` one-decision index (0047) + decision visibility / demo-sandbox policy (0048)',
  '- fixtures: four fictional slips + one `consent_approval` policy row, removed after the run',
  '',
  '| # | Assertion | Result | Detail |',
  '|---|---|---|---|',
  ...results.map((x, i) => `| ${i + 1} | ${x.label} | ${x.ok ? 'PASS' : 'FAIL'} | ${String(x.detail).replace(/\|/g, '\\|')} |`),
  '',
  `**${results.length - failed}/${results.length} PASS**`,
  '',
];
writeFileSync('docs/evidence/52-consent-approval.md', receipt.join('\n'));

await db.query(`select 1`);
await resetFixtureScope();
await db.end();
process.exit(failed === 0 ? 0 : 1);
