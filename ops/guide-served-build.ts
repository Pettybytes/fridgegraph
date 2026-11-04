/** CI harness: production web build + production resolvers + disposable PostgreSQL RLS.
 * Only the session issuer and PostgREST transport are replaced. No external services or credentials.
 */
import express from 'express';
import {createDiscoverySweeper} from '../src/village/discoverySweeper';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { buildASTSchema, graphql, Kind, type DocumentNode, type DefinitionNode } from 'graphql';
import { guideDatabase, insertRows } from './guide-database.mjs';
import { DEMO_PERSONAS } from '../src/demo/personas';
import { createFridgeSeed } from '../src/fixtures-fridge';
import { resetSnapshot } from '../src/demo/reset';
import { createDemoHistory } from '../src/fixtures-demo-history';
import { createSimulatedOrbit, createSimulatedPrivate, createSimulatedCoordination, createSimulatedCalendar, createSimulatedCheckIn, createSimulatedCareFacts } from '../src/fixtures-simulated';
import village from '../src/subgraphs/village';
import access from '../src/subgraphs/access';
import coordination from '../src/subgraphs/coordination';
import schedule from '../src/subgraphs/schedule';
import school from '../src/subgraphs/school';
import transport from '../src/subgraphs/transport';
import activities from '../src/subgraphs/activities';
import { showcaseSnapshot } from '../src/demo/reset';
import { createPinPreferencesHandler } from '../src/rosina/pinPreferences';
import {createPinHandlers,createInMemoryMediaStore} from '../src/rosina/pinEndpoint';
import {createFixturePinExtractor} from '../src/rosina/pinVision';
import {createFridgeNotePinStore} from '../src/rosina/pinPersistence';
import {createNoticePlanHandlers} from '../src/rosina/noticeEndpoint';
import {buildScheduleReader,buildPickupRequester} from '../src/rosina/noticeDeps';
import {createRateLimiter} from '../src/rosina/rateLimit';
import {runTestOutreach} from '../src/demo/testOutreach';
import {createInviteHandler} from '../src/rosina/inviteEndpoint';
import {buildInviteParentAuthorizer} from '../src/rosina/inviteDeps';
import {createFixtureImageGenerator} from '../src/rosina/inviteImage';
import {createInviteRateLimiter} from '../src/rosina/inviteBudget';
import {createInviteDedup} from '../src/rosina/inviteDedup';
// PostgREST returns SQL dates as YYYY-MM-DD strings, not JavaScript Date objects.
pg.types.setTypeParser(1082, value => value);
pg.types.setTypeParser(1114,value=>value.replace(' ','T'));
pg.types.setTypeParser(1184,value=>new Date(value).toISOString());
const port=Number(process.env.GUIDE_PORT??5196);
const baseUrl=`http://127.0.0.1:${port}`;
const db = await guideDatabase();
process.once('uncaughtException',async error=>{console.error(error.message);await db.close();process.exit(1)});
process.once('unhandledRejection',async error=>{console.error(error);await db.close();process.exit(1)});
for (const source of [createSimulatedPrivate(),createSimulatedCalendar(),createSimulatedCheckIn(),createSimulatedCareFacts(),createDemoHistory(),createSimulatedCoordination(),createFridgeSeed()]) {
 for (const [table, rows] of Object.entries(source)) if (Array.isArray(rows)) await insertRows(db.admin,table,rows);
}
const snapshot = resetSnapshot();
await db.admin.query('select restore_demo_snapshot($1,$2,$3,$4)', ['served-calendar', randomUUID(), JSON.stringify(snapshot.fixtures), JSON.stringify(snapshot.cast)]);
await insertRows(db.admin,'household_policies',createSimulatedOrbit().household_policies);
await db.admin.query('select seed_recorded_places(); select seed_event_place_links()');
const ids = new Map<string,string>();
for (const persona of DEMO_PERSONAS) {
 const id=randomUUID();ids.set(persona.id,id);
 await db.admin.query('insert into identity_map(user_id,person_id) values($1,$2) on conflict do nothing',[id,persona.personId]);
}
// Merge the federated type fields for a single-process test executor; resolver bodies are unchanged.
const definitions = new Map<string, any>(), resolvers: Record<string,Record<string,any>> = {};
for(const graph of [village,access,coordination,schedule,school,transport,activities]) {
 for(const definition of graph.typeDefs.definitions as any[]) {
  if(!definition.name||definition.kind===Kind.DIRECTIVE_DEFINITION)continue;
  const name=definition.name.value, clean={...definition,directives:[],fields:definition.fields?.map((f:any)=>({...f,directives:[]}))};
  const prior=definitions.get(name);
  if(prior?.fields&&clean.fields)prior.fields=[...new Map([...prior.fields,...clean.fields].map(f=>[f.name.value,f])).values()];
  else if(!prior)definitions.set(name,clean);
 }
 for(const [name,fields] of Object.entries(graph.resolvers)) resolvers[name]={...resolvers[name],...fields};
}
const schema=buildASTSchema({kind:Kind.DOCUMENT,definitions:[...definitions.values()] as DefinitionNode[]} as DocumentNode);
for(const [name,fields] of Object.entries(resolvers)){
 const type=schema.getType(name) as any;
 for(const [field,resolve] of Object.entries(fields)) if(type?.getFields?.()[field])type.getFields()[field].resolve=resolve;
}
const pool=new pg.Pool({...db.options,max:12});
const quoted=(name:string)=>{name=name.trim();if(!/^[a-z_][a-z_0-9]*$/i.test(name))throw Error('Invalid SQL identifier');return `"${name}"`};
async function withCaller<T>(persona:typeof DEMO_PERSONAS[number],run:(client:pg.PoolClient)=>Promise<T>){
 const client=await pool.connect();
 try {
  await client.query('begin');await client.query('set local role authenticated');
  await client.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:ids.get(persona.id),app_metadata:{demo:true,demo_guide:persona.id==='demo-guide'}})]);
  const result=await run(client);await client.query('commit');return result;
 }catch(error){await client.query('rollback');throw error}finally{client.release()}
}
function transportFor(client:pg.PoolClient){
 return {
  from(table:string){
   let columns='*',single=false,limit='',order='',operation='select',payload:Record<string,unknown>={};const predicates:string[]=[],values:unknown[]=[];
   const filter=(column:string,op:string,value:unknown)=>{values.push(value);predicates.push(`${quoted(column)} ${op} $${values.length}`);return q};
   const q:any={insert:(row:Record<string,unknown>)=>{operation='insert';payload=row;return q},upsert:(row:Record<string,unknown>)=>{operation='upsert';payload=row;return q},update:(row:Record<string,unknown>)=>{operation='update';payload=row;return q},delete:()=>{operation='delete';return q},select:(value='*')=>{columns=value==='*'?'*':value.split(',').map(quoted).join(',');return q},eq:(c:string,v:unknown)=>filter(c,'=',v),in:(c:string,v:unknown)=>filter(c,'= any(',v),not:(c:string,op:string,v:unknown)=>{if(op!=='is'||v!==null)throw Error('Unsupported test filter');predicates.push(`${quoted(c)} is not null`);return q},gte:(c:string,v:unknown)=>filter(c,'>=',v),lte:(c:string,v:unknown)=>filter(c,'<=',v),order:(c:string,o?:{ascending?:boolean})=>{order=` order by ${quoted(c)} ${o?.ascending===false?'desc':'asc'}`;return q},limit:(n:number)=>{limit=` limit ${Number(n)}`;return q},maybeSingle:()=>{single=true;return q},single:()=>{single=true;return q},then:async(resolve:any,reject:any)=>{
    try{const where=predicates.map(p=>p.includes('= any(')?p+')':p).join(' and ');
     const suffix=where?' where '+where:'';let sql:string;
     if(operation==='select')sql=`select ${columns} from ${quoted(table)}${suffix}${order}${limit}`;
     else if(operation==='delete')sql=`delete from ${quoted(table)}${suffix} returning ${columns}`;
     else {
      const entries=Object.entries(payload),slots=entries.map(([,value])=>{values.push(value);return '$'+values.length});
      if(operation==='update')sql=`update ${quoted(table)} set ${entries.map(([key],i)=>`${quoted(key)}=${slots[i]}`).join(',')}${suffix} returning ${columns}`;
      else sql=`insert into ${quoted(table)} (${entries.map(([key])=>quoted(key)).join(',')}) values (${slots.join(',')})${operation==='upsert'?` on conflict (child_id) do update set ${entries.filter(([key])=>key!=='child_id').map(([key])=>`${quoted(key)}=excluded.${quoted(key)}`).join(',')}`:''} returning ${columns}`;
     }
     const result=await client.query(sql,values);return resolve({data:single?result.rows[0]??null:result.rows,error:null})}catch(error){return resolve({data:null,error})}
   }};return q;
  },
  async rpc(name:string,args:Record<string,unknown>={}){try{const result=await client.query(`select * from ${quoted(name)}(${Object.keys(args).map((key,i)=>`${quoted(key)} => $${i+1}`).join(',')})`,Object.values(args));const scalar=result.fields.length===1&&result.fields[0].name===name;return {data:scalar?result.rows[0]?.[name]:result.rows,error:null}}catch(error){return {data:null,error}}},
 };
}
const app=express();app.use(express.json({limit:'16mb'}));
const personaFor=(header?:string)=>DEMO_PERSONAS.find(p=>header===`Bearer fixture-${p.id}`);
app.get('/api/demo/health',(_req,res)=>res.json({personas:DEMO_PERSONAS.map(p=>({personaId:p.id,ready:true}))}));
app.get('/api/demo/families',(_req,res)=>res.json({families:[]}));
app.post('/api/demo/login',(req,res)=>{
 const p=DEMO_PERSONAS.find(p=>p.id===req.body.personaId);if(!p){res.sendStatus(401);return}
 res.json({status:'READY',personaId:p.id,personId:p.personId,persona:p,scope:{childId:p.childId,childName:p.childName,parentName:p.name,villageId:p.villageId},session:{access_token:`fixture-${p.id}`,token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600},marks:{demo:true,demoGuide:p.id==='demo-guide'}});
});
const resetRuns=new Map<string,{personaId:string;status:string;report?:unknown}>();
app.get('/api/demo/reset/:runId',(req,res)=>{
 const persona=personaFor(req.headers.authorization),run=resetRuns.get(req.params.runId);
 if(!persona||run?.personaId!==persona.id){res.sendStatus(404);return}
 res.json({...run,runId:req.params.runId,session:null});
});
app.post('/api/demo/reset',async(req,res)=>{
 const persona=personaFor(req.headers.authorization);if(persona?.id!=='demo-guide'){res.sendStatus(403);return}
 const runId=req.body.runId;
 resetRuns.set(runId,{personaId:persona.id,status:'running'});
 const result=await db.admin.query('select restore_showcase_snapshot($1,$2::uuid,$3::jsonb) as report',[persona.personId,runId,JSON.stringify(showcaseSnapshot())]);
 resetRuns.set(runId,{personaId:persona.id,status:'committed',report:result.rows[0].report});
 res.json({ok:true,runId,status:'committed',personaId:persona.id,session:null,report:result.rows[0].report});
});
app.post('/graphql',async(req,res)=>{
 const persona=personaFor(req.headers.authorization);if(!persona){res.sendStatus(401);return}
 const result=await withCaller(persona,client=>graphql({schema,source:req.body.query,variableValues:req.body.variables,operationName:req.body.operationName,contextValue:{callerId:persona.personId,demo:true,demoGuide:persona.id==='demo-guide',today:'2026-11-03',db:transportFor(client)}}));
 res.json(result);
});
app.all('/api/rosina/pin/preferences',createPinPreferencesHandler({
 verify:async header=>{const p=personaFor(header);return p?{ok:true,personId:p.personId,sub:ids.get(p.id)!,demo:true,demoGuide:p.id==='demo-guide'}:{ok:false,reason:'invalid'}},
 rpc:async(bearer,name,args)=>{const p=personaFor(`Bearer ${bearer}`);if(!p)return {data:null,error:{code:'42501'}};return withCaller(p,client=>transportFor(client).rpc(name,args)) as any},
}));
// External model/media dependencies are deterministic fixtures here. Production
// handlers, explicit graph authority, database persistence and rate limits are exercised.
const verify=async(header?:string)=>{const p=personaFor(header);return p?{ok:true as const,personId:p.personId,demoGuide:p.id==='demo-guide'}:{ok:false as const}};
const authorizeParent=buildInviteParentAuthorizer({graphqlUrl:`${baseUrl}/graphql`});
const media=createInMemoryMediaStore(),bytes=new Map<string,{bytes:Uint8Array;mimeType:string}>();
const mediaLoad=async(input:{assetId:string;personId:string;bearer:string})=>{
 const access=await media.access(input),body=bytes.get(input.assetId);
 return access.ok&&body?{...body,access:'PARENT'}:null;
};
const pin=createPinHandlers({verify,authorizeParent,
 media:{access:input=>media.access(input),put:async input=>{const result=await media.put(input);if(result.ok)bytes.set(result.assetId,{bytes:input.bytes,mimeType:input.mimeType});return result}},
 mediaLoad,extractor:createFixturePinExtractor({kind:'artwork',confidence:'high'}),
 signingKey:randomUUID(),readiness:()=>({ready:true,reasons:[]}),
 pinStore:createFridgeNotePinStore({writer:async(bearer,note)=>{
  const p=personaFor(`Bearer ${bearer}`);if(!p)throw Error('UNAUTHENTICATED');
  return withCaller(p,async client=>{
   const result=await client.query('insert into fridge_notes(id,child_id,author_id,text,audience,attachment_ref,sandbox) values($1,$2,$3,$4,$5,$6,true) on conflict(id) do nothing returning id',[note.id,note.childId,note.authorId,note.text,note.audience,note.attachmentRef]);
   return result.rows.length?'CREATED':'EXISTS';
  });
 }}),
});
app.get('/api/rosina/pin/readiness',pin.readiness);
app.post('/api/rosina/pin/upload',pin.upload);
app.post('/api/rosina/pin',pin.prepare);
app.post('/api/rosina/pin/confirm',pin.confirm);
app.get('/api/rosina/pin/media/:id',pin.download);
app.post('/api/rosina/invite',createInviteHandler({verify,authorizeParent,
 extractor:async()=>({childFirstName:'Nora',occasion:'Birthday party',date:'2026-11-15',startTime:'14:00',endTime:'16:00',placeLabel:'Maple Hall'}),
 image:createFixtureImageGenerator(),rateLimiter:createInviteRateLimiter(6),dedup:createInviteDedup(),source:'FIXTURE',
 ledgerBudget:new Proxy({} as any,{get:()=>()=>{throw Error('Fixture must never spend a live generation budget')}}),
}));
const notice=createNoticePlanHandlers({verify,rateLimiter:createRateLimiter(20),
 scheduleReader:buildScheduleReader({graphqlUrl:`${baseUrl}/graphql`}),
 requestPickup:buildPickupRequester({graphqlUrl:`${baseUrl}/graphql`}),
 signingKey:randomUUID(),scenarioDate:'2026-10-26',
 extractor:async({notice})=>({modelId:'fixture-no-model',processingSource:notice.kind==='text'?'text':'image',facts:[{
  kind:'early_dismissal',dates:['2026-10-26'],times:[{label:'dismissal',time:'12:30'}],appliesTo:'all students',
  ...(notice.kind==='text'?{quote:'early dismissal at 12:30 PM'}:{transcription:'Early dismissal at 12:30 PM on October 26, 2026',ref:'image'}),
 }]}),
});
app.post('/api/rosina/notice-plan',notice.prepare);
app.post('/api/rosina/notice-plan/confirm',notice.confirm);
app.post('/api/demo/test-outreach',async(req,res)=>{
 const persona=personaFor(req.headers.authorization);if(!persona){res.sendStatus(401);return}
 const result=await runTestOutreach({replyDelayMs:50,
  authorizeChild:childId=>withCaller(persona,async client=>(await client.query('select is_parent_of($1) as allowed',[childId])).rows[0].allowed),
  service:async(path,init)=>{
   const url=new URL(path,'http://local.invalid'),table=url.pathname.split('/').at(-1)!;
   let data:unknown;
   if(url.pathname.includes('/rpc/')){
    if(table!=='accept_pickup_webhook')throw Error('Unsupported fixture RPC');
    const args=JSON.parse(String(init?.body));
    data=await db.admin.query(`select ${quoted(table)}(${Object.keys(args).map((key,i)=>`${quoted(key)} => $${i+1}`).join(',')})`,Object.values(args));
   }else if(init?.method==='POST'){
    if(table!=='attempts')throw Error('Unsupported fixture write');
    await insertRows(db.admin,table,JSON.parse(String(init.body)));data=[];
   }else{
    if(!['coordination_jobs','attempts','candidate_evaluations','vehicles'].includes(table))throw Error('Unsupported fixture table');
    const columns=(url.searchParams.get('select')??'*').split(',').map(quoted).join(','),conditions:string[]=[],values:unknown[]=[];
    for(const [key,value] of url.searchParams){
     if(key==='select')continue;
     if(value==='is.null'){conditions.push(`${quoted(key)} is null`);continue}
     if(value.startsWith('eq.')){values.push(value.slice(3));conditions.push(`${quoted(key)}=$${values.length}`)}
     else if(value.startsWith('in.(')){values.push(JSON.parse('['+value.slice(4,-1)+']'));conditions.push(`${quoted(key)}=any($${values.length})`)}
     else throw Error('Unsupported fixture filter');
    }
    data=(await db.admin.query(`select ${columns} from ${quoted(table)} where ${conditions.join(' and ')}`,values)).rows;
   }
   return new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
  },
 },persona.personId,req.body.jobId);
 res.status(result.status).json(result.body);
});
app.use(express.static('web/dist'));
const sweeper=createDiscoverySweeper({
 listExpired:async limit=>(await db.admin.query("select id from coordination_jobs where status='discovering' and created_at+make_interval(secs=>discovery_timeout_seconds)<=now() order by created_at limit $1",[limit])).rows.map(row=>row.id),
 close:async id=>{await db.admin.query('select close_discovery($1)',[id])},
 log:console.error,
},{intervalMs:1000});
sweeper.start();
const server=app.listen(port,'127.0.0.1',()=>console.log(`Guide served build ready at http://127.0.0.1:${port}`));
async function close(){sweeper.stop();server.close();await pool.end();await db.close();process.exit(0)}
process.once('SIGTERM',close);process.once('SIGINT',close);
