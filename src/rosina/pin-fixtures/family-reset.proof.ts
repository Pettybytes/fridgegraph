/** Isolated Postgres16 proof only. NEVER consumes runtime database configuration.
 * Start an EMPTY disposable server bound to 127.0.0.1:56442, trust auth, then run:
 * node --import tsx src/rosina/pin-fixtures/family-reset.proof.ts
 * Each run creates its own reset_proof_* database. No shared Supabase connection is read.
 */
import pg from 'pg';
import {createFridgeSeed} from '../../fixtures-fridge';
import {readFileSync,readdirSync} from 'node:fs';
import {baseline} from '../../../scripts/db';
import {createCastV2} from '../../fixtures-cast-v2';
import {activateCreatedFamily} from '../../demo/family';
import {resetSnapshot} from '../../demo/reset';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
async function main(){
 const admin=new pg.Client({host:'127.0.0.1',port:56442,user:'postgres',database:'postgres'});await admin.connect();
 const name='reset_proof_'+Date.now();await admin.query(`create database ${name}`);await admin.end();
 const c=new pg.Client({host:'127.0.0.1',port:56442,user:'postgres',database:name});await c.connect();
 await c.query(`do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if; if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if; end$$;create schema auth;create schema extensions;create extension pgcrypto with schema extensions;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;`);
 const keys:Record<string,string[]>={children:['person_id'],shared_statuses:['person_id'],care_plans:['child_id'],household_policies:['household_id','rule'],parenting_schedules:['child_id','parent_id'],bus_rosters:['date','child_id'],household_members:['person_id','household_id'],memberships:['person_id','group_id'],capabilities:['person_id','name'],contact_methods:['person_id','channel','value'],orbit_vocabulary:['kind','value'],care_facts:['child_id','key']};
 async function seed(t:string,rows:any[]){if(!rows.length)return;const available=new Set((await c.query('select attname from pg_attribute where attrelid=$1::regclass and not attisdropped',[t])).rows.map(r=>r.attname));const cols=[...new Set(rows.flatMap(r=>Object.keys(r)))].filter(k=>available.has(k)),pk=keys[t]??['id'];const q=(s:string)=>'"'+s.replaceAll('"','""')+'"';const updates=cols.filter(k=>!pk.includes(k)).map(k=>`${q(k)}=excluded.${q(k)}`).join(',');await c.query(`insert into ${q(t)} (${cols.map(q)}) select ${cols.map(q)} from jsonb_populate_recordset(null::${q(t)},$1) on conflict (${pk.map(q)}) ${updates?'do update set '+updates:'do nothing'}`,[JSON.stringify(rows)]);}
 const files=readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort();
 for(const f of files){
  if(f.startsWith('0040')){for(const [t,rows]of Object.entries(baseline()))if(t!=='shared_statuses')await seed(t,rows);for(const [t,rows]of Object.entries(createCastV2()))if(Array.isArray(rows))await seed(t,rows);}
  try{await c.query(readFileSync('supabase/migrations/'+f,'utf8'));}catch(e:any){throw Error(`${f}: ${e.code} ${e.message}`)}
 }
 // Seed Cast in its canonical table order; rows outside restore's subset are baseline content too.
 const cast=createCastV2() as any;
 for(const [t,rows]of Object.entries(cast))if(Array.isArray(rows))await seed(t,rows);
 const snap=resetSnapshot();
 const invoke=async(id:string)=>c.query('select restore_demo_snapshot($1,$2::uuid,$3::jsonb,$4::jsonb) report',['p_mom',id,JSON.stringify(snap.fixtures),JSON.stringify(snap.cast)]);
 await c.query("insert into people(id,display_name,birth_date)values('p_fast_reset_guard','Protected fictional sentinel','2000-01-01');insert into goals(id,child_id,title,status,sandbox)values('goal_fast_reset_guard','p_nora','Protected goal','APPROVED',false)");
 await c.query("insert into demo_families(id,persona_id,person_id,child_id,household_id,village_id,email,parent_name,child_name,status)values('family-race','family-race','p_family_race','p_family_child_race','h_family_race','v_family_race','family.aaaa@example.com','Fictional parent','Fictional child','pending')");
 const start=performance.now();const id=randomUUID();const first=await invoke(id);console.log({localSqlMs:performance.now()-start,restored:first.rows[0].report.restored});
 const count=(await c.query('select count(*)::int n from coordination_jobs where sandbox')).rows[0].n;assert.equal(count,236);
 assert.equal((await c.query("select count(*)::int n from people where id='p_fast_reset_guard'")).rows[0].n,1);
 assert.equal((await c.query("select count(*)::int n from goals where id='goal_fast_reset_guard' and sandbox=false")).rows[0].n,1);
 await c.query('begin');await c.query("insert into people(id,display_name,birth_date)values('p_family_race','Fictional racing parent','1985-01-01')");await assert.rejects(activateCreatedFamily(c,'family-race',randomUUID()),/FAMILY_RESET_IN_PROGRESS/);await c.query('rollback');assert.equal((await c.query("select count(*)::int n from people where id='p_family_race'")).rows[0].n,0);
 const runCount=async()=>Number((await c.query('select count(*) n from demo_reset_runs')).rows[0].n);
 const before=await runCount();await invoke(id);assert.equal(await runCount(),before);
 // Trigger fault after clearing starts: the entire state and receipt must roll back.
 await c.query(`create function reset_proof_fail() returns trigger language plpgsql as $$begin raise exception 'RESET_PROOF_INJECTED';end$$;create trigger reset_proof_fail before insert on coordination_jobs for each statement execute function reset_proof_fail()`);
 const hash=async()=>String((await c.query("select md5(string_agg(to_jsonb(j)::text,'|' order by id)) h from coordination_jobs j")).rows[0].h);
 const beforeHash=await hash();
 const auditBefore=Number((await c.query('select count(*) n from demo_reset_audit')).rows[0].n);
 const failId=randomUUID();await assert.rejects(invoke(failId),/RESET_PROOF_INJECTED/);
 assert.equal((await c.query('select count(*)::int n from coordination_jobs where sandbox')).rows[0].n,count);
 assert.equal(await runCount(),before);assert.equal(await hash(),beforeHash);
 assert.equal(Number((await c.query('select count(*) n from demo_reset_audit')).rows[0].n),auditBefore);
 await c.query('drop trigger reset_proof_fail on coordination_jobs');
 // Inject after every restore/helper/audit operation; receipt insertion must roll it ALL back.
 await c.query('create trigger reset_proof_late_fail before insert on demo_reset_runs for each statement execute function reset_proof_fail()');
 await assert.rejects(invoke(randomUUID()),/RESET_PROOF_INJECTED/);assert.equal(await hash(),beforeHash);assert.equal(await runCount(),before);assert.equal(Number((await c.query('select count(*) n from demo_reset_audit')).rows[0].n),auditBefore);
 await c.query('drop trigger reset_proof_late_fail on demo_reset_runs');
 // Browser and service-role cannot call the owner-only restore.
 for(const role of ['anon','authenticated','service_role']){await c.query('set role '+role);await assert.rejects(invoke(randomUUID()),/permission denied/);await c.query('reset role');}
 const warm=performance.now();await invoke(randomUUID());console.log({warmSqlMs:performance.now()-warm});
 const fridge=createFridgeSeed();
 const verifyFridge=async()=>{
  for(const [table,rows] of Object.entries(fridge)){
   const actual=(await c.query(`select * from ${table} where ${table==='fridge_item_preferences'?'item_id':'id'} like 'fridge_demo_%'`)).rows;
   assert.equal(actual.length,rows.length);
  }
  const goal=(await c.query("select title,horizon,status from goals where id='fridge_demo_goal_p_nora_0'")).rows[0];
  assert.deepEqual(goal,{title:"Bryan hopes to win Meta's AI Dev Indie track",horizon:'November 2026',status:'APPROVED'});
  assert.equal((await c.query("select color from fridge_item_preferences where item_id='fridge_demo_goal_p_nora_0'")).rows[0].color,'blue');
 };
 await verifyFridge();
 await c.query("update goals set title='Temporary edit' where id='fridge_demo_goal_p_nora_0'; delete from fridge_notes where id='fridge_demo_note_p_nora_0'; update fridge_item_preferences set color='red' where item_id='fridge_demo_goal_p_nora_0'");
 await invoke(randomUUID());await verifyFridge();
 console.log('PASS: atomic reset restores all Fridge notes, goals and styles; rollback, idempotency and protected sentinels retained');await c.end();
}
main().catch(e=>{console.error(e.message);process.exit(1)});
