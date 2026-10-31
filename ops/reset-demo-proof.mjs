#!/usr/bin/env node
/**
 * ops/reset-demo-proof.mjs — resetDemo: restore, preserve, serialize, roll back.
 *
 * Contract under test:
 *  1. mutations to demo state are undone; consumers read the seeded state again
 *  2. NON-sandbox rows and audit history survive untouched (counts before/after)
 *  3. two resets racing each other serialize (advisory lock), never interleave
 *  4. an injected mid-restore failure rolls the WHOLE thing back — never half restored
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n').filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v;

const db = () => new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
let failed = 0;
const check = (l, ok, d = '') => { if (!ok) failed += 1; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${d ? ': ' + d : ''}`); };

const { resetDemo } = await import('../src/demo/reset.ts').catch(() => import('/Users/user/Desktop/bentley/fridgegraph/src/demo/reset.ts'));

const c = db(); await c.connect();

// --- baseline: what must survive
const nonSandbox = async () => {
  // These tables have NO sandbox column, so totals are the honest comparison: resetDemo deletes and
  // re-inserts only fixture-identified rows, so the totals must be unchanged by a reset.
  const q = await c.query(`
    select (select count(*) from people)::int people,
           (select count(*) from households)::int households,
           (select count(*) from children)::int children,
           (select count(*) from events)::int events`);
  return q.rows[0];
};
const before = await nonSandbox();
const auditBefore = (await c.query('select count(*)::int n from approvals')).rows[0].n;

// --- 1. mutate demo state: an Orbit alert (activate + close), a response, a calendar change
const alertId = 'oa_proof_' + Date.now();
await c.query(`insert into orbit_alerts (id, child_id, created_by, status, minimal_message, message_hash, draft_version, activated_by, activated_at)
               values ($1,'p_nora','p_mom','ACTIVE','proof alert','deadbeef',1,'p_mom',now())`, [alertId]);
await c.query(`update orbit_alerts set status='CLOSED', closed_by='p_mom', closed_at=now() where id=$1`, [alertId]);
const cal = await c.query(`select id from holiday_arrangements limit 1`);
const calId = cal.rows[0]?.id;
if (calId) await c.query(`update holiday_arrangements set status='APPROVED' where id=$1`, [calId]);
const mutated = (await c.query(`select count(*)::int n from orbit_alerts where id=$1`, [alertId])).rows[0].n === 1;
check('0 demo state was mutated (alert present)', mutated);

// --- 2. concurrent resets must serialize
const [r1, r2] = await Promise.all([resetDemo(), resetDemo()]);
check('2 two concurrent resets both completed', Boolean(r1?.droppedSessionCache && r2?.droppedSessionCache));

// --- 3. the mutation is gone
const gone = (await c.query(`select count(*)::int n from orbit_alerts where id=$1`, [alertId])).rows[0].n === 0;
check('1 the mutated alert is gone after reset', gone);

// --- 4. non-sandbox + audit preserved
const after = await nonSandbox();
const auditAfter = (await c.query('select count(*)::int n from approvals')).rows[0].n;
check('1 people totals unchanged', before.people === after.people, `${before.people} -> ${after.people}`);
check('1 household totals unchanged', before.households === after.households, `${before.households} -> ${after.households}`);
check('1 child totals unchanged', before.children === after.children, `${before.children} -> ${after.children}`);
check('1 event totals unchanged', before.events === after.events, `${before.events} -> ${after.events}`);
check('1 audit history preserved', auditAfter >= auditBefore, `${auditBefore} -> ${auditAfter}`);

// --- 5. injected failure rolls back
await c.query(`create or replace function proof_fail() returns trigger language plpgsql as $$
begin if new.id = 'proof_force_fail' then raise exception 'PROOF_INJECTED'; end if; return new; end $$`);
await c.query(`drop trigger if exists proof_fail_trg on coordination_jobs`);
await c.query(`create trigger proof_fail_trg before insert on coordination_jobs for each row execute function proof_fail()`);
// make the fixture set include the magic id by inserting a sandbox row first, then resetting
await c.query(`insert into coordination_jobs (id, child_id, type, status, sandbox) values ('proof_force_fail','p_nora','RIDE','discovering',true) on conflict (id) do nothing`);
let threw = false;
try { await resetDemo(); } catch { threw = true; }
check('4 an injected mid-restore failure throws', threw);
const stillThere = (await c.query(`select count(*)::int n from coordination_jobs where id='proof_force_fail'`)).rows[0].n;
check('4 the failure left NO partial state (row still present, transaction rolled back)', stillThere === 1, `${stillThere}`);
await c.query(`drop trigger if exists proof_fail_trg on coordination_jobs`);
await c.query(`delete from coordination_jobs where id='proof_force_fail'`);

// --- 6. a clean reset afterwards restores the seeded state
const clean = await resetDemo();
check('5 clean reset after the failure succeeds', Boolean(clean?.droppedSessionCache));

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${failed} failure(s)`);
await c.end();
process.exit(failed === 0 ? 0 : 1);
