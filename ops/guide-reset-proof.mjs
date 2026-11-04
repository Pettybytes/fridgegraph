import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {guideDatabase,insertRows} from './guide-database.mjs';
import {createSimulatedPrivate} from '../src/fixtures-simulated.ts';
import {showcaseSnapshot} from '../src/demo/reset.ts';
const db=await guideDatabase();
try{
 const snapshot=showcaseSnapshot();
 for(const [table,rows] of Object.entries(createSimulatedPrivate()))if(Array.isArray(rows))await insertRows(db.admin,table,rows);
 // Seed the same canonical rows, preserving existing Cast records.
 for(const table of ['care_plans','goals','events','coordination_jobs','attempts','candidate_evaluations','confirmations','voice_notes','fridge_notes','fridge_item_preferences'])await insertRows(db.admin,table,snapshot[table]??[]);
 await db.admin.query("insert into fridge_notes(id,child_id,author_id,text,sandbox) values('protected_nora','p_nora','p_mom','Unmarked content',false)");
 const unrelated=async()=>{
  const all={};
  for(const table of ['care_plans','goals','events','coordination_jobs','school_reports','permission_slips','fridge_notes','grants']){
   all[table]=(await db.admin.query(`select to_jsonb(r) as row from ${table} r where child_id not in ('p_nora','p_max','p_leo') or coalesce(to_jsonb(r)->>'sandbox','true')='false' order by to_jsonb(r)::text`)).rows;
  }
  return JSON.stringify(all);
 };
 const before=await unrelated();
 const canonicalGrants=async()=>(await db.admin.query("select to_jsonb(g) as row from grants g where child_id in ('p_nora','p_max','p_leo') order by id")).rows;
 const grantsBefore=await canonicalGrants();
 await db.admin.query("update care_plans set text='Judge edit' where child_id='p_nora'");
 await db.admin.query("insert into orbit_alerts(id,child_id,created_by,sandbox) values('reset_orbit','p_nora','p_demo_guide',true),('other_orbit','p_jax','p_dana',true)");
 await db.admin.query("insert into orbit_audience_members(orbit_alert_id,person_id,notify_order,notification_outcome) values('reset_orbit','p_gma',1,'SIMULATED'),('other_orbit','p_dana',1,'SIMULATED')");
 await db.admin.query("insert into orbit_responses(id,orbit_alert_id,person_id,response) values('reset_reply','reset_orbit','p_gma','WITH_ME'),('other_reply','other_orbit','p_dana','WITH_ME')");
 const run=randomUUID();
 const reset=()=>db.admin.query('select restore_showcase_snapshot($1,$2,$3::jsonb) as report',['p_demo_guide',run,JSON.stringify(snapshot)]);
 const first=(await reset()).rows[0].report;
 assert.equal((await db.admin.query("select count(*)::int as n from orbit_responses where id='reset_reply'")).rows[0].n,0);
 assert.equal((await db.admin.query("select count(*)::int as n from orbit_responses where id='other_reply'")).rows[0].n,1);
 assert.equal(await unrelated(),before,'other families and unmarked rows are byte-for-byte unchanged');
 assert.equal((await db.admin.query("select text from care_plans where child_id='p_nora'")).rows[0].text,snapshot.care_plans.find(r=>r.child_id==='p_nora').text);
 assert.equal((await db.admin.query("select count(*)::int as n from events where id='e_school_1026' and child_id='p_nora'")).rows[0].n,1,'sample notice school day survives Reset');
 assert.deepEqual(await canonicalGrants(),grantsBefore,'canonical Ellison grants survive Reset byte-for-byte');
 const expectedGrants=snapshot.grants.filter(row=>['p_nora','p_max','p_leo'].includes(row.child_id));
 for(const grant of expectedGrants){
  const actual=(await db.admin.query('select actor_id,child_id,scopes,granted_by from grants where id=$1',[grant.id])).rows[0];
  assert.deepEqual(actual,{actor_id:grant.actor_id,child_id:grant.child_id,scopes:grant.scopes,granted_by:grant.granted_by},`canonical grant survives Reset: ${grant.id}`);
 }
 assert.deepEqual((await reset()).rows[0].report,first,'same run is idempotent');
 await assert.rejects(db.admin.query('select restore_showcase_snapshot($1,$2,$3::jsonb)',['p_dana',randomUUID(),JSON.stringify(snapshot)]),/ACTOR_REFUSED/);
 const failedRun=randomUUID();
 await db.admin.query("update care_plans set text='Must survive failed Reset' where child_id='p_nora'");
 const invalid={...snapshot,goals:[{id:'invalid_goal',child_id:'p_nora',title:null}]};
 await assert.rejects(db.admin.query('select restore_showcase_snapshot($1,$2,$3::jsonb)',['p_demo_guide',failedRun,JSON.stringify(invalid)]),/null value/);
 assert.equal((await db.admin.query("select text from care_plans where child_id='p_nora'")).rows[0].text,'Must survive failed Reset');
 assert.equal((await db.admin.query('select count(*)::int as n from demo_reset_runs where run_id=$1',[failedRun])).rows[0].n,0);
 assert.equal(await unrelated(),before);
 await db.admin.query('begin');await db.admin.query('set local role authenticated');
 await assert.rejects(db.admin.query('select restore_showcase_snapshot($1,$2,$3::jsonb)',['p_demo_guide',randomUUID(),JSON.stringify(snapshot)]),/permission denied/);
 await db.admin.query('rollback');
 console.log('Scoped reset: canonical care restored, other families/unmarked rows unchanged, idempotency, actor refusal, failed-restore rollback and direct-RPC refusal passed');
}finally{await db.close()}
