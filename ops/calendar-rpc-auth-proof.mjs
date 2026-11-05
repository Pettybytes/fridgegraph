// Direct RPC authorization against disposable PostgreSQL; no shared DB or credentials.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {guideDatabase} from './guide-database.mjs';
import {resetSnapshot} from '../src/demo/reset.ts';
const db=await guideDatabase();
try {
 const snapshot=resetSnapshot();
 await db.admin.query('select restore_demo_snapshot($1,$2,$3,$4)',['calendar-rpc-auth',randomUUID(),JSON.stringify(snapshot.fixtures),JSON.stringify(snapshot.cast)]);
 const identities={};
 for(const person of ['p_mom','p_rosa','p_priya','p_dana','p_demo_guide']){
  identities[person]=randomUUID();await db.admin.query('insert into identity_map(user_id,person_id) values($1,$2)',[identities[person],person]);
 }
 await db.admin.query(`insert into people(id,display_name,birth_date) values('p_private_calendar','Private test child','2017-01-01');
  insert into households(id,village_id,sandbox) values('h_private_calendar','v_nora',false);
  insert into children(person_id) values('p_private_calendar');
  insert into household_members(household_id,person_id,role) values('h_private_calendar','p_private_calendar','child');
  insert into parenting_schedules(child_id,parent_id,weekdays,handoff_time,handoff_location) values('p_private_calendar','p_mom',array['MON','TUE','WED','THU','FRI','SAT','SUN'],'08:00','Private handoff');`);
 async function call(person,child,day='2026-11-04',{role='authenticated',guide=person==='p_demo_guide'}={}){
  await db.admin.query('begin');
  try{
   await db.admin.query(`set local role ${role==='anon'?'anon':'authenticated'}`);
   await db.admin.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({...(person?{sub:identities[person]}:{}),app_metadata:{demo:true,demo_guide:guide}})]);
   return (await db.admin.query('select * from public.effective_schedule_for($1,$2)',[child,day])).rows;
  }finally{await db.admin.query('rollback');}
 }
 const refused=async(...args)=>assert.rejects(call(...args),e=>e.code==='42501');
 await refused('p_dana','p_nora'); // Reproduces 0099's direct-RPC leak before the repair.
 for(const [person,child] of [['p_mom','p_nora'],['p_rosa','p_emma'],['p_priya','p_nora'],['p_demo_guide','p_nora']]){
  const [row]=await call(person,child);assert.ok(row.parent_id);assert.ok(row.handoff_time);assert.ok(row.handoff_location);
 }
 await refused(null,'p_nora','2026-11-04',{role:'anon'});
 await refused(null,'p_nora');
 await refused('p_demo_guide','p_private_calendar');
 await db.admin.query("insert into grants(id,actor_id,child_id,scopes,granted_by) values('g_private_guide_probe','p_demo_guide','p_private_calendar',array['schedule.read'],'p_mom')");
 await refused('p_demo_guide','p_private_calendar'); // Guide must stay showcase-only even if an ordinary grant exists.
 await refused('p_dana','p_nora','2026-11-04',{guide:true});
 await refused('p_demo_guide','p_nora','2026-11-04',{guide:false});
 const [holiday]=await call('p_mom','p_nora','2026-11-11');assert.equal(holiday.source,'ARRANGEMENT');assert.ok(holiday.arrangement_id);assert.equal(holiday.handoff_location,null);
 const [weekly]=await call('p_mom','p_nora');assert.equal(weekly.source,'WEEKLY');
 // A real cross-family schedule share is allowed; expiry revokes it. Household-only
 // authorization would fail this test and would incorrectly remove legitimate shares.
 await db.admin.query("insert into grants(id,actor_id,child_id,scopes,valid_from,granted_by) values('g_calendar_rpc_share','p_dana','p_nora',array['schedule.read'],date '2026-11-04','p_mom')");
 assert.ok((await call('p_dana','p_nora'))[0].handoff_location);
 await db.admin.query("update grants set valid_from=date '2026-11-04'-2,valid_until=date '2026-11-04'-1 where id='g_calendar_rpc_share'");
 await refused('p_dana','p_nora');
 // This repair grants no guide writes.
 await db.admin.query('begin');
 try{await db.admin.query('set local role authenticated');await db.admin.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:identities.p_demo_guide,app_metadata:{demo_guide:true}})]);
  await assert.rejects(db.admin.query("select create_calendar_event('p_nora','Forbidden','2026-11-05T21:00','2026-11-05T22:00')"),e=>e.code==='42501');
 }finally{await db.admin.query('rollback');}
 console.log('PASS direct RPC: parent, guardian, legitimate cross-family share, expired-share refusal, unauthorized cross-family refusal, anon/no-identity refusal, trusted guide showcase read, private-child and spoofed-guide refusal, holiday precedence, no guide writes');
}finally{await db.close();}
