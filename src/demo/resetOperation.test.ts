import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEMO_PERSONAS } from './personas';
import { createResetOperations, resetPersona, validResetRunId } from './resetOperation';
const kendra=DEMO_PERSONAS.find(p=>p.id==='kendra')!,dana=DEMO_PERSONAS.find(p=>p.id==='dana')!;
const runId='dc880956-a6db-413e-85dc-d912b3ebd76b';
const session=async()=>({session:{access_token:'test-only-reset',refresh_token:'test-only-backend',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600}});
test('commit returns the caller fresh session with run id, never cleanup payload',async()=>{
 const ops=createResetOperations({restore:async()=>({familyRows:['must-not-leak']}),committed:async()=>true,session});
 const result=await ops.start(kendra,runId);
 assert.equal(result.status,'committed');assert.equal('personaId' in result&&result.personaId,'kendra');
 assert.equal('session' in result&&result.session?.access_token,'test-only-reset');
 assert.equal(JSON.stringify(result).includes('must-not-leak'),false);
 assert.equal(JSON.stringify(result).includes('refresh_token'),false);
});
test('auth mint failure or bounded delay cannot turn committed data into a failed reset',async()=>{
 for(const mint of [async()=>{throw Error('auth unavailable')},()=>new Promise<never>(()=>{})]){
  const ops=createResetOperations({restore:async()=>{},committed:async()=>true,session:mint,sessionTimeoutMs:5});
  const r=await ops.start(kendra,runId);assert.equal(r.status,'committed');assert.equal('session' in r&&r.session,null);
 }
});
test('lost SQL response is reconciled by durable receipt and never reruns the mutation',async()=>{
 let writes=0;
 const ops=createResetOperations({restore:async()=>{writes++;throw Object.assign(Error('connection lost'),{code:'ECONNRESET'})},committed:async()=>true,session});
 assert.equal((await ops.start(kendra,runId)).status,'committed');assert.equal((await ops.status(kendra,runId)).status,'committed');assert.equal(writes,1);
 assert.equal((await ops.status(dana,runId)).status,'unknown');
});
test('only proven SQL rollback is failed; missing network acknowledgement stays unknown',async()=>{
 for(const [code,want]of [['P0001','failed'],['23503','failed'],['ECONNRESET','unknown'],['08007','unknown'],['08006','unknown'],['57P01','unknown'],['40003','unknown']]){
  const ops=createResetOperations({restore:async()=>{throw Object.assign(Error('injected'),{code})},committed:async()=>false,session});
  assert.equal((await ops.start(kendra,runId)).status,want);
 }
});
test('known pending operation reports running and a duplicate does not restore twice',async()=>{
 let finish!:()=>void,writes=0;
 const ops=createResetOperations({restore:async()=>{writes++;await new Promise<void>(r=>{finish=r})},committed:async()=>false,session});
 const first=ops.start(kendra,runId);assert.equal((await ops.status(kendra,runId)).status,'running');assert.equal((await ops.start(kendra,runId)).status,'running');finish();await first;assert.equal(writes,1);
});
test('reset-only authority is verified demo identity, seeded parent/guardian, never the read-only guide',()=>{
 for(const persona of DEMO_PERSONAS){const eligible=!!(persona.parent||persona.guardian);assert.equal(!!resetPersona({ok:true,demo:true,demoGuide:persona.id==='demo-guide',personId:persona.personId}),eligible);}
 assert.equal(resetPersona({ok:true,demo:false,personId:'p_mom'}),undefined);
 assert.equal(resetPersona({ok:true,demo:true,demoGuide:true,personId:'p_demo_guide'}),undefined);
 assert.equal(resetPersona({ok:true,demo:true,demoGuide:true,personId:'p_mom'}),undefined);
 assert.equal(resetPersona({ok:true,demo:true,demoGuide:false,personId:'p_demo_guide'}),undefined);
 assert.equal(resetPersona({ok:true,demo:true,personId:'p_family_forged'}),undefined);
 assert.equal(resetPersona({ok:false,demo:true,personId:'p_mom'}),undefined);
 assert.equal(validResetRunId(runId),true);assert.equal(validResetRunId('not-a-uuid'),false);
});
