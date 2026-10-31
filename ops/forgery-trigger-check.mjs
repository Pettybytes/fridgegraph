#!/usr/bin/env node
/** Exercise the TRIGGER ownership check where the row actually reaches it (BYPASSRLS test role).
 *  No production grant or policy is changed: the role is created and dropped inside the proof. */
import { readFileSync } from 'node:fs';
import pg from 'pg';
const env = Object.fromEntries(readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')&&!l.trimStart().startsWith('#'))
  .map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}));
for (const [k,v] of Object.entries(env)) if (process.env[k]===undefined) process.env[k]=v;
let failed = 0;
const check = (l, ok, d='') => { if (!ok) failed++; console.log(`  ${ok?'PASS':'FAIL'}  ${l}${d?': '+d:''}`); };

const c = new pg.Client({connectionString: env.SUPABASE_DB_URL, ssl:{rejectUnauthorized:false}});
await c.connect();
await c.query('begin');
try {
  const id = 'oa_trg_' + Date.now();
  await c.query(`insert into orbit_alerts (id,child_id,created_by,status,minimal_message,message_hash,draft_version,sandbox)
                 values ($1,'p_nora','p_mom','PENDING_ACTIVATION','diag','deadbeef',1,true)`,[id]);
  await c.query(`insert into orbit_audience_members (orbit_alert_id,person_id,notify_order,notification_outcome)
                 values ($1,'p_dad',1,'SIMULATED')`,[id]);
  await c.query(`insert into orbit_responses (id,orbit_alert_id,person_id,response) values ($1,$2,'p_dad','ON_WAY')`,[id+'_r',id]);

  const role = 'trg_attacker_' + Date.now();
  await c.query(`create role "${role}" nosuperuser nocreatedb nocreaterole bypassrls`);
  const db = (await c.query('select current_database() d')).rows[0].d;
  const me = (await c.query('select session_user u')).rows[0].u;
  await c.query(`grant delete, select on orbit_responses to "${role}"`);
  await c.query(`grant select on orbit_alerts, orbit_audience_members to "${role}"`);
  await c.query(`grant temp on database "${db}" to "${role}"`);
  await c.query(`grant "${role}" to "${me}"`);

  await c.query(`set local role "${role}"`);
  await c.query(`create temp table reset_eligibility (alert_id text primary key)`);
  await c.query(`insert into reset_eligibility (alert_id) values ($1)`,[id]);
  await c.query(`select set_config('app.demo_reset','on',true)`);
  check('the row IS visible to this role (RLS bypassed for the test)', (await c.query(`select count(*)::int n from orbit_responses where orbit_alert_id=$1`,[id])).rows[0].n === 1);

  await c.query('savepoint s1');
  let code = 'none'; let msg = '';
  try { await c.query(`delete from orbit_responses where orbit_alert_id=$1 returning 1`,[id]); }
  catch (e) { code = e.code ?? 'unknown'; msg = e.message; await c.query('rollback to savepoint s1'); }
  check('the forged DELETE is REFUSED by the trigger', code === '42501', `SQLSTATE ${code}`);
  check('the refusal is the append-only guard, not a privilege error', /ORBIT_RESPONSES_APPEND_ONLY/.test(msg), msg);
  await c.query('reset role').catch(()=>{});
  check('the response row is intact after the refusal', (await c.query(`select count(*)::int n from orbit_responses where orbit_alert_id=$1`,[id])).rows[0].n === 1);
} finally {
  await c.query('rollback').catch(()=>{});
  await c.end();
}
console.log(`\n${failed===0?'PASS':'FAIL'} — ${failed} failure(s)`);
process.exit(failed===0?0:1);
