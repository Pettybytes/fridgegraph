#!/usr/bin/env node
/**
 * ops/create-demo-family-proof.mjs — Group 5 Piece 2: createDemoFamily + its reset.
 *
 * Starts the demo-login app on a spare port (4316) and the school subgraph on 4317, so the running
 * demo stack is untouched. Real JWTs; the owner DB connection is used only to read what the endpoint
 * wrote (and the registry, which no browser can read at all).
 *
 * The reset at the end is `resetDemo()` — the same function the 4008 route calls, not `db:reset`.
 * Its whole point here is that a created family, its picker entry, its identity mapping and its
 * cached persona session all disappear, and its old access token stops identifying anyone.
 *
 * Run: node --import tsx ops/create-demo-family-proof.mjs
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

const DEMO_PORT = 4316;
const SCHOOL_PORT = 4317;
const DEMO = `http://127.0.0.1:${DEMO_PORT}`;
const SCHOOL = `http://127.0.0.1:${SCHOOL_PORT}/`;

const { tokenForPersonId } = await import('./auth.mjs');
const { loadEnv } = await import('../src/env.ts');
loadEnv();
const { createDemoLoginApp } = await import('../src/demo/server.ts');
const { startSubgraph } = await import('../src/server.ts');
const school = (await import('../src/subgraphs/school.ts')).default;
const { resetDemo } = await import('../src/demo/reset.ts');
const { __cachedAccessToken, personaSessionStats } = await import('../src/demo/persona-sessions.ts');

const app = createDemoLoginApp();
await new Promise((resolve) => app.listen(DEMO_PORT, '127.0.0.1', resolve));
await startSubgraph({ name: 'school-proof', port: SCHOOL_PORT, ...school });

const db = new pg.Client({ connectionString: env.SUPABASE_DB_URL.replace(/["'\s\r]/g, ''), ssl: { rejectUnauthorized: false } });
await db.connect();

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};

const post = async (path, body, token) => {
  const res = await fetch(DEMO + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body ?? {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const get = async (path) => {
  const res = await fetch(DEMO + path);
  return { status: res.status, body: await res.json().catch(() => null) };
};
const gql = async (token, query, variables) => {
  const res = await fetch(SCHOOL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
};

const mom = await tokenForPersonId('p_mom');
const guide = await tokenForPersonId('p_demo_guide');

console.log('=== createDemoFamily ===');

// 1. No identity at all.
let r = await post('/api/demo/family', { parentName: 'Proof Parent', childName: 'Proof Child' });
check('no token refused', r.status === 401 && r.body?.error === 'UNAUTHENTICATED', `${r.status} ${r.body?.error}`);

// 2. The guide is read-only and must not create one.
r = await post('/api/demo/family', { parentName: 'Guide Parent', childName: 'Guide Child' }, guide);
check('Demo guide refused', r.status === 403 && r.body?.error === 'DEMO_GUIDE_READ_ONLY', `${r.status} ${r.body?.error}`);

// 3. Names are validated, and a refused create writes nothing.
const before = await db.query(`select count(*)::int n from demo_families`);
r = await post('/api/demo/family', { parentName: '   ', childName: 'Child' }, mom);
check('empty parent name refused', r.status === 400 && r.body?.error === 'INVALID_NAME', `${r.status} ${r.body?.error}`);
r = await post('/api/demo/family', { parentName: 'P'.repeat(81), childName: 'Child' }, mom);
check('over-long name refused', r.status === 400 && r.body?.error === 'INVALID_NAME', `${r.status} ${r.body?.error}`);
const afterInvalid = await db.query(`select count(*)::int n from demo_families`);
check('refused creates wrote no registry row', before.rows[0].n === afterInvalid.rows[0].n);

// 4. A demo parent creates one family.
r = await post('/api/demo/family', { parentName: 'Proof Parent', childName: 'Proof Child' }, mom);
const family = r.body;
check('demo parent creates a family', r.status === 201 && typeof family?.id === 'string' && family.parentName === 'Proof Parent',
  `${r.status} ${JSON.stringify(family)}`);

const reg = await db.query(`select * from demo_families where id = $1`, [family?.id]);
const row = reg.rows[0];
check('registry has exactly one row', reg.rowCount === 1);
check('DB identity mapping written (RLS current_person)',
  (await db.query(`select person_id from identity_map where user_id=$1`, [row?.auth_user_id])).rows[0]?.person_id === row?.person_id);
check('sandbox household created', (await db.query(`select sandbox from households where id=$1`, [row?.household_id])).rows[0]?.sandbox === true);
check('parent person + child person + memberships created',
  (await db.query(`select count(*)::int n from people where id in ($1,$2)`, [row?.person_id, row?.child_id])).rows[0].n === 2 &&
  (await db.query(`select count(*)::int n from household_members where household_id=$1`, [row?.household_id])).rows[0].n === 2 &&
  (await db.query(`select count(*)::int n from children where person_id=$1`, [row?.child_id])).rows[0].n === 1);

// 5. The picker sees it, and only then is it READY.
r = await get('/api/demo/health');
const entry = (r.body?.personas ?? []).find((p) => p.personaId === family?.id);
check('picker entry present and ready', entry?.ready === true, JSON.stringify(entry));

// 6. The new persona signs in like any other.
r = await post('/api/demo/login', { personaId: family?.id });
const session = r.body;
check('created persona signs in', session?.status === 'READY' && session.personId === row?.person_id,
  `${r.status} ${session?.status} ${session?.reason ?? ''}`);
check('created persona is marked demo, not guide', session?.marks?.demo === true && session?.marks?.demoGuide === false);
check('session was minted and cached by the owning process', typeof __cachedAccessToken(family?.id) === 'string' && personaSessionStats().mints >= 1);

// 7. Its own child is readable; somebody else's is not.
r = await gql(session?.session?.access_token, `query($c: ID!){ permissionSlips(childId:$c){ id } }`, { c: row?.child_id });
check('created persona reads its own child', Array.isArray(r.data?.permissionSlips) === true && !r.errors, JSON.stringify(r.errors ?? r.data));
r = await gql(mom, `query($c: ID!){ permissionSlips(childId:$c){ id } }`, { c: row?.child_id });
check('an existing persona cannot read the created child', r.errors?.[0]?.extensions?.code === 'UNAUTHORIZED', r.errors?.[0]?.extensions?.code ?? 'no error');

// 8. Reset removes everything the create added.
const report = await resetDemo('proof');
check('reset reports the created family removed', report.createdFamiliesRemoved === 1, JSON.stringify({ createdFamiliesRemoved: report.createdFamiliesRemoved }));
check('reset dropped the persona session cache', report.droppedSessionCache === true);
check('registry is empty', (await db.query(`select count(*)::int n from demo_families`)).rows[0].n === 0);
check('its rows are gone', (await db.query(`select count(*)::int n from people where id in ($1,$2)`, [row?.person_id, row?.child_id])).rows[0].n === 0 &&
  (await db.query(`select count(*)::int n from households where id=$1`, [row?.household_id])).rows[0].n === 0 &&
  (await db.query(`select count(*)::int n from villages where id=$1`, [row?.village_id])).rows[0].n === 0);
const map = JSON.parse(readFileSync('data/identity-map.json', 'utf8'));
check('file identity mapping removed', map[row?.auth_user_id] === undefined);
check('DB identity mapping removed', (await db.query(`select 1 from identity_map where user_id=$1`, [row?.auth_user_id])).rowCount === 0);
check('cached session for the persona is gone', __cachedAccessToken(family?.id) === undefined);

// 9. The old token now identifies nobody, and the persona cannot be picked again.
r = await gql(session?.session?.access_token, `query($c: ID!){ permissionSlips(childId:$c){ id } }`, { c: row?.child_id });
check('old token exposes nothing (UNAUTHENTICATED, not a denial)', r.errors?.[0]?.extensions?.code === 'UNAUTHENTICATED' && !r.data,
  r.errors?.[0]?.extensions?.code ?? 'no error');
r = await post('/api/demo/login', { personaId: family?.id });
check('picker entry no longer resolves', r.body?.status === 'UNAVAILABLE' && r.body?.reason === 'UNKNOWN_PERSONA', JSON.stringify(r.body));

const failed = results.filter((x) => !x.ok).length;
console.log(`\nRESULT: ${results.length - failed}/${results.length} PASS`);

writeFileSync('docs/evidence/53-create-demo-family.md', [
  '# 53 — Group 5 Piece 2: createDemoFamily, and reset removes every trace',
  '',
  `- endpoints: \`${DEMO}\` (demo-login app, spare port) + \`${SCHOOL}\` (school subgraph, spare port)`,
  '- identity: verified Supabase JWTs per caller; tokens in memory only, never written',
  '- reset: `resetDemo()` — the same function the 4008 route calls, not `db:reset`',
  '- schema: `demo_families` (0049), RLS forced with no policies (server-only registry)',
  '',
  '| # | Assertion | Result | Detail |',
  '|---|---|---|---|',
  ...results.map((x, i) => `| ${i + 1} | ${x.label} | ${x.ok ? 'PASS' : 'FAIL'} | ${String(x.detail).replace(/\|/g, '\\|')} |`),
  '',
  `**${results.length - failed}/${results.length} PASS**`,
  '',
].join('\n'));

await db.end();
process.exit(failed === 0 ? 0 : 1);
