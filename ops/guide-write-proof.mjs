import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {guideDatabase} from './guide-database.mjs';
const db=await guideDatabase({beforeShowcase:process.argv.includes('--before-showcase')});
const caller=new pg.Client(db.options);
try {
 await caller.connect();
 for(const [person,guide] of [['p_demo_guide',true],['p_mom',false],['p_dana',false]]){
  const id=randomUUID();
  await db.admin.query('insert into identity_map(user_id,person_id) values($1,$2)',[id,person]);
  await caller.query('begin');
  await caller.query('set local role authenticated');
  await caller.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:id,app_metadata:{demo:true,demo_guide:guide}})]);
  for(const child of ['p_nora','p_max','p_leo','p_jax']){
   const expected=person==='p_dana'?child==='p_jax':child!=='p_jax';
   assert.equal((await caller.query('select is_parent_of($1) as allowed',[child])).rows[0].allowed,expected,`${person}: ${child}`);
   await caller.query('savepoint action');
   const write=()=>caller.query("select create_calendar_event($1,'Guide proof',now()::timestamp,(now()+interval '1 hour')::timestamp)",[child]);
   if(expected)assert.ok((await write()).rows.length);else await assert.rejects(write(),/UNAUTHORIZED|FORBIDDEN/i);
   await caller.query('rollback to savepoint action');
  }
  if(guide){
   for(const child of ['p_nora','p_jax']){
    await caller.query('savepoint scoped');
    const save=()=>caller.query("insert into care_plans(child_id,text) values($1,'Judge care plan') on conflict(child_id) do update set text=excluded.text returning child_id",[child]);
    if(child==='p_nora')assert.equal((await save()).rows.length,1);else await assert.rejects(save(),/policy|REFUSED/i);
    await caller.query('rollback to savepoint scoped');
    await caller.query('savepoint fridge');
    const post=()=>caller.query("insert into fridge_notes(id,child_id,author_id,text,sandbox) values($1,$2,'p_demo_guide','Judge note',true) returning id",['guide_note_'+child,child]);
    if(child==='p_nora')assert.equal((await post()).rows.length,1);else await assert.rejects(post(),/policy|REFUSED/i);
    await caller.query('rollback to savepoint fridge');
   }
   for(let i=0;i<120;i++)await caller.query("insert into fridge_notes(id,child_id,author_id,text,sandbox) values($1,'p_nora','p_demo_guide','Rate proof',true)",['rate_'+i]);
   await caller.query('savepoint cap');
   await assert.rejects(caller.query("insert into fridge_notes(id,child_id,author_id,text,sandbox) values('rate_over','p_nora','p_demo_guide','Over cap',true)"),/SHOWCASE_RATE_LIMITED/);
   await caller.query('rollback to savepoint cap');
  }
  await caller.query('rollback');
 }
 console.log('Guide write proof: 12 authority decisions and 12 calendar writes/refusals, care/Fridge isolation and 120-write cap passed');
}finally{await caller.end();await db.close()}
