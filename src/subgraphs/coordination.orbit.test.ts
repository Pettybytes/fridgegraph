import {test} from 'node:test';
import assert from 'node:assert/strict';
import {graphql,GraphQLError} from 'graphql';
import {buildSubgraphSchema} from '@apollo/subgraph';
import coordination from './coordination';
import {createSimulatedOrbit} from '../fixtures-simulated';

test('all showcase households restore the approved test responder audience',()=>{
 const rows=createSimulatedOrbit().household_policies;
 assert.deepEqual(rows.map(r=>r.household_id).sort(),['h_a','h_b','h_c','h_emma','h_malik','h_micah','h_taylor']);
 for(const row of rows)assert.equal(row.value,row.household_id==='h_a'?'p_dad,p_gma,p_bryan':'p_tasha,p_gma,p_bryan');
});
for(const code of ['ORBIT_NO_AUDIENCE','ORBIT_NOT_FOUND','ORBIT_DRAFT_STALE','UNAUTHORIZED']){
 test(`activation returns typed ${code} without database details`,async()=>{
  const ctx:any={today:'2026-11-04',callerId:'p_mom',db:{rpc:async()=>({data:null,error:{code:'22023',message:code,details:'private database detail'}})}};
  await assert.rejects(coordination.resolvers.Mutation.orbitActivate(null,{draftId:'fixture',draftVersion:1,messageHash:'hash'},ctx),e=>e instanceof GraphQLError&&e.extensions.code===code&&!e.message.includes('private'));
 });
}

test('GraphQL activation reports a code rather than an unexplained non-null violation',async()=>{
 const schema=buildSubgraphSchema([{typeDefs:coordination.typeDefs,resolvers:coordination.resolvers as never}]);
 const result=await graphql({schema,source:'mutation OrbitMissingAudience($id:ID!){orbitActivate(draftId:$id,draftVersion:1,messageHash:"fixture"){id}}',variableValues:{id:'fixture'},contextValue:{callerId:'p_mom',today:'2026-11-04',db:{rpc:async()=>({data:null,error:{code:'22023',message:'ORBIT_NO_AUDIENCE'}})}}});
 assert.equal(result.errors?.[0].extensions.code,'ORBIT_NO_AUDIENCE');
 assert.equal(result.errors?.[0].message,'ORBIT_NO_AUDIENCE');
});
