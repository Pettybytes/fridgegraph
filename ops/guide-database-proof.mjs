import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { createSimulatedPrivate } from '../src/fixtures-simulated.ts';
import { guideDatabase, insertRows } from './guide-database.mjs';
export async function proveGuideReads(db) {
 for(const [table,rows] of Object.entries(createSimulatedPrivate())) if(Array.isArray(rows))await insertRows(db.admin,table,rows);
 const privateCount=await db.admin.query("select count(*)::int as n from household_members where household_id like 'fx_%'");
 assert.ok(privateCount.rows[0].n>0,'non-sandbox fixture must exist');
 const actors=[['guide','p_demo_guide',true],['kendra','p_mom',false],['dana','p_dana',false],['spoofed-guide','p_mom',true]];
 const ids=new Map(actors.map(([name])=>[name,randomUUID()]));
 ids.set('spoofed-guide',ids.get('kendra'));
 for(const [name,person] of actors.filter(([name])=>name!=='spoofed-guide'))await db.admin.query('insert into identity_map(user_id,person_id) values($1,$2)',[ids.get(name),person]);
 await db.admin.query(`
  insert into fridge_notes(id,child_id,author_id,text,audience,sandbox) values ('fridge_demo_note_guide_proof','p_jax','p_dana','Jax family note','PARENTS_ONLY',true);
  insert into fridge_notes(id,child_id,author_id,text,audience,sandbox) values ('unmarked_parent_note','p_jax','p_dana','Not showcase content','PARENTS_ONLY',false);
  insert into fridge_item_preferences(child_id,kind,item_id,color,font) values ('p_jax','art','guide_proof_goal',null,null);
  insert into orbit_alerts(id,child_id,created_by,status,closed_by,closed_at,minimal_message,sandbox)
   values ('guide_proof_alert','p_jax','p_dana','CLOSED','p_dana',now(),'Recorded Jax message',true);
  insert into orbit_audience_members(orbit_alert_id,person_id,notify_order,eligible) values ('guide_proof_alert','p_ray',1,true);
  insert into orbit_responses(id,orbit_alert_id,person_id,response) values ('guide_proof_response','guide_proof_alert','p_ray','WITH_ME');
 `);
 const client=new pg.Client(db.options);await client.connect();
 try{
  for(const [name,,guide] of actors){
   await client.query('begin');await client.query('set local role authenticated');
   await client.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:ids.get(name),app_metadata:{demo:true,demo_guide:guide}})]);
   const queries=[
    "select id from fridge_notes where id='fridge_demo_note_guide_proof'",
    "select item_id from fridge_item_preferences where item_id='guide_proof_goal'",
    "select * from orbit_share_for('guide_proof_alert')",
    "select * from orbit_audience_members where orbit_alert_id='guide_proof_alert'",
    "select * from orbit_responses where orbit_alert_id='guide_proof_alert'",
    "select * from village_places_for_child('p_jax')",
   ];
   for(const sql of queries){const result=await client.query(sql);assert.equal(result.rows.length>0,['guide','dana'].includes(name),`${name}: ${sql}`)}
   if(name==='guide'){
    assert.equal((await client.query("select id from fridge_notes where id='unmarked_parent_note'")).rows.length,0,'unmarked parent notes stay private');
    for(const sql of [
     "insert into fridge_notes(id,child_id,author_id,text) values ('guide_write','p_jax','p_demo_guide','Forbidden')",
     "select save_fridge_preference('p_jax','art','guide_proof_goal',null,'red','kalam',false)",
     "select create_calendar_event('p_jax','Forbidden',now()::timestamp,(now()+interval '1 hour')::timestamp)",
    ]){
     await client.query('savepoint guide_write');
     await assert.rejects(client.query(sql),/policy|UNAUTHORIZED|FORBIDDEN|READ_ONLY|SHOWCASE_WRITE_REFUSED/i);
     await client.query('rollback to savepoint guide_write');
    }
    const privateRows=await client.query("select person_id from household_members where household_id like 'fx_%'");
    assert.equal(privateRows.rows.length,0,'guide must not read non-sandbox households');
   }
   await client.query('rollback');
  }
  console.log('Guide PostgreSQL proof: 24 read checks, 3 refused writes, non-sandbox exclusion passed');
 }finally{await client.end()}
}
if(process.argv[1]?.endsWith('/guide-database-proof.mjs')){
 const db=await guideDatabase({before:process.argv.includes('--before-guide-fix')});
 try{await proveGuideReads(db)}finally{await db.close()}
}
