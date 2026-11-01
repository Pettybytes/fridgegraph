#!/usr/bin/env node
/**
 * ops/create-demo-family-reset-proof.mjs — STEP 2 integration: a created family resets cleanly and the
 * seeded demo state is exactly what it was before the family existed.
 *
 * This is the assertion that was pending while #57 was in flight: with the Cast v2 restore on main, a
 * reset must not only remove the created family, it must leave the demo seed byte-identical to the
 * baseline taken BEFORE the family was created.
 *
 *   1. restore the canonical demo seed, then take a full-table checksum  = BASELINE
 *   2. create a family (rows + registry + DB mapping + JSON mapping + auth user)
 *   3. reset
 *   4. checksum == BASELINE, and every trace of the family is gone (rows, registry, both mappings,
 *      cached session, picker resolution), while the Cast v2 content is still present.
 *
 * Owner DB access is used to read state; the family itself is created through the product function.
 * No output is written under docs/evidence.
 *
 * Run: node --import tsx ops/create-demo-family-reset-proof.mjs
 */
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
const { createDemoFamily, familyPersona } = await import('../src/demo/family.ts');
const { resetDemo } = await import('../src/demo/reset.ts');
const { checksumDatabase, restoreDemoCast } = await import('../scripts/db.ts');
const { personaSessionStats } = await import('../src/demo/persona-sessions.ts');

const db = new pg.Client({ connectionString: env.SUPABASE_DB_URL.replace(/["'\s\r]/g, ''), ssl: { rejectUnauthorized: false } });
await db.connect();

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const diffTables = (a, b) => Object.keys(a).filter((k) => a[k]?.sha !== b[k]?.sha || a[k]?.rows !== b[k]?.rows);

console.log('=== created family: reset returns the seed exactly to baseline ===');

await restoreDemoCast();
const baseline = await checksumDatabase();
const factsBefore = Number((await db.query(`select count(*)::int n from care_facts where child_id='p_malik'`)).rows[0].n);
const auditBefore = Number((await db.query(`select count(*)::int n from demo_reset_audit`)).rows[0].n);
check('1 baseline: canonical seed restored, Malik has 3 care facts', factsBefore === 3, `facts=${factsBefore}`);

const family = await createDemoFamily({ parentName: 'Integration Parent', childName: 'Integration Child' });
const row = (await db.query(`select * from demo_families where id=$1`, [family.id])).rows[0];
check('2 family created (rows + registry)', Boolean(row?.person_id), family.id);

const report = await resetDemo('proof-family-integration');
check('3 the reset reports one created family removed', report.createdFamiliesRemoved === 1, `removed=${report.createdFamiliesRemoved}`);

const after = await checksumDatabase();
const diffs = diffTables(baseline, after);
check('4 full-table checksum is byte-identical to the pre-family baseline', same(baseline, after), diffs.join(',') || 'identical');

check('5 registry is empty', Number((await db.query(`select count(*)::int n from demo_families`)).rows[0].n) === 0);
check('6 family rows are gone', (await db.query(`select count(*)::int n from people where id in ($1,$2)`, [row.person_id, row.child_id])).rows[0].n === 0
  && (await db.query(`select count(*)::int n from households where id=$1`, [row.household_id])).rows[0].n === 0
  && (await db.query(`select count(*)::int n from villages where id=$1`, [row.village_id])).rows[0].n === 0);
check('7 DB identity mapping removed', (await db.query(`select 1 from identity_map where user_id=$1`, [row.auth_user_id])).rowCount === 0);
const map = JSON.parse(readFileSync('data/identity-map.json', 'utf8'));
check('8 JSON identity mapping removed', map[row.auth_user_id] === undefined);
check('9 the persona no longer resolves', (await familyPersona(family.id)) === null);
check('10 the session cache was dropped', report.droppedSessionCache === true && personaSessionStats().mints === 0);
check('11 Malik still has 3 care facts after the family reset',
  Number((await db.query(`select count(*)::int n from care_facts where child_id='p_malik'`)).rows[0].n) === 3);
check('12 audit grew by exactly one reset',
  Number((await db.query(`select count(*)::int n from demo_reset_audit`)).rows[0].n) - auditBefore === 1);

const failed = results.filter((x) => !x.ok).length;
console.log(`\nRESULT: ${results.length - failed}/${results.length} PASS`);
await db.end();
process.exit(failed === 0 ? 0 : 1);
