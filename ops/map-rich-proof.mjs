import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {guideDatabase} from './guide-database.mjs';
const db=await guideDatabase();
try{
 const children=['p_nora','p_max','p_leo','p_jax','p_emma','p_malik','p_avery','p_micah','p_skye','p_taylor'];
 for(const child of children){
  const count=(await db.admin.query('select count(*)::int n from showcase_person_places where child_id=$1',[child])).rows[0].n;assert.ok(count>0,child);
 }
 for(const [person,child,allowed] of [['p_mom','p_nora',true],['p_mom','p_leo',true],['p_dad','p_nora',true],['p_dana','p_jax',true],['p_dwayne','p_malik',true],['p_rosa','p_emma',true],['p_felicia','p_skye',true],['p_demo_guide','p_nora',true],['p_mom','p_jax',false],['p_dana','p_nora',false],['p_priya','p_nora',false]]){
  const id=randomUUID();await db.admin.query('insert into identity_map(user_id,person_id) values($1,$2) on conflict(person_id) do update set user_id=excluded.user_id',[id,person]);
  await db.admin.query('begin');await db.admin.query('set local role authenticated');
  await db.admin.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:id,app_metadata:{demo:true,demo_guide:person==='p_demo_guide'}})]);
  const rows=(await db.admin.query('select * from showcase_person_places_for_child($1)',[child])).rows;
  assert.equal(rows.length>0,allowed,person+child);
  if(allowed){
   const places=(await db.admin.query('select * from village_places_for_child($1)',[child])).rows;
   for(const place of places.filter(p=>p.kind==='HOME'))assert.ok(rows.some(r=>r.place_id===place.id),'no sibling-only person home leaks');
   for(const row of rows)assert.ok(places.some(p=>p.id===row.place_id&&p.state==='granted'));
   const foreign='showcase_foreign';assert.equal((await db.admin.query('select showcase_route_allowed($1,$2,$3) allowed',[child,rows[0].place_id,foreign])).rows[0].allowed,false);
  }
  await db.admin.query('rollback');
 }
 const before=JSON.stringify((await db.admin.query("select * from showcase_person_places where child_id='p_jax' order by person_id")).rows);
 await db.admin.query("delete from recorded_places where id in(select place_id from showcase_person_places where child_id='p_nora')");
 await db.admin.query("select seed_showcase_person_places(array['p_nora','p_max','p_leo'])");
 assert.ok((await db.admin.query("select count(*)::int n from showcase_person_places where child_id='p_nora'")).rows[0].n>0);
 assert.equal(JSON.stringify((await db.admin.query("select * from showcase_person_places where child_id='p_jax' order by person_id")).rows),before);
 console.log('PASS all ten showcase rosters, parent/guide locations, cross-family and address refusals, route isolation, scoped restoration');
}finally{await db.close()}
