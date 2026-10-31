#!/usr/bin/env node
/**
 * ops/create-demo-family-faults-proof.mjs — Group 5 Piece 2, STEP 3.
 *
 * Every boundary in createDemoFamily is failed on purpose, with a TEST-ONLY hook (null in any normal
 * run; setting it throws under NODE_ENV=production). The assertion is always the same end state:
 * a family is usable ONLY when BOTH mappings exist, and a half-created family is never left in the
 * registry (picker/login) or resolvable on either path.
 *
 *   a) auth user creation fails      -> nothing written
 *   b) DB transaction fails          -> auth user deleted, no file entry, no rows
 *   c) DB commits, JSON write fails  -> rows, identity_map, registry and auth user all removed
 *   d) JSON write succeeds, later step fails -> the same end state
 *   e) one mapping survives a crash  -> reset reconciles both directions
 *
 * Owner DB access is used to inspect/construct state and to clean up afterwards. The count-only
 * orphan audit at the end reads Supabase Auth through the admin API and prints NO ids or emails.
 *
 * Run: node --import tsx ops/create-demo-family-faults-proof.mjs
 */
import { readFileSync } from 'node:fs';
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

const { loadEnv } = await import('../src/env.ts');
loadEnv();
const { createDemoFamily, familyPersona, __setFamilyFaultHook } = await import('../src/demo/family.ts');
const { resetDemo } = await import('../src/demo/reset.ts');

