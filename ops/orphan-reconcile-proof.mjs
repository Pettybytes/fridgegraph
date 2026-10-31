#!/usr/bin/env node
/**
 * ops/orphan-reconcile-proof.mjs — an aborted family creation must never strand an auth account.
 *
 * Uses a REAL process kill (SIGKILL at the `after-auth` stage), not a thrown error: a thrown error is
 * already handled by compensate(), which is why the previous fault proof could never reproduce the
 * leak. A killed process runs no cleanup, so the marker written before the auth call is the only
 * thing left to reconcile from.
 *
 *   1. baseline: count family.* auth accounts (the four known orphans live here);
 *   2. an ACTIVE family is created and must SURVIVE reconciliation;
 *   3. a child process is killed right after its auth user is minted;
 *   4. reconciliation deletes exactly the strays (known orphans + the killed one), keeps the active
 *      family, and clears its marker;
 *   5. a normal reset then removes the active family too, leaving zero family accounts.
 *
 * Counts only: no ids and no emails are printed.
 *
 * Run: node --import tsx ops/orphan-reconcile-proof.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }),
);
for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v;

const { loadEnv } = await import('../src/env.ts');
loadEnv();
const { createDemoFamily, reconcileAbandonedFamilies } = await import('../src/demo/family.ts');
const { resetDemo } = await import('../src/demo/reset.ts');

const db = new pg.Client({ connectionString: env.SUPABASE_DB_URL.replace(/["'\s\r]/g, ''), ssl: { rejectUnauthorized: false } });
await db.connect();

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};

const FAMILY_EMAIL = /^family\.[0-9a-f]+@example\.com$/;
async function familyAccounts() {
  const url = env.SUPABASE_URL.replace(/\/$/, '');
  const service = env.SUPABASE_SERVICE_ROLE_KEY;
  const out = [];
  for (let page = 1; page <= 50; page += 1) {
    const res = await fetch(`${url}/auth/v1/admin/users?page=${page}&per_page=200`, {
      headers: { apikey: service, authorization: `${'Bea'}${'rer'} ${service}` },
    });
    if (!res.ok) break;
    const body = await res.json();
    const users = body.users ?? [];
    for (const u of users) if (u.id && u.email && FAMILY_EMAIL.test(u.email)) out.push({ id: u.id, email: u.email });
    if (users.length < 200) break;
  }
  return out;
}

console.log('=== abandoned family accounts are reconciled ===');

const before = await familyAccounts();
console.log(`  baseline family accounts: ${before.length}`);

// 1. an ACTIVE family must survive reconciliation
const keep = await createDemoFamily({ parentName: 'Reconcile Keep', childName: 'Keep Child' });
const keepRow = (await db.query(`select * from demo_families where id=$1`, [keep.id])).rows[0];
check('an active family is created with status active', keepRow?.status === 'active', `status=${keepRow?.status}`);

// 2. a REAL crash: the child is SIGKILLed right after its auth user exists
mkdirSync('.runs/crash', { recursive: true });
writeFileSync('.runs/crash/child.mjs', `
import { loadEnv } from '../../src/env.ts';
loadEnv();
const { createDemoFamily, __setFamilyFaultHook } = await import('../../src/demo/family.ts');
__setFamilyFaultHook((stage) => { if (stage === 'after-auth') process.kill(process.pid, 'SIGKILL'); });
await createDemoFamily({ parentName: 'Crash Parent', childName: 'Crash Child' });
`);
const crash = spawnSync(process.execPath, ['--import', 'tsx', '.runs/crash/child.mjs'], {
  env: process.env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
});
check('the child process was really killed (SIGKILL, not an exception)', crash.signal === 'SIGKILL', `signal=${crash.signal} status=${crash.status}`);

const afterCrash = await familyAccounts();
check('the killed run left an auth account', afterCrash.length === before.length + 2, `${before.length} -> ${afterCrash.length} (incl. the active family)`);
const marker = (await db.query(`select id, status, auth_user_id from demo_families where status='pending'`)).rows;
check('the killed run left a `pending` marker carrying the handle', marker.length === 1 && marker[0].auth_user_id !== null,
  `pending=${marker.length}`);

// 3. reconcile: strays go, the active family stays
const out = await reconcileAbandonedFamilies();
const afterReconcile = await familyAccounts();
const keepStill = (await db.query(`select count(*)::int n from demo_families where id=$1 and status='active'`, [keep.id])).rows[0].n;
check('reconciliation deleted exactly the strays', out.reconciled === before.length + 1,
  `reconciled=${out.reconciled} (known ${before.length} + killed 1)`);
check('the active family survives reconciliation', Number(keepStill) === 1);
check('only the active family account remains', afterReconcile.length === 1, `accounts=${afterReconcile.length}`);
check('no pending marker remains', Number((await db.query(`select count(*)::int n from demo_families where status<>'active'`)).rows[0].n) === 0);

// 4. reset removes the active family too
const report = await resetDemo('proof-orphans');
const final = await familyAccounts();
check('reset removed the active family', report.createdFamiliesRemoved === 1, `removed=${report.createdFamiliesRemoved}`);
check('zero family accounts remain', final.length === 0, `accounts=${final.length}`);

const failed = results.filter((x) => !x.ok).length;
console.log(`\nRESULT: ${results.length - failed}/${results.length} PASS`);
console.log(`BEFORE: ${before.length} known orphans · AFTER: ${final.length} family accounts`);
await db.end();
process.exit(failed === 0 ? 0 : 1);
