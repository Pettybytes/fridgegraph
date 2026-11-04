/** CI harness: production web build + production resolvers + disposable PostgreSQL RLS.
 * Only the session issuer and PostgREST transport are replaced. No external services or credentials.
 */
import express from 'express';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { buildASTSchema, graphql, Kind, type DocumentNode, type DefinitionNode } from 'graphql';
import { guideDatabase, insertRows } from './guide-database.mjs';
import { DEMO_PERSONAS } from '../src/demo/personas';
import { createFridgeSeed } from '../src/fixtures-fridge';
import { createDemoHistory } from '../src/fixtures-demo-history';
import { createSimulatedPrivate, createSimulatedCoordination, createSimulatedCalendar, createSimulatedCheckIn, createSimulatedCareFacts } from '../src/fixtures-simulated';
import village from '../src/subgraphs/village';
import access from '../src/subgraphs/access';
import coordination from '../src/subgraphs/coordination';
import schedule from '../src/subgraphs/schedule';
import school from '../src/subgraphs/school';
import transport from '../src/subgraphs/transport';
import activities from '../src/subgraphs/activities';
import { createPinPreferencesHandler } from '../src/rosina/pinPreferences';
// PostgREST returns SQL dates as YYYY-MM-DD strings, not JavaScript Date objects.
pg.types.setTypeParser(1082, value => value);
const db = await guideDatabase();
process.once('uncaughtException',async error=>{console.error(error.message);await db.close();process.exit(1)});
process.once('unhandledRejection',async error=>{console.error(error);await db.close();process.exit(1)});
for (const source of [createSimulatedPrivate(),createSimulatedCalendar(),createSimulatedCheckIn(),createSimulatedCareFacts(),createDemoHistory(),createSimulatedCoordination(),createFridgeSeed()]) {
 for (const [table, rows] of Object.entries(source)) if (Array.isArray(rows)) await insertRows(db.admin,table,rows);
}
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
  return await run(client);
 }finally{await client.query('rollback');client.release()}
}
function transportFor(client:pg.PoolClient){
 return {
  from(table:string){
   let columns='*',single=false,limit='',order='';const predicates:string[]=[],values:unknown[]=[];
   const filter=(column:string,op:string,value:unknown)=>{values.push(value);predicates.push(`${quoted(column)} ${op} $${values.length}`);return q};
   const q:any={select:(value='*')=>{columns=value==='*'?'*':value.split(',').map(quoted).join(',');return q},eq:(c:string,v:unknown)=>filter(c,'=',v),in:(c:string,v:unknown)=>filter(c,'= any(',v),not:(c:string,op:string,v:unknown)=>{if(op!=='is'||v!==null)throw Error('Unsupported test filter');predicates.push(`${quoted(c)} is not null`);return q},gte:(c:string,v:unknown)=>filter(c,'>=',v),lte:(c:string,v:unknown)=>filter(c,'<=',v),order:(c:string,o?:{ascending?:boolean})=>{order=` order by ${quoted(c)} ${o?.ascending===false?'desc':'asc'}`;return q},limit:(n:number)=>{limit=` limit ${Number(n)}`;return q},maybeSingle:()=>{single=true;return q},single:()=>{single=true;return q},then:async(resolve:any,reject:any)=>{
    try{const where=predicates.map(p=>p.includes('= any(')?p+')':p).join(' and ');const result=await client.query(`select ${columns} from ${quoted(table)}${where?' where '+where:''}${order}${limit}`,values);return resolve({data:single?result.rows[0]??null:result.rows,error:null})}catch(error){return resolve({data:null,error})}
   }};return q;
  },
  async rpc(name:string,args:Record<string,unknown>={}){try{const result=await client.query(`select * from ${quoted(name)}(${Object.keys(args).map((key,i)=>`${quoted(key)} => $${i+1}`).join(',')})`,Object.values(args));const scalar=result.fields.length===1&&result.fields[0].name===name;return {data:scalar?result.rows[0]?.[name]:result.rows,error:null}}catch(error){return {data:null,error}}},
 };
}
const app=express();app.use(express.json());
const personaFor=(header?:string)=>DEMO_PERSONAS.find(p=>header===`Bearer fixture-${p.id}`);
app.get('/api/demo/health',(_req,res)=>res.json({personas:DEMO_PERSONAS.map(p=>({personaId:p.id,ready:true}))}));
app.get('/api/demo/families',(_req,res)=>res.json({families:[]}));
app.post('/api/demo/login',(req,res)=>{
 const p=DEMO_PERSONAS.find(p=>p.id===req.body.personaId);if(!p){res.sendStatus(401);return}
 res.json({status:'READY',personaId:p.id,personId:p.personId,persona:p,scope:{childId:p.childId,childName:p.childName,parentName:p.name,villageId:p.villageId},session:{access_token:`fixture-${p.id}`,token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600},marks:{demo:true,demoGuide:p.id==='demo-guide'}});
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
app.use(express.static('web/dist'));
const server=app.listen(5196,'127.0.0.1',()=>console.log('Guide served build ready at http://127.0.0.1:5196'));
async function close(){server.close();await pool.end();await db.close();process.exit(0)}
process.once('SIGTERM',close);process.once('SIGINT',close);
