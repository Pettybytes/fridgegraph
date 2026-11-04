// Isolated PostgreSQL proof: no shared database or credentials.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {guideDatabase} from './guide-database.mjs';
import {resetSnapshot} from '../src/demo/reset.ts';
const db=await guideDatabase();
try {
 const snapshot=resetSnapshot();
 await db.admin.query('select restore_demo_snapshot($1,$2,$3,$4)',['calendar-write-proof',randomUUID(),JSON.stringify(snapshot.fixtures),JSON.stringify(snapshot.cast)]);
 const identities={};
 for(const person of ['p_mom','p_dad','p_dana','p_demo_guide']){
  identities[person]=randomUUID();
  await db.admin.query('insert into identity_map(user_id,person_id) values($1,$2)',[identities[person],person]);
 }
 const as=async(person,fn)=>{const c=new pg.Client(db.options);await c.connect();try{
  await c.query('begin');await c.query('set local role authenticated');
  await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:identities[person],app_metadata:{demo:true,demo_guide:person==='p_demo_guide'}})]);
  const result=await fn(c);await c.query('commit');return result;
 }finally{await c.end();}};
 const write=(person,operation,key,args)=>as(person,async c=>(await c.query('select calendar_write_once($1,$2,$3) result',[operation,key,JSON.stringify(args)])).rows[0].result);
 const args={p_child:'p_nora',p_title:"Nora's birthday party",p_start:'2026-11-05T21:00:00',p_end:'2026-11-05T22:00:00',p_location:'Family home',p_status:'confirmed'};
 const key=randomUUID();
 const results=await Promise.all(Array.from({length:5},()=>write('p_mom','create',key,args)));
 assert.ok(results.every(r=>r.id===results[0].id));
 assert.equal((await db.admin.query("select count(*)::int n from village_event where payload->>'eventId'=$1",[results[0].id])).rows[0].n,1);
 await assert.rejects(write('p_mom','create',key,{...args,p_title:'Changed'}),/IDEMPOTENCY_KEY_REUSED/);
 await assert.rejects(write('p_dana','create',randomUUID(),args),/FORBIDDEN/);
 await assert.rejects(write('p_mom','create',randomUUID(),{...args,p_child:'p_jax'}),/FORBIDDEN/);
 const move={...args,p_id:results[0].id,p_start:'2026-11-05T19:00:00',p_end:'2026-11-05T20:00:00'};delete move.p_child;
 const moved=await write('p_mom','update',randomUUID(),move);
 await assert.rejects(write('p_mom','create',key,args),/CALENDAR_RECEIPT_STALE/);assert.equal(moved.start_at,'2026-11-05T19:00:00');
 const visible=await as('p_dad',c=>c.query('select id from events where id=$1',[moved.id]));assert.equal(visible.rowCount,1);
 const hidden=await as('p_dana',c=>c.query('select id from events where id=$1',[moved.id]));assert.equal(hidden.rowCount,0);
 const deleteKey=randomUUID();await Promise.all(Array.from({length:3},()=>write('p_mom','delete',deleteKey,{p_id:moved.id})));
 assert.equal((await db.admin.query("select count(*)::int n from village_event where payload->>'eventId'=$1",[moved.id])).rows[0].n,3);
 const guide=await write('p_demo_guide','create',randomUUID(),args);assert.ok(guide.id);
 await db.admin.query("update households set sandbox=false where id in(select household_id from household_members where person_id='p_nora')");
 await assert.rejects(write('p_demo_guide','create',randomUUID(),args),/FORBIDDEN/);
 await db.admin.query('select restore_demo_snapshot($1,$2,$3,$4)',['calendar-write-proof',randomUUID(),JSON.stringify(snapshot.fixtures),JSON.stringify(snapshot.cast)]);
 console.log('PASS: concurrent create/delete retries, one Activity row per write, key mismatch refusal, parent/guide scope, Andre persistence, Dana refusal');
}finally{await db.close();}
