import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {preferencesFixture} from './preferences';
import {createFridgeSeed,fridgeFamilies,seedFridge} from '../../fixtures-fridge';
const fixture=await preferencesFixture();
try{
 const {admin}=fixture;await fixture.apply();
 for(const family of fridgeFamilies){
  await admin.query("insert into people(id,display_name,birth_date) values($1,$2,DATE '1988-01-01') on conflict(id) do nothing",[family.parent,family.key]);
  await admin.query('insert into households(id,village_id) values($1,$2) on conflict(id) do nothing',[`h_${family.key}`,'v']);
  await admin.query("insert into household_members(person_id,household_id,role) values($1,$2,'parent') on conflict do nothing",[family.parent,`h_${family.key}`]);
  for(const child of family.children){
   await admin.query("insert into people(id,display_name,birth_date) values($1,$2,DATE '1988-01-01') on conflict(id) do nothing",[child,family.name]);
   await admin.query('insert into children(person_id) values($1) on conflict do nothing',[child]);
   await admin.query("insert into household_members(person_id,household_id,role) values($1,$2,'child') on conflict do nothing",[child,`h_${family.key}`]);
  }
 }
 const uid=randomUUID();
 await admin.query("insert into people(id,display_name,birth_date) values('p_demo_guide','Demo guide',DATE '1988-01-01')");
 await admin.query("insert into identity_map(user_id,person_id) values($1,'p_demo_guide')",[uid]);
 await admin.query("create function is_demo_guide() returns boolean language sql stable as $$select current_person()='p_demo_guide'$$; create function is_sandbox_child(p_child text) returns boolean language sql stable security definer set search_path=public as $$select p_child<>'p_other' and exists(select 1 from children where person_id=p_child)$$;");
 await admin.query('create policy demo_guide_goals on goals for select to authenticated using(is_demo_guide() and is_sandbox_child(child_id))');
 const write=async(table:string,rows:Record<string,unknown>[],conflict='id')=>{
  for(const row of rows){const keys=Object.keys(row);await admin.query(`insert into ${table}(${keys.join(',')}) values(${keys.map((_,i)=>`$${i+1}`).join(',')}) on conflict(${conflict}) do update set ${keys.filter(k=>!conflict.split(',').includes(k)).map(k=>`${k}=excluded.${k}`).join(',')}`,Object.values(row));}
  return rows.length;
 };
 await seedFridge(write);
 const guide=async(sql:string)=>{await admin.query('begin');try{await admin.query('set local role authenticated');await admin.query("select set_config('test.current_uid',$1,true)",[uid]);return await admin.query(sql)}finally{await admin.query('rollback')}};
 assert.equal((await guide('select id from fridge_notes')).rows.length,0);
 console.log('RED: seeded notes are absent from the guide before migration');
 // Minimal policy fixture: the full atomic restore is exercised by family-reset.proof.ts.
 const migration=readFileSync('supabase/migrations/0097_fridge_demo_guide_reads.sql','utf8');
 await admin.query(migration.slice(0,migration.indexOf('-- Extend the owner-only'))+'commit;');
 const rows=createFridgeSeed();assert.equal((await guide('select id from fridge_notes')).rows.length,rows.fridge_notes.length);
 assert.equal((await guide("select id from fridge_notes where id='note_fixture'")).rows.length,0);
 await admin.query("insert into fridge_notes(id,child_id,author_id,text,sandbox) values('fridge_demo_note_outside','p_other','p_outside','Outside sandbox',true)");
 assert.equal((await guide("select id from fridge_notes where child_id='p_other'")).rows.length,0);
 assert.equal((await guide("update fridge_notes set text='Changed' returning id")).rows.length,0);
 assert.equal((await guide('delete from fridge_notes returning id')).rows.length,0);
 await assert.rejects(guide("select save_fridge_preference('p_nora','art','x',null,'blue','kalam')"),/UNAUTHORIZED/);
 const before=(await admin.query("select id,title,horizon,status from goals where id like 'fridge_demo_%' order by id")).rows;
 await admin.query("update goals set title='Temporary edit' where id='fridge_demo_goal_p_nora_0'");
 await admin.query('begin');
 await admin.query("delete from fridge_notes where id like 'fridge_demo_%'; delete from goals where id like 'fridge_demo_%'");
 await seedFridge(write);await seedFridge(write);
 await admin.query('commit');
 assert.equal((await guide('select id from fridge_notes')).rows.length,rows.fridge_notes.length);
 assert.deepEqual((await admin.query("select id,title,horizon,status from goals where id like 'fridge_demo_%' order by id")).rows,before);
 const style=(await guide("select read_fridge_preferences('p_nora') as items")).rows[0].items.find((item:any)=>item.itemId==='fridge_demo_goal_p_nora_0');
 assert.equal(style.color,'blue');assert.equal(style.font,'kalam');
 console.log(`GREEN: ${rows.goals.length} goals and ${rows.fridge_notes.length} notes restored deterministically; guide reads only demo notes, sees styles, and cannot write`);
}finally{await fixture.close()}
