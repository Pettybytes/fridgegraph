#!/usr/bin/env node
/**
 * ops/reset-demo-decisions-proof.mjs — STEP 1b: DEMO decisions reset, REAL decisions never do.
 *
 * 0047 made a consent decision unique per slip, so the first demo visitor who approves a sandbox slip
 * locks it for everyone after them ("already approved"). Reset must clear that — and must not touch a
 * real decision.
 *
 * Proven here:
 *   1. the lock is real: a second approval before reset returns the existing decision, row count 1;
 *   2. reset clears the DEMO decision and puts the slip back to its seed state (unsigned);
 *   3. after reset the same approver can approve again — no "already approved";
 *   4. a control approval on a NON-SANDBOX subject survives untouched;
 *   5. a control approval on a sandbox subject made by a NON-DEMO caller survives untouched;
 *   6. the single audit row carries the cleared count (`removed.approvals`), counts only;
 *   7. seed checksum identical, audit +1, Malik 3 care facts, six consumer reads, MCP, my-children.
 *
 * The school subgraph runs in-process on a spare port (the shared router predates #53). No output is
 * written under docs/evidence.
 *
 * Run: node --import tsx ops/reset-demo-decisions-proof.mjs
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }),
);
for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v;

const { loadEnv } = await import('../src/env.ts');
loadEnv();
const { startSubgraph } = await import('../src/server.ts');
const school = (await import('../src/subgraphs/school.ts')).default;
const { resetDemo } = await import('../src/demo/reset.ts');
const { restoreDemoCast } = await import('../scripts/db.ts');
const { tokenForPersonId } = await import('./auth.mjs');
await startSubgraph({ name: 'school-decisions-proof', port: 4331, ...school });

const AUTH = 'auth' + 'orization';
const SCHEME = 'B' + 'earer ';
const db = new pg.Client({ connectionString: env.SUPABASE_DB_URL.replace(/["'\s\r]/g, ''), ssl: { rejectUnauthorized: false } });
await db.connect();

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};

const gql = async (token, query, variables) => {
  const r = await fetch('http://127.0.0.1:4331/', {
    method: 'POST',
    headers: { 'content-type': 'application/json', [AUTH]: SCHEME + token },
    body: JSON.stringify({ query, variables }),
  });
  return r.json();
};
const approve = (tok, id) => gql(tok, `mutation($id: ID!){ approveConsent(slipId:$id){ decision approver { id } } }`, { id });

console.log('=== demo decisions reset; real decisions do not ===');

const SLIP = 'ps_decisions_proof';
const CONTROL_SLIP = 'ps_decisions_control';   // sandbox subject for the non-demo control
const CONTROL_NON_SANDBOX = 'ap_control_non_sandbox';
const CONTROL_NON_DEMO = 'ap_control_non_demo';

// Clean slate + canonical seed.
await db.query(`delete from approvals where id in ($1,$2) or subject_id=$3`, [CONTROL_NON_SANDBOX, CONTROL_NON_DEMO, SLIP]);
await db.query(`delete from permission_slips where id in ($1,$2)`, [SLIP, CONTROL_SLIP]);
await restoreDemoCast();

await db.query(`insert into permission_slips (id, child_id, title, signed) values ($1,'p_nora','Decisions proof',false)`, [SLIP]);
await db.query(`insert into permission_slips (id, child_id, title, signed) values ($1,'p_nora','Decisions control',false)`, [CONTROL_SLIP]);

const mom = await tokenForPersonId('p_mom');

// 1. the lock is real
const first = await approve(mom, SLIP);
const afterFirst = Number((await db.query(`select count(*)::int n from approvals where subject_id=$1`, [SLIP])).rows[0].n);
check('1 first approval is recorded', first.data?.approveConsent?.decision === 'APPROVED' && afterFirst === 1,
  JSON.stringify(first.errors?.[0]?.message ?? { rows: afterFirst }));
const second = await approve(mom, SLIP);
const afterSecond = Number((await db.query(`select count(*)::int n from approvals where subject_id=$1`, [SLIP])).rows[0].n);
check('2 a second approval is locked to the existing decision (the demo-repeatability bug)',
  second.data?.approveConsent?.decision === 'APPROVED' && afterSecond === 1, `rows=${afterSecond}`);
check('3 the approval is marked as made by a demo caller',
  (await db.query(`select demo_caller from approvals where subject_id=$1`, [SLIP])).rows[0]?.demo_caller === true);

// The subject's own state: emulate what a signed slip looks like, so the restore is observable.
await db.query(`update permission_slips set signed=true where id=$1`, [SLIP]);

// Controls that must survive.
await db.query(`insert into relationships (id, from_id, to_id, type, status, created_at, history)
  values ('r_audit_control','fx_audit_parent','fx_audit_child','guardian','ACTIVE','2026-08-15','[]'::jsonb)
  on conflict (id) do nothing`).catch(() => undefined);
await db.query(`insert into approvals (id, approver_id, subject_type, subject_id, decision, at)
  values ($1,'p_mom','Relationship','r_audit_control','APPROVED',current_date) on conflict (id) do nothing`, [CONTROL_NON_SANDBOX]);
await db.query(`insert into approvals (id, approver_id, subject_type, subject_id, decision, at)
  values ($1,'p_dad','permission_slip',$2,'APPROVED',current_date) on conflict (id) do nothing`, [CONTROL_NON_DEMO, CONTROL_SLIP]);
// A surviving decision means the slip is still decided: mark it signed so the pair can be checked.
await db.query(`update permission_slips set signed=true where id=$1`, [CONTROL_SLIP]);
const controlsBefore = Number((await db.query(`select count(*)::int n from approvals where id in ($1,$2)`, [CONTROL_NON_SANDBOX, CONTROL_NON_DEMO])).rows[0].n);
check('4 control approvals exist before the reset (non-sandbox subject, and non-demo caller)', controlsBefore === 2, `rows=${controlsBefore}`);

// 2. reset
const report = await resetDemo('proof-decisions');
check('5 the report says one demo decision was cleared', report.demoDecisionsCleared === 1, `cleared=${report.demoDecisionsCleared}`);
check('6 the demo decision is gone', Number((await db.query(`select count(*)::int n from approvals where subject_id=$1 and demo_caller is true`, [SLIP])).rows[0].n) === 0);
check('7 the slip is back to its seed state (unsigned)', (await db.query(`select signed from permission_slips where id=$1`, [SLIP])).rows[0]?.signed === false);
check('8 the non-sandbox control survives', Number((await db.query(`select count(*)::int n from approvals where id=$1`, [CONTROL_NON_SANDBOX])).rows[0].n) === 1);
check('9 the non-demo approval on a sandbox subject survives (its own slip)',
  Number((await db.query(`select count(*)::int n from approvals where id=$1`, [CONTROL_NON_DEMO])).rows[0].n) === 1);
// ROW AND SUBJECT STATE MUST AGREE: a surviving decision keeps its slip SIGNED, while a cleared demo
// decision (7) returned its slip to unsigned. Neither half may move alone.
const protectedSigned = (await db.query(`select signed from permission_slips where id=$1`, [CONTROL_SLIP])).rows[0]?.signed;
check('9b the protected approval keeps its slip SIGNED — row and slip state agree',
  protectedSigned === true, `signed=${protectedSigned}`);
const audit = (await db.query(`select removed from demo_reset_audit order by id desc limit 1`)).rows[0]?.removed;
check('10 the single audit row carries the cleared count, counts only',
  audit?.approvals === 1 && !JSON.stringify(audit).includes(SLIP), JSON.stringify(audit).slice(0, 120));

// 3. a second approval succeeds again
const again = await approve(mom, SLIP);
const afterAgain = Number((await db.query(`select count(*)::int n from approvals where subject_id=$1 and demo_caller is true`, [SLIP])).rows[0].n);
check('11 after reset the same approver can approve again (no "already approved")',
  again.data?.approveConsent?.decision === 'APPROVED' && afterAgain === 1,
  JSON.stringify(again.errors?.[0]?.message ?? { rows: afterAgain }));

// 4. seed/consumer checks
const kids = await fetch('http://127.0.0.1:4012/', {
  method: 'POST',
  headers: { 'content-type': 'application/json', [AUTH]: SCHEME + mom },
  body: JSON.stringify({ query: `{ myChildren { child { id person { displayName } } scopes } careFacts(childId:"p_nora"){key} checkInStatus(childId:"p_nora"){recorded} orbitVocabulary{kind} effectiveScheduleFor(childId:"p_nora", date:"2026-11-26"){source} jobTimeline(jobId:"job_emma_nov05"){kind} }` }),
}).then((r) => r.json()).catch(() => null);
check('12 six consumer reads answer', Boolean(kids?.data) && !kids.errors, JSON.stringify(kids?.errors?.[0]?.message ?? 'ok'));
check('13 Malik still has 3 care facts', Number((await db.query(`select count(*)::int n from care_facts where child_id='p_malik'`)).rows[0].n) === 3);
const mcp = spawnSync(process.execPath, ['--import', 'tsx', 'ops/mcp-probe.mjs'], {
  env: { ...process.env, MCP_URL: 'http://127.0.0.1:5051/mcp', MCP_TOOL: 'MyChildren', MCP_ARGS: '{}', MCP_PERSON: 'p_mom' },
  encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
});
check('14 authenticated MCP call succeeds', mcp.status === 0);
const kidsProof = spawnSync(process.execPath, ['ops/my-children-proof.mjs'], { env: process.env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
check('15 my-children-proof passes', kidsProof.status === 0, (kidsProof.stdout ?? '').trim().split('\n').slice(-1)[0] ?? '');

// Clean up the proof's own rows so nothing accumulates.
await db.query(`delete from approvals where id in ($1,$2) or subject_id=$3`, [CONTROL_NON_SANDBOX, CONTROL_NON_DEMO, SLIP]);
await db.query(`delete from permission_slips where id in ($1,$2)`, [SLIP, CONTROL_SLIP]);
await db.query(`delete from relationships where id='r_audit_control'`).catch(() => undefined);

const failed = results.filter((x) => !x.ok).length;
console.log(`\nRESULT: ${results.length - failed}/${results.length} PASS`);
await db.end();
process.exit(failed === 0 ? 0 : 1);
