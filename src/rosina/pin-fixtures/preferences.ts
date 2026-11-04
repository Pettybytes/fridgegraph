// Disposable Postgres fixture. No project environment, credentials, or shared database connection.
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
export async function preferencesFixture(){
 const name=`fridge-preferences-${randomUUID().slice(0,8)}`;
 function docker(...args:string[]){const r=spawnSync('docker',args,{encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim()}
 docker('run','-d','--name',name,'-e','POSTGRES_HOST_AUTH_METHOD=trust','-p','127.0.0.1::5432','postgres:16-alpine');
 const port=Number(docker('port',name,'5432/tcp').split(':').pop());
 const config={host:'127.0.0.1',port,user:'postgres',database:'postgres'};
 const admin=new pg.Client(config);
 const close=async()=>{await admin.end();docker('rm','-f',name)};
 try{
  for(let n=0;n<30;n++){if(spawnSync('docker',['exec',name,'pg_isready','-h','127.0.0.1','-U','postgres']).status===0)break;await new Promise(r=>setTimeout(r,500))}
  await admin.connect();
  await admin.query(`create role authenticated;create role anon;create role service_role;
   create extension pgcrypto;create schema auth;
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.current_uid',true),'')::uuid$$;
   create function auth.jwt() returns jsonb language sql stable as $$select '{}'::jsonb$$;`);
  for(const file of ['0001_schema','0003_rls','0004_grants','0006_local_today','0024_authority_model','0083_fridge_phase2','0090_pin_media'])await admin.query(readFileSync(`supabase/migrations/${file}.sql`,'utf8'));
  await admin.query(`insert into villages(id,name) values('v','Fixture village');
   insert into people(id,display_name,birth_date) values('p_nora','Nora','2018-01-01'),('p_other','Other child','2019-01-01'),('p_mom','Kendra','1988-01-01'),('p_dad','Andre','1988-01-01'),('p_reader','Reader','1988-01-01'),('p_outside','Other parent','1988-01-01');
   insert into children(person_id) values('p_nora'),('p_other');
   insert into households(id,village_id) values('h','v'),('other','v');
   insert into household_members(person_id,household_id,role) values('p_nora','h','child'),('p_mom','h','parent'),('p_dad','h','parent'),('p_other','other','child'),('p_outside','other','parent');
   insert into goals(id,child_id,title,proposed_by_id,status) values('goal_fixture','p_nora','Read together','p_mom','APPROVED');
   insert into fridge_notes(id,child_id,author_id,text,audience) values('note_fixture','p_nora','p_mom','A fixture sticky','SHARED');
   insert into grants(id,actor_id,child_id,scopes,granted_by) values('grant_fixture','p_reader','p_nora',array['fridge.read','goals.read'],'p_mom');`);
  const identities:Record<string,string>={};
  for(const person of ['p_mom','p_dad','p_reader','p_outside']){identities[person]=randomUUID();await admin.query('insert into identity_map(user_id,person_id) values($1,$2)',[identities[person],person])}
  async function as(person:string,sql:string,values:unknown[]=[]){
   const caller=new pg.Client(config);await caller.connect();
   try{await caller.query('set role authenticated');await caller.query("select set_config('test.current_uid',$1,false)",[identities[person]??'']);return await caller.query(sql,values)}finally{await caller.end()}
  }
  return {admin,as,close,apply:()=>admin.query(readFileSync('supabase/migrations/0094_fridge_item_preferences.sql','utf8'))};
 }catch(error){await close();throw error}
}
