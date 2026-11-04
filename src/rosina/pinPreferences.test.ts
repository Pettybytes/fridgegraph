import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Request,Response} from 'express';
import {createPinPreferencesHandler} from './pinPreferences';
const parent={ok:true as const,personId:'p_mom',sub:'fixture',demo:true,demoGuide:false};
async function call(body:unknown,options:{identity?:typeof parent|{ok:false;reason:'invalid'};error?:{code:string};method?:string}={}){
 const calls:unknown[]=[];let status=200,result:unknown;
 const handler=createPinPreferencesHandler({verify:async()=>options.identity??parent,rpc:async(bearer,name,args)=>{calls.push({bearer,name,args});return {data:[],error:options.error??null}}});
 const req={method:options.method??'POST',body,query:body,header:()=> 'Bearer fixture-caller'} as unknown as Request;
 const res={setHeader(){},status(value:number){status=value;return this},json(value:unknown){result=value;return this}} as unknown as Response;
 await handler(req,res);return {status,result,calls};
}
test('preferences require a verified caller and refuse demo guides before database access',async()=>{
 for(const identity of [{ok:false as const,reason:'invalid' as const},{...parent,demoGuide:true}]){
  const result=await call({childId:'p_nora'},{identity});assert.equal(result.status,identity.ok?403:401);assert.equal(result.calls.length,0);
 }
});
test('preference writes forward only the caller bearer and bounded RPC fields',async()=>{
 const result=await call({childId:'p_nora',kind:'goal',itemId:'goal_fixture',color:'blue',personId:'p_outside'});
 assert.equal(result.status,200);assert.deepEqual(result.calls,[{bearer:'fixture-caller',name:'save_fridge_preference',args:{p_child:'p_nora',p_kind:'goal',p_item:'goal_fixture',p_position:null,p_color:'blue',p_font:null,p_tidy:false}}]);
});
test('missing child and invalid item kind never reach the database',async()=>{
 for(const body of [{},{childId:'p_nora',kind:'anything',itemId:'x'}]){const result=await call(body);assert.equal(result.status,400);assert.equal(result.calls.length,0)}
});
test('database authorization and unavailable migration errors never report a save',async()=>{
 for(const [code,status] of [['42501',403],['PGRST202',503],['23514',400]] as const){const result=await call({childId:'p_nora',tidy:true},{error:{code}});assert.equal(result.status,status);assert.ok((result.result as {error:string}).error)}
});
test('reads use a separate read-only RPC',async()=>{
 const result=await call({childId:'p_nora'},{method:'GET'});assert.deepEqual(result.calls,[{bearer:'fixture-caller',name:'read_fridge_preferences',args:{p_child:'p_nora'}}]);
});
