#!/usr/bin/env node
/** Why does the forged-snapshot DELETE not raise? Isolated, fully rolled back. */
import { readFileSync } from 'node:fs';
import pg from 'pg';
const env = Object.fromEntries(readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')&&!l.trimStart().startsWith('#'))
  .map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}));
for (const [k,v] of Object.entries(env)) if (process.env[k]===undefined) process.env[k]=v;

const c = new pg.Client({connectionString: env.SUPABASE_DB_URL, ssl:{rejectUnauthorized:false}});
await c.connect();
const out = (k,v) => console.log(`${k}=${v}`);

await c.query('begin');
try {
  const id = 'oa_diag_' + Date.now();
  await c.query(`insert into orbit_alerts (id,child_id,created_by,status,minimal_message,message_hash,draft_version,sandbox)
                 values ($1,'p_nora','p_mom','PENDING_ACTIVATION','diag','deadbeef',1,true)`,[id]);
  await c.query(`insert into orbit_audience_members (orbit_alert_id,person_id,notify_order,notification_outcome)
                 values ($1,'p_dad',1,'SIMULATED')`,[id]);
  await c.query(`insert into orbit_responses (id,orbit_alert_id,person_id,response) values ($1,$2,'p_dad','ON_WAY')`,[id+'_r',id]);

  // 1. privileged verifier BEFORE
  const pre = (await c.query(`select count(*)::int n from orbit_responses where orbit_alert_id=$1`,[id])).rows[0].n;
  out('pre_responses', pre);
  out('rls_enabled', (await c.query(`select relrowsecurity from pg_class where relname='orbit_responses'`)).rows[0].relrowsecurity);
  out('trigger_present', (await c.query(`select count(*)::int n from pg_trigger where tgrelid='orbit_responses'::regclass and not tgisinternal`)).rows[0].n);
  out('definer_owner', (await c.query(`select p.proowner::regrole::text o from pg_proc p where p.proname='reset_demo_orbit'`)).rows[0].o);

  // 2. forge under a real attacker role
  const role = 'diag_attacker_' + Date.now();
  await c.query(`create role "${role}" nosuperuser nocreatedb nocreaterole`);
  const db = (await c.query('select current_database() d')).rows[0].d;
  const me = (await c.query('select session_user u')).rows[0].u;
  await c.query(`grant delete, select on orbit_responses to "${role}"`);
  await c.query(`grant select on orbit_alerts, orbit_audience_members to "${role}"`);
  await c.query(`grant temp on database "${db}" to "${role}"`);
  await c.query(`grant "${role}" to "${me}"`);
  await c.query(`set local role "${role}"`);
  out('current_user', (await c.query('select current_user u')).rows[0].u);
  out('session_user', (await c.query('select session_user u')).rows[0].u);
  await c.query(`create temp table reset_eligibility (alert_id text primary key)`);
  await c.query(`insert into reset_eligibility (alert_id) values ($1)`,[id]);
  const t = (await c.query(`select c.relowner::regrole::text o, n.nspname s from pg_class c
                              join pg_namespace n on n.oid=c.relnamespace where c.relname='reset_eligibility' limit 1`)).rows[0];
  out('snapshot_owner', t.o); out('snapshot_schema', t.s);
  await c.query(`select set_config('app.demo_reset','on',true)`);
  out('eligible_verdict', (await c.query(`select _reset_eligible($1) v`,[id])).rows[0].v);

  // 3. the attempt
  await c.query('savepoint s1');
  try {
    const del = await c.query(`delete from orbit_responses where orbit_alert_id=$1 returning 1`,[id]);
    out('delete_rowcount', del.rowCount); out('delete_sqlstate', 'none');
  } catch (e) {
    out('delete_rowcount', 'error'); out('delete_sqlstate', e.code ?? 'unknown'); out('delete_message', e.message);
    await c.query('rollback to savepoint s1');
  }
  // 4. verifier AFTER (still inside the transaction, before rollback)
  await c.query('reset role').catch(()=>{});
  const post = (await c.query(`select count(*)::int n from orbit_responses where orbit_alert_id=$1`,[id])).rows[0].n;
  out('post_responses', post);
  out('interpretation', post < pre ? 'BYPASS (row gone)' : (post === pre ? 'row intact' : 'unknown'));
} finally {
  await c.query('rollback').catch(()=>{});
  await c.end();
}
