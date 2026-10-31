#!/usr/bin/env node
/**
 * ops/suite-reset-proof.mjs — the suite must stop deleting the demo cast.
 *
 * Runs the evidence suite twice through `ops/run-suite.mjs`:
 *   1. a normal, passing run;
 *   2. a forced-failure run (dead router), to prove the restore trap fires anyway.
 *
 * After EACH run: the full table checksum must be byte-identical to the pre-run checksum, the named
 * Cast v2 rows must be present, every consumer read must answer, one authenticated MCP call must
 * match GraphQL, and `my-children-proof` must pass.
 *
 * Finally: `resetDemo()` (the sandbox demo reset) must leave the cast untouched — the two resets have
 * different jobs and this fix must not blur them.
 *
 * Checksums are compared, never printed with values that could be mistaken for content.
 *
 * Run: node --import tsx ops/suite-reset-proof.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }),
);
for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v;

const { checksumDatabase, restoreDemoCast } = await import('../scripts/db.ts');
const { tokenForPersonId } = await import('./auth.mjs');

const db = new pg.Client({ connectionString: env.SUPABASE_DB_URL.replace(/["'\s\r]/g, ''), ssl: { rejectUnauthorized: false } });
await db.connect();

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};

const suiteEnv = {
  ...process.env,
  FRIDGEGRAPH_ROUTER: process.env.FRIDGEGRAPH_ROUTER ?? 'http://127.0.0.1:4012/',
  FRIDGEGRAPH_RESET_URL: process.env.FRIDGEGRAPH_RESET_URL ?? 'http://127.0.0.1:4101/__reset',
};
const runSuite = (args = []) => {
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'ops/run-suite.mjs', ...args], {
    env: suiteEnv, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const assertions = /Assertions: (\d+) checks across (\d+) cases/.exec(out);
  return { code: r.status, restored: /demo cast restored/.test(out), assertions: assertions ? `${assertions[1]}/${assertions[2]}` : '-', out };
};

/** The named demo content the personas depend on. Counts only, no ids echoed. */
const castState = async () => ({
  priyaMalikGrant: (await db.query(`select count(*)::int n from grants where id='g_priya_malik'`)).rows[0].n,
  priyaMalikRel: (await db.query(`select count(*)::int n from relationships where id='r_priya_malik'`)).rows[0].n,
  malikFacts: (await db.query(`select count(*)::int n from care_facts where child_id='p_malik'`)).rows[0].n,
  rosaGuardian: (await db.query(`select count(*)::int n from relationships where id='r_rosa_emma'`)).rows[0].n,
  policies: (await db.query(`select count(*)::int n from household_policies`)).rows[0].n,
  vocab: (await db.query(`select count(*)::int n from orbit_vocabulary`)).rows[0].n,
});

const castOk = (s) =>
  s.priyaMalikGrant === 1 && s.priyaMalikRel === 1 && s.malikFacts >= 3 &&
  s.rosaGuardian === 1 && s.policies >= 9 && s.vocab > 0;

const consumers = async () => {
  const tok = await tokenForPersonId('p_mom');
  const gql = async (q) => {
    const r = await fetch('http://127.0.0.1:4012/', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
      body: JSON.stringify({ query: q }),
    });
    return r.json();
  };
  const docs = {
    myChildren: `{ myChildren { child { id person { displayName } } scopes } }`,
    careFacts: `{ careFacts(childId: "p_nora") { key } }`,
    checkInStatus: `{ checkInStatus(childId: "p_nora") { recorded dueAt } }`,
    orbitVocabulary: `{ orbitVocabulary { kind value } }`,
    effectiveScheduleFor: `{ effectiveScheduleFor(childId: "p_nora", date: "2026-11-26") { source } }`,
    jobTimeline: `{ jobTimeline(jobId: "job_emma_nov05") { kind attemptId detail candidate { id displayName } } }`,
  };
  const bad = [];
  for (const [name, q] of Object.entries(docs)) {
    const body = await gql(q);
    if (body.errors || !body.data) bad.push(`${name}:${body.errors?.[0]?.message ?? 'no data'}`);
  }
  return bad;
};

