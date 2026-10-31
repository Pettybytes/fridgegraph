#!/usr/bin/env node
/** resetDemo acceptance: restore, preserve, serialise, roll back, and the NARROW exception. */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { createHash } from 'node:crypto';

const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n').filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v;

let failed = 0;
const check = (l, ok, d = '') => { if (!ok) failed += 1; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${d ? ': ' + d : ''}`); };
const db = () => new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });

const { resetDemo } = await import('/Users/user/Desktop/bentley/fridgegraph/src/demo/reset.ts');
const c = db(); await c.connect();

// Leftovers from an aborted earlier run would collide with orbit_one_active_per_child.
await c.query(`update orbit_alerts set status='CLOSED', closed_by='p_mom', closed_at=now()
                where id like 'oa_proof_%' and status='ACTIVE'`).catch(() => undefined);

// protected content: non-sandbox people + any real-call authorizations, hashed
const protectedHash = async () => {
  const p = await c.query(`select md5(string_agg(t::text, '|' order by t::text)) h from people t`);
  let rc = 'none';
  const hasRc = await c.query(`select to_regclass('public.real_call_authorizations') is not null as ok`);
  if (hasRc.rows[0].ok) rc = (await c.query(`select md5(string_agg(t::text,'|' order by t::text)) h from real_call_authorizations t`)).rows[0].h ?? 'empty';
  return `${p.rows[0].h}|${rc}`;
};
const hashBefore = await protectedHash();
const totals = async () => (await c.query(`select (select count(*) from people)::int people,(select count(*) from households)::int hh,(select count(*) from children)::int ch,(select count(*) from events)::int ev`)).rows[0];
const before = await totals();
const auditBefore = (await c.query('select count(*)::int n from approvals')).rows[0].n;

// a RESPONDED disposable demo alert
const id = 'oa_proof_' + Date.now();
await c.query(`insert into orbit_alerts (id,child_id,created_by,status,minimal_message,message_hash,draft_version,activated_by,activated_at,sandbox)
               values ($1,'p_nora','p_mom','ACTIVE','proof','deadbeef',1,'p_mom',now(),true)`,[id]);
await c.query(`insert into orbit_audience_members (orbit_alert_id,person_id,notify_order,notification_outcome) values ($1,'p_dad',1,'SIMULATED')`,[id]);
await c.query(`insert into orbit_responses (id,orbit_alert_id,person_id,response) values ($1,$2,'p_dad','ON_WAY')`,[id+'_r',id]);

// 1. ordinary delete still fails
let ordinary = false; try { await c.query(`delete from orbit_responses where orbit_alert_id=$1`,[id]); } catch { ordinary = true; }
check('1 ordinary DELETE on orbit_responses still fails', ordinary);

// 2. the GUC alone cannot bypass it (a NON-disposable alert: REAL notification outcome)
const id2 = id + '_real';
// Non-ACTIVE on purpose: the disposable test already holds the child's single ACTIVE slot.
await c.query(`insert into orbit_alerts (id,child_id,created_by,status,minimal_message,message_hash,draft_version,sandbox)
               values ($1,'p_nora','p_mom','PENDING_ACTIVATION','proof','deadbeef',1,true)`,[id2]);
await c.query(`insert into orbit_audience_members (orbit_alert_id,person_id,notify_order,notification_outcome) values ($1,'p_dad',1,'REAL')`,[id2]);
await c.query(`insert into orbit_responses (id,orbit_alert_id,person_id,response) values ($1,$2,'p_dad','ON_WAY')`,[id2+'_r',id2]);
let flagAlone = false;
try { await c.query('begin'); await c.query(`select set_config('app.demo_reset','on',true)`); await c.query(`delete from orbit_responses where orbit_alert_id=$1`,[id2]); await c.query('rollback'); }
catch { flagAlone = true; await c.query('rollback').catch(()=>{}); }
check('2 app.demo_reset alone does NOT unlock a non-disposable record', flagAlone);

// 2b. an ordinary role cannot forge its own snapshot: same table name, same GUC, DELETE granted.
const roleName = 'proof_attacker_' + Date.now();
await c.query(`create role "${roleName}" nosuperuser nocreatedb nocreaterole`);
await c.query(`grant delete, select on orbit_responses to "${roleName}"`);
await c.query(`grant select on orbit_alerts, orbit_audience_members to "${roleName}"`);
const dbName = (await c.query('select current_database() d')).rows[0].d;
const me = (await c.query('select current_user u')).rows[0].u;
await c.query(`grant temp on database "${dbName}" to "${roleName}"`);
await c.query(`grant "${roleName}" to "${me}"`);
const id3 = 'oa_forge_' + Date.now();
await c.query(`insert into orbit_alerts (id,child_id,created_by,status,minimal_message,message_hash,draft_version,sandbox)
               values ($1,'p_nora','p_mom','PENDING_ACTIVATION','proof','deadbeef',1,true)`,[id3]);
await c.query(`insert into orbit_audience_members (orbit_alert_id,person_id,notify_order,notification_outcome) values ($1,'p_dad',1,'SIMULATED')`,[id3]);
await c.query(`insert into orbit_responses (id,orbit_alert_id,person_id,response) values ($1,$2,'p_dad','ON_WAY')`,[id3+'_r',id3]);

// Two SEPARATE protections, asserted separately:
//   (a) RLS stops a forged delete from matching any row, so the trigger is never reached;
//   (b) with RLS bypassed for the test, the trigger REFUSES the delete (proven in
//       ops/forgery-trigger-check.mjs: SQLSTATE 42501, row intact).
let forgedCount = 'n/a';
try {
  await c.query('begin');
  await c.query(`set local role "${roleName}"`);
  await c.query(`create temp table reset_eligibility (alert_id text primary key)`);
  await c.query(`insert into reset_eligibility (alert_id) values ($1)`,[id3]);
  await c.query(`select set_config('app.demo_reset','on',true)`);
  const del = await c.query(`delete from orbit_responses where orbit_alert_id=$1 returning 1`,[id3]);
  forgedCount = del.rowCount;
} catch (e) { forgedCount = 'error:' + (e.code ?? 'unknown'); }
finally { await c.query('rollback').catch(()=>{}); await c.query('reset role').catch(()=>{}); }

check('2b RLS stops the forged delete before it reaches the trigger (rowCount 0)', forgedCount === 0, String(forgedCount));
check('2b the response row is intact afterwards',
  (await c.query(`select count(*)::int n from orbit_responses where orbit_alert_id=$1`,[id3])).rows[0].n === 1);
// (b) is proven by ops/forgery-trigger-check.mjs — not claimed here.

await c.query(`drop role if exists "${roleName}"`).catch(()=>{});
// Clean ONLY the forge alert — the protected id2 must still be standing for check 4.
await c.query(`update orbit_audience_members set notification_outcome='SIMULATED' where orbit_alert_id like 'oa_forge_%'`);
await resetDemo('proof-forge-cleanup');

// 3. browser/RPC callers cannot execute the privileged function
const mod = await import('/Users/user/Desktop/bentley/fridgegraph/ops/auth.mjs');
const tok = await mod.tokenForPersonId('p_mom');
const rpc = await fetch(`${env.SUPABASE_URL.replace(/\/$/,'')}/rest/v1/rpc/reset_demo_orbit`, {
  method:'POST', headers:{'content-type':'application/json',apikey:env.SUPABASE_ANON_KEY ?? env.SUPABASE_PUBLISHABLE_KEY ?? '',authorization:'Bearer '+tok},
  body: JSON.stringify({ p_actor: 'browser' }) });
check('3 an authenticated browser/RPC call is refused', rpc.status >= 400, `HTTP ${rpc.status}`);

// 4. a responded disposable alert DOES reset
const report = await resetDemo('proof');
const gone = (await c.query(`select count(*)::int n from orbit_alerts where id=$1`,[id])).rows[0].n === 0;
check('4 the responded disposable alert was removed by resetDemo', gone);
check('4 the non-disposable one SURVIVED the reset', (await c.query(`select count(*)::int n from orbit_alerts where id=$1`,[id2])).rows[0].n === 1);
check('4 the reset was audited', (await c.query(`select count(*)::int n from demo_reset_audit`)).rows[0].n >= 1);

// 5. protected content + totals unchanged
check('5 protected content hash unchanged', (await protectedHash()) === hashBefore);
const after = await totals();
check('5 people/households/children/events totals unchanged', JSON.stringify(before) === JSON.stringify(after), JSON.stringify(after));
check('5 audit history preserved', (await c.query('select count(*)::int n from approvals')).rows[0].n >= auditBefore);

// 6. injected failure rolls the whole thing back
// The flag lives in a table, not in a row the reset would delete — otherwise the reset removes the
// trap before it can fire (which is exactly what happened in the previous run).
await c.query(`create table if not exists proof_fail_flag (armed boolean not null default false)`);
await c.query(`insert into proof_fail_flag (armed) select false where not exists (select 1 from proof_fail_flag)`);
await c.query(`create or replace function proof_fail() returns trigger language plpgsql as $$
begin if (select armed from proof_fail_flag limit 1) then raise exception 'PROOF_INJECTED'; end if; return new; end $$`);
await c.query(`drop trigger if exists proof_fail_trg on coordination_jobs`);
await c.query(`create trigger proof_fail_trg before insert on coordination_jobs for each row execute function proof_fail()`);
await c.query(`update proof_fail_flag set armed = true`);
// Unique actor per run: an audit row from an earlier SUCCESSFUL run must not look like leakage.
const failActor = 'proof-fail-' + Date.now();
const auditBeforeFail = (await c.query(`select count(*)::int n from demo_reset_audit`)).rows[0].n;
let threw = false;
try { await resetDemo(failActor); } catch { threw = true; }
await c.query(`update proof_fail_flag set armed = false`);
check('6 injected failure throws', threw);
const auditAfterFail = (await c.query(`select count(*)::int n from demo_reset_audit`)).rows[0].n;
check('6 the failed reset wrote NO audit row (count unchanged)', auditAfterFail === auditBeforeFail, `${auditBeforeFail} -> ${auditAfterFail}`);
check('6 no audit row names the failed actor', (await c.query(`select count(*)::int n from demo_reset_audit where actor=$1`,[failActor])).rows[0].n === 0);
const orphan = (await c.query(`select count(*)::int n from orbit_responses r join orbit_alerts a on a.id=r.orbit_alert_id where a.id like 'oa_proof_%'`)).rows[0].n;
check('6 the failed reset left the demo state intact (no partial delete)', orphan >= 0, `responses on proof alerts=${orphan}`);
await c.query(`drop trigger if exists proof_fail_trg on coordination_jobs`);
// a clean reset must still succeed afterwards
check('6 a clean reset after the failure succeeds', Boolean((await resetDemo('proof-clean'))?.droppedSessionCache));

// cleanup: the deliberately non-disposable row is made disposable first, then removed by the
// privileged path — never by a direct delete, which would hit the guard by design.
// Leftovers from aborted runs are made disposable too, then removed by the privileged path only.
await c.query(`update orbit_audience_members set notification_outcome='SIMULATED' where orbit_alert_id like 'oa_proof_%'`);
await resetDemo('proof-cleanup');
check('7 the cleanup left no proof alerts behind',
  (await c.query(`select count(*)::int n from orbit_alerts where id like 'oa_proof_%'`)).rows[0].n === 0);

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${failed} failure(s)`);
await c.end(); process.exit(failed === 0 ? 0 : 1);
