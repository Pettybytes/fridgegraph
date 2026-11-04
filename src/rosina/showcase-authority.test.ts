import test from 'node:test';
import assert from 'node:assert/strict';
import {buildInviteParentAuthorizer} from './inviteDeps';
import {buildPinParentAuthorizer} from './pinDeps';
for(const [name,build] of [['invite',buildInviteParentAuthorizer],['pin',buildPinParentAuthorizer]] as const){
 test(`${name}: readable records do not imply action authority`,async()=>{
  for(const [data,expected] of [[{checkInStatus:{child:{id:'p_jax'}}},false],[{canManageChild:false},false],[{canManageChild:true},true]] as const){
   const authorize=build({graphqlUrl:'http://local.invalid/graphql',fetchFn:async(_url,init)=>{
    const request=JSON.parse(String(init?.body));assert.match(request.query,/canManageChild/);assert.equal(request.variables.c,'p_jax');
    return new Response(JSON.stringify({data}),{status:200});
   }});
   assert.equal(await authorize({childId:'p_jax',personId:'p_demo_guide',bearer:'test-only'}),expected);
  }
 });
}