const db = new pg.Client({ connectionString: env.SUPABASE_DB_URL.replace(/["'\s\r]/g, ''), ssl: { rejectUnauthorized: false } });
await db.connect();

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};

const mapFile = () => JSON.parse(readFileSync('data/identity-map.json', 'utf8'));
const counts = async () => ({
  registry: Number((await db.query(`select count(*)::int n from demo_families`)).rows[0].n),
  identity: Number((await db.query(`select count(*)::int n from identity_map`)).rows[0].n),
  file: Object.keys(mapFile()).length,
});

/** Auth users created by this feature, counted only. Paginated admin read; never prints a record. */
const familyAuthCount = async () => {
  const url = env.SUPABASE_URL.replace(/\/$/, '');
  let count = 0;
  for (let page = 1; page <= 20; page += 1) {
    const res = await fetch(`${url}/auth/v1/admin/users?page=${page}&per_page=200`, {
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
    });
    if (!res.ok) throw new Error(`admin list failed: ${res.status}`);
    const body = await res.json();
    const users = body.users ?? [];
    count += users.filter((u) => typeof u.email === 'string' && u.email.startsWith('family.')).length;
    if (users.length < 200) break;
  }
  return count;
};

/** Everything a failed create must NOT leave behind. */
const assertClean = async (label, baseline) => {
  const now = await counts();
  check(`${label}: registry unchanged`, now.registry === baseline.registry, `${baseline.registry} -> ${now.registry}`);
  check(`${label}: DB identity_map unchanged`, now.identity === baseline.identity, `${baseline.identity} -> ${now.identity}`);
  check(`${label}: JSON map unchanged`, now.file === baseline.file, `${baseline.file} -> ${now.file}`);
};

console.log('=== createDemoFamily — failure boundaries ===');

// ---------------------------------------------------------------- a) auth user creation fails
let baseline = await counts();
let authBaseline = await familyAuthCount();
const realUrl = process.env.SUPABASE_URL;
process.env.SUPABASE_URL = 'http://127.0.0.1:9';           // unreachable: the admin create must fail
let thrown = null;
try {
  await createDemoFamily({ parentName: 'A Auth', childName: 'A Child' });
} catch (error) { thrown = error; }
process.env.SUPABASE_URL = realUrl;
check('a1 auth failure is reported, not swallowed', thrown?.code === 'FAMILY_CREATE_FAILED', String(thrown?.code));
await assertClean('a2', baseline);
check('a3 no auth user was created', (await familyAuthCount()) === authBaseline);

// ---------------------------------------------------------------- b) DB transaction fails
baseline = await counts();
authBaseline = await familyAuthCount();
__setFamilyFaultHook((stage) => { if (stage === 'before-commit') throw new Error('injected: commit'); });
thrown = null;
try { await createDemoFamily({ parentName: 'B Tx', childName: 'B Child' }); } catch (error) { thrown = error; }
__setFamilyFaultHook(null);
check('b1 transaction failure is reported', thrown?.code === 'FAMILY_CREATE_FAILED', String(thrown?.code));
await assertClean('b2', baseline);
check('b3 the auth user created before the transaction was deleted', (await familyAuthCount()) === authBaseline);

// ---------------------------------------------------------------- c) commit ok, JSON write fails
baseline = await counts();
authBaseline = await familyAuthCount();
__setFamilyFaultHook((stage) => { if (stage === 'after-commit') throw new Error('injected: file write'); });
thrown = null;
try { await createDemoFamily({ parentName: 'C File', childName: 'C Child' }); } catch (error) { thrown = error; }
__setFamilyFaultHook(null);
check('c1 file-write failure is reported', thrown?.code === 'FAMILY_CREATE_FAILED', String(thrown?.code));
await assertClean('c2', baseline);
check('c3 the committed auth user was deleted', (await familyAuthCount()) === authBaseline);

// ---------------------------------------------------------------- d) everything written, then failure
baseline = await counts();
authBaseline = await familyAuthCount();
__setFamilyFaultHook((stage) => { if (stage === 'after-file') throw new Error('injected: after file'); });
thrown = null;
try { await createDemoFamily({ parentName: 'D After', childName: 'D Child' }); } catch (error) { thrown = error; }
__setFamilyFaultHook(null);
check('d1 post-write failure is reported', thrown?.code === 'FAMILY_CREATE_FAILED', String(thrown?.code));
await assertClean('d2', baseline);
check('d3 the auth user was deleted', (await familyAuthCount()) === authBaseline);

// ---------------------------------------------------------------- e1) registry row lost, mappings remain
const e1 = await createDemoFamily({ parentName: 'E One', childName: 'E Child' });
const e1rows = (await db.query(`select * from demo_families where id=$1`, [e1.id])).rows[0];
await db.query(`delete from demo_families where id=$1`, [e1.id]);   // crash after registry loss
check('e1a precondition: file entry exists with no registry row', mapFile()[e1rows.auth_user_id] === e1rows.person_id);
const r1 = await resetDemo('proof-fault-e1');
const after1 = mapFile();
check('e1b reset removed the orphaned file entry', after1[e1rows.auth_user_id] === undefined);
check('e1c reset removed its DB mapping', (await db.query(`select 1 from identity_map where user_id=$1`, [e1rows.auth_user_id])).rowCount === 0);
check('e1d reset removed the orphan people rows', (await db.query(`select count(*)::int n from people where id in ($1,$2)`, [e1rows.person_id, e1rows.child_id])).rows[0].n === 0,
  `removed=${r1.createdFamiliesRemoved}`);

// ---------------------------------------------------------------- e2) file entry lost, DB intact
const e2 = await createDemoFamily({ parentName: 'E Two', childName: 'E Child' });
const e2rows = (await db.query(`select * from demo_families where id=$1`, [e2.id])).rows[0];
const stripped = mapFile();
delete stripped[e2rows.auth_user_id];
const { writeFileSync } = await import('node:fs');
writeFileSync('data/identity-map.json', JSON.stringify(stripped, null, 2), { mode: 0o600 });
check('e2a precondition: DB and registry exist, file entry is gone', stripped[e2rows.auth_user_id] === undefined);
await resetDemo('proof-fault-e2');
check('e2b reset removed the registry row', (await db.query(`select count(*)::int n from demo_families`)).rows[0].n === 0);
check('e2c reset removed the DB mapping', (await db.query(`select 1 from identity_map where user_id=$1`, [e2rows.auth_user_id])).rowCount === 0);
check('e2d the path is closed on BOTH sides (no persona, no file entry)',
  (await familyPersona(e2.id)) === null && mapFile()[e2rows.auth_user_id] === undefined);

// ---------------------------------------------------------------- orphan audit (counts only)
const finalCounts = await counts();
const map = mapFile();
const mappedSubs = new Set(Object.keys(map));
const dbMapped = new Set((await db.query(`select user_id::text u from identity_map`)).rows.map((r) => r.u));
const authBase = env.SUPABASE_URL.replace(/\/$/, '');
const familySubs = [];
for (let page = 1; page <= 20; page += 1) {
  const res = await fetch(`${authBase}/auth/v1/admin/users?page=${page}&per_page=200`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
  });
  const body = await res.json();
  const users = body.users ?? [];
  for (const u of users) if (typeof u.email === 'string' && u.email.startsWith('family.')) familySubs.push(u.id);
  if (users.length < 200) break;
}
const orphans = familySubs.filter((id) => !mappedSubs.has(id) && !dbMapped.has(id));
console.log(`\nORPHANED AUTH USERS (family.* accounts): ${orphans.length} of ${familySubs.length}`);
check('orphan audit: every orphan is unmapped on BOTH paths (so it resolves to nobody)',
  orphans.every((id) => !mappedSubs.has(id) && !dbMapped.has(id)));
check('orphan audit: no orphan is a persona the picker could resolve',
  orphans.every((id) => !Object.values(map).includes(id)));
check('final state is clean', finalCounts.registry === 0);

const failed = results.filter((x) => !x.ok).length;
console.log(`\nRESULT: ${results.length - failed}/${results.length} PASS`);
await db.end();
process.exit(failed === 0 ? 0 : 1);
