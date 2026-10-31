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
await c.query(`create or replace function proof_fail() returns trigger language plpgsql as $$
begin if new.id='proof_force_fail' then raise exception 'PROOF_INJECTED'; end if; return new; end $$`);
await c.query(`drop trigger if exists proof_fail_trg on coordination_jobs`);
await c.query(`create trigger proof_fail_trg before insert on coordination_jobs for each row execute function proof_fail()`);
let threw = false; try { await resetDemo('proof-fail'); } catch { threw = true; }
check('6 injected failure throws', threw);
check('6 the audit row from the FAILED reset did not survive (rollback)', (await c.query(`select count(*)::int n from demo_reset_audit where actor='proof-fail'`)).rows[0].n === 0);
await c.query(`drop trigger if exists proof_fail_trg on coordination_jobs`);

// cleanup: the deliberately non-disposable row
await c.query(`delete from orbit_responses where orbit_alert_id=$1`,[id2]).catch(()=>{});
await c.query(`delete from orbit_audience_members where orbit_alert_id=$1`,[id2]);
await c.query(`delete from orbit_alerts where id=$1`,[id2]);

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${failed} failure(s)`);
await c.end(); process.exit(failed === 0 ? 0 : 1);