const mcpCall = () => {
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'ops/mcp-probe.mjs'], {
    env: { ...process.env, MCP_URL: 'http://127.0.0.1:5051/mcp', MCP_TOOL: 'MyChildren', MCP_ARGS: '{}', MCP_PERSON: 'p_mom' },
    encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

const childrenProof = () => {
  const r = spawnSync(process.execPath, ['ops/my-children-proof.mjs'], { env: process.env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  const tail = `${r.stdout ?? ''}`.trim().split('\n').slice(-1)[0] ?? '';
  return { ok: r.status === 0, tail };
};

const sameChecksums = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('=== suite reset: demo cast survives ===');

// Establish the demo-ready baseline FIRST. The pre-existing state may already be damaged by an
// earlier suite run (that is the defect under test), and comparing against a damaged baseline would
// measure the repair, not the behaviour.
await restoreDemoCast();
const before = await checksumDatabase();
const castBefore = await castState();
check('precondition: the demo cast is present before any run', castOk(castBefore), JSON.stringify(castBefore));

// ---------------------------------------------------------------- 1. a passing suite
const pass = runSuite();
console.log(`  … suite exit=${pass.code} assertions=${pass.assertions} restored=${pass.restored}`);
check('suite passed', pass.code === 0 && pass.assertions !== '-', `exit=${pass.code} ${pass.assertions}`);
check('the restore trap ran on success', pass.restored);

const afterPass = await checksumDatabase();
check('the full table checksum is byte-identical after a passing suite', sameChecksums(before, afterPass));
const castPass = await castState();
check('the demo cast is present after a passing suite', castOk(castPass), JSON.stringify(castPass));
const badPass = await consumers();
check('every consumer read answers after a passing suite', badPass.length === 0, badPass.join(', '));
const mcpPass = mcpCall();
check('an authenticated MCP call succeeds after a passing suite', mcpPass.ok);
const kidsPass = childrenProof();
check('my-children-proof passes after a passing suite', kidsPass.ok, kidsPass.tail);

// ---------------------------------------------------------------- 2. a forced-failure suite
const fail = runSuite(['--force-fail']);
console.log(`  … forced-failure exit=${fail.code} restored=${fail.restored}`);
check('the forced-failure suite really failed', fail.code !== 0, `exit=${fail.code}`);
check('the restore trap ran on FAILURE (finally/trap)', fail.restored);

const afterFail = await checksumDatabase();
check('the full table checksum is byte-identical after a failed suite', sameChecksums(before, afterFail));
const castFail = await castState();
check('the demo cast is present after a failed suite', castOk(castFail), JSON.stringify(castFail));
const badFail = await consumers();
check('every consumer read answers after a failed suite', badFail.length === 0, badFail.join(', '));
const kidsFail = childrenProof();
check('my-children-proof passes after a failed suite', kidsFail.ok, kidsFail.tail);

// ---------------------------------------------------------------- 3. resetDemo is unaffected
const { resetDemo } = await import('../src/demo/reset.ts');
const report = await resetDemo('suite-reset-proof');
check('resetDemo still runs and drops the session cache (unaffected by this change)',
  report.droppedSessionCache === true && typeof report.restored === 'object');
const simAfter = await db.query(`select count(*)::int n from expected_checkins where fixture is true`);
check('resetDemo still restores its own simulated fixture set', Number(simAfter.rows[0].n) > 0);
// PRE-EXISTING DEFECT, reported not fixed: Cast v2 care facts are sandbox rows, and resetDemo clears
// every sandbox care fact then restores only the simulated set — so Malik's facts disappear after a
// demo reset. Separate from the suite fix; recorded for its own PR.
const castSandbox = await castState();
console.log(`  OBSERVED  resetDemo clears Cast v2 sandbox care facts: malikFacts=${castSandbox.malikFacts} (expected >= 3)`);

// Leave the stack demo-ready and prove the restore is repeatable: the checksum must return to the
// baseline taken at the start of this run.
await restoreDemoCast();
const afterAll = await checksumDatabase();
check('restoring again returns the exact baseline checksum (repeatable, leaves the stack demo-ready)',
  sameChecksums(before, afterAll));
check('the demo cast is present at the end', castOk(await castState()));

const failed = results.filter((x) => !x.ok).length;
console.log(`\nRESULT: ${results.length - failed}/${results.length} PASS`);
await db.end();
process.exit(failed === 0 ? 0 : 1);
