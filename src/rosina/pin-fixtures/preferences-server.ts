// Loopback-only HTTP proof server. Uses the production handler against disposable Postgres.
import express from 'express';
import {createPinPreferencesHandler} from '../pinPreferences';
import {preferencesFixture} from './preferences';
const fixture=await preferencesFixture();
await fixture.apply();
const app=express();app.use(express.json({limit:'64kb'}));
const handler=createPinPreferencesHandler({
 verify:async(header?:string)=>{
  const person=(header??'').replace(/^Bearer /,'');
  return ['p_mom','p_dad','p_reader','p_outside'].includes(person)
   ?{ok:true,personId:person,sub:'fixture',demo:true,demoGuide:false}
   :{ok:false,reason:'invalid'};
 },
 rpc:async(bearer,name,args)=>{
  try{
   const keys=Object.keys(args);
   const result=await fixture.as(bearer,`select ${name}(${keys.map((key,i)=>`${key}=>$${i+1}`).join(',')}) as result`,Object.values(args));
   return {data:result.rows[0].result,error:null};
  }catch(error){return {data:null,error:{code:(error as {code?:string}).code}}}
 },
});
app.get('/api/rosina/pin/preferences',handler);app.post('/api/rosina/pin/preferences',handler);
const server=app.listen(5197,'127.0.0.1',()=>console.log('Disposable Fridge preference API: http://127.0.0.1:5197'));
async function close(){server.close();await fixture.close();process.exit()}
process.once('SIGINT',()=>void close());process.once('SIGTERM',()=>void close());
