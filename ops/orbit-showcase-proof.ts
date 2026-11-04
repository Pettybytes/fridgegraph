/** Full migration rehearsal and Orbit lifecycle proof in disposable PostgreSQL only. */
import {guideDatabase} from './guide-database.mjs';
import {resetSnapshot} from '../src/demo/reset';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
async function main(){
 const db=await guideDatabase(),c=db.admin;
 try {
 const families: [string,string[]][]=[['p_mom',['p_nora','p_max','p_leo']],['p_dana',['p_jax']],['p_rosa',['p_emma']],['p_felicia',['p_taylor','p_skye']],['p_simone',['p_micah','p_avery']],['p_dwayne',['p_malik']]];
 const identities=new Map<string,string>();
 for(const parent of [...families.map(f=>f[0]),'p_demo_guide','p_gma']){const uid=randomUUID();identities.set(parent,uid);await c.query('insert into identity_map(user_id,person_id)values($1,$2)',[uid,parent]);}
 async function as(parent:string){await c.query('reset role');await c.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[identities.get(parent),JSON.stringify({sub:identities.get(parent),app_metadata:{demo:true,demo_guide:parent==='p_demo_guide'}})]);await c.query('set role authenticated');}
 async function activate(child:string,photo?:string){
  const draft=(await c.query('select * from draft_orbit_share($1,p_photo=>$2)',[child,photo??null])).rows[0];
  const preview=(await c.query('select * from preview_orbit_share($1)',[draft.id])).rows[0];
  assert.equal(preview.audience_size,3);
  return (await c.query('select activate_orbit_alert($1,$2,$3) id',[draft.id,preview.draft_version,preview.message_hash])).rows[0].id;
 }
 const photos=new Map<string,string>();
 const activeIds=new Map<string,string>();
 for(const [parent,children]of families)for(const child of children){
  await as(parent);
  const audience=(await c.query('select person_id from orbit_audience_for($1) order by notify_order',[child])).rows.map(r=>r.person_id);
  assert.deepEqual(audience,['p_tasha','p_gma','p_bryan']);
  const photo=(await c.query('select register_orbit_photo($1,$2,$3) id',[child,'a'.repeat(64),child+'.jpg'])).rows[0].id;photos.set(child,photo);
  assert.equal((await c.query('select * from orbit_photo_access($1)',[photo])).rows[0].access,'PARENT');
  const id=await activate(child,photo);
  assert.equal((await c.query('select status from orbit_alerts where id=$1',[id])).rows[0].status,'ACTIVE');
  assert.deepEqual((await c.query('select distinct notification_outcome from orbit_audience_members where orbit_alert_id=$1',[id])).rows,[{notification_outcome:'SIMULATED'}]);
  await c.query('select close_orbit_alert($1,$2)',[id,'FOUND_SAFE']);
  await c.query('select close_orbit_alert($1,$2)',[id,'FOUND_SAFE']);
  assert.deepEqual((await c.query('select status,close_outcome from orbit_alerts where id=$1',[id])).rows[0],{status:'CLOSED',close_outcome:'FOUND_SAFE'});
  activeIds.set(child,await activate(child)); // leave one active for Reset proof
 }
 console.log('PASS: ten children, three approved responders, photo registration/access, activation, idempotent Found safe, no live notifications');
 await as('p_dana');
 await assert.rejects(c.query('select activate_orbit_alert($1,1,$2)',[activeIds.get('p_nora'),'fixture']),/UNAUTHORIZED/);
 await assert.rejects(c.query('select close_orbit_alert($1)',[activeIds.get('p_nora')]),/UNAUTHORIZED/);
 assert.equal((await c.query('select * from orbit_photo_access($1)',[photos.get('p_nora')])).rows[0].access,null);
 await assert.rejects(c.query("select * from draft_orbit_share('p_nora')"),/UNAUTHORIZED/);
 await assert.rejects(c.query('select register_orbit_photo($1,$2,$3)',['p_nora','b'.repeat(64),'forbidden.jpg']),/UNAUTHORIZED/);
 await as('p_demo_guide');
 await assert.rejects(c.query("select * from draft_orbit_share('p_jax')"),/UNAUTHORIZED/);
 await c.query('reset role');
 const snap=resetSnapshot();
 const reset=async()=>{await c.query("select set_config('request.jwt.claims','{}',false),set_config('request.jwt.claim.sub','',false)");return c.query('select restore_demo_snapshot($1,$2::uuid,$3::jsonb,$4::jsonb)',['p_mom',randomUUID(),JSON.stringify(snap.fixtures),JSON.stringify(snap.cast)]);};
 await reset();assert.equal((await c.query("select count(*)::int n from orbit_alerts where status='ACTIVE'")).rows[0].n,0);
 await c.query("delete from household_policies where rule='orbit_notify_eligible'");await reset();
 for(const [parent,children]of families)for(const child of children){await as(parent);assert.equal((await c.query('select count(*)::int n from orbit_audience_for($1)',[child])).rows[0].n,3);}
 await as('p_dana');
 const draft=(await c.query("select * from draft_orbit_share('p_jax')")).rows[0];
 await c.query('reset role');await c.query("delete from household_policies where household_id='h_c' and rule='orbit_notify_eligible'");
 await as('p_dana');const preview=(await c.query('select * from preview_orbit_share($1)',[draft.id])).rows[0];await assert.rejects(c.query('select activate_orbit_alert($1,$2,$3)',[draft.id,preview.draft_version,preview.message_hash]),/ORBIT_NO_AUDIENCE/);
 await c.query('reset role');await reset();
 await as('p_demo_guide');const guide=await activate('p_nora');await c.query('select close_orbit_alert($1)',[guide]);
 await c.query('reset role');await reset();
 console.log('PASS: cross-family draft/upload/photo denied; guide confined to Ellison; Reset clears all active alerts and restores every audience');

 } finally {await db.close();}
}
main().catch(e=>{console.error(e.message);process.exit(1)});
