// Local browser smoke only. Not imported by the application or production build.
import {gql} from '@apollo/client'
import {createGraphClient,JOBS} from '../src/lib/frontendData/graphqlAdapter'
import {STORED_TIMELINE,STORED_ATTEMPTS} from '../src/lib/frontendData/deliveredAdapter'
import {dataErrorMessage} from '../src/lib/frontendData/provider'
export async function inspect(token:string,childId:string,otherId:string){
 const client=createGraphClient(async()=>token)
 const query=async(document:ReturnType<typeof gql>,variables:Record<string,string>)=>{
  try{const result=await client.query({query:document,variables,fetchPolicy:'no-cache'});return {ok:true,data:result.data}}
  catch(error){return {ok:false,refused:/UNAUTHORIZED/.test((error as Error).message)}}
 }
 const children=gql`query ProbeChild($id:ID!){child(id:$id){person{id displayName}}}`
 const households=gql`query ProbeHousehold($childId:ID!){householdMembers(childId:$childId){person{id displayName} household{id} role}}`
 const candidates=gql`query ProbeCandidates($childId:ID!){pickupCandidates(childId:$childId){person{id displayName} authorization availability}}`
 const own=await query(children,{id:childId}),foreign=await query(children,{id:otherId})
 const household=await query(households,{childId}),foreignHousehold=await query(households,{childId:otherId})
 const pickup=await query(candidates,{childId}),foreignPickup=await query(candidates,{childId:otherId})
 const scheduleDoc=gql`query ProbeSchedule($childId:ID!){events(childId:$childId,date:"2026-10-30"){id}}`
 const careDoc=gql`query ProbeCare($childId:ID!){carePlan(childId:$childId){child{id}}}`
 const goalsDoc=gql`query ProbeGoals($childId:ID!){goals(childId:$childId){id status}}`
 const schedule=await query(scheduleDoc,{childId}),care=await query(careDoc,{childId}),goals=await query(goalsDoc,{childId})
 const foreignSchedule=await query(scheduleDoc,{childId:otherId}),foreignCare=await query(careDoc,{childId:otherId}),foreignGoals=await query(goalsDoc,{childId:otherId})
 const jobs=await query(JOBS,{childId})
 const runs=[]
 for(const job of (jobs.data as {coordinationJobs?:{id:string}[]})?.coordinationJobs??[]){
  const timeline=await query(STORED_TIMELINE,{jobId:job.id}),attempts=await query(STORED_ATTEMPTS,{jobId:job.id});runs.push({job,timeline,attempts})
 }
 client.stop()
 return {own,foreign,household,foreignHousehold,pickup,foreignPickup,schedule,care,goals,foreignSchedule,foreignCare,foreignGoals,jobs,runs}
}
// This probe executes only after a visible confirm click, only with guide credentials.
export async function confirmGuideRefusal(token:string){
 const client=createGraphClient(async()=>token)
 try{await client.mutate({mutation:gql`mutation GuideRefusalProbe{approvePickup(jobId:"local-read-only-refusal-probe",version:1,decision:APPROVED){id}}`});return 'FAIL: write unexpectedly accepted'}
 catch(error){return dataErrorMessage(error as Error)}finally{client.stop()}
}
export async function inspectStoredJob(token:string,jobId:string|null){
 const client=createGraphClient(async()=>token)
 try{
  const jobs=await client.query<{coordinationJobs:{id:string}[]}>({query:JOBS,variables:{childId:'p_nora'},fetchPolicy:'no-cache'})
  const ids=jobs.data?.coordinationJobs.map(j=>j.id)??[]
  if(!jobId)return {ids,timelineCount:0,attemptCount:0}
  const timeline=await client.query<{jobTimeline:unknown[]}>({query:STORED_TIMELINE,variables:{jobId},fetchPolicy:'no-cache'})
  const attempts=await client.query<{attempts:unknown[]}>({query:STORED_ATTEMPTS,variables:{jobId},fetchPolicy:'no-cache'})
  return {ids,timelineCount:timeline.data?.jobTimeline.length??0,attemptCount:attempts.data?.attempts.length??0}
 }finally{client.stop()}
}
import {CHILD_EVENTS,EFFECTIVE_SCHEDULE,SCHEDULE_CONFLICTS,ADULT_AVAILABILITY} from '../src/features/calendar/liveAdapter'
export async function inspectGroup3(token:string,childId:string,otherId:string,personId:string){
 const client=createGraphClient(async()=>token)
 const read=async(query:ReturnType<typeof gql>,variables:Record<string,string|boolean>)=>{try{const result=await client.query({query,variables,fetchPolicy:'no-cache'});return {outcome:'ready',data:result.data}}catch(error){const e=error as {message?:string;errors?:{extensions?:{code?:string}}[]};return {outcome:/UNAUTHORIZED/.test(e.message??'')||e.errors?.some(x=>x.extensions?.code==='UNAUTHORIZED')?'refused':'failed'}}}
 const from='2026-11-23',to='2026-11-29'
 try{
  const own=await read(CHILD_EVENTS,{childId,from,to,includeCancelled:false})
  const daily=[];for(const date of ['2026-11-24','2026-11-25','2026-11-26','2026-11-27','2026-11-28'])daily.push({date,...await read(EFFECTIVE_SCHEDULE,{childId,date})})
  const conflicts=await read(SCHEDULE_CONFLICTS,{childId,from,to})
  const adults=await read(ADULT_AVAILABILITY,{personId,from,to})
  const defaults=await read(CHILD_EVENTS,{childId,from:'2026-11-16',to:'2026-11-22',includeCancelled:false}),cancelled=await read(CHILD_EVENTS,{childId,from:'2026-11-16',to:'2026-11-22',includeCancelled:true})
  const boundaries=[];for(const id of [otherId,'not-a-child','!malformed'])boundaries.push({events:await read(CHILD_EVENTS,{childId:id,from,to,includeCancelled:false}),care:await read(EFFECTIVE_SCHEDULE,{childId:id,date:'2026-11-26'}),conflicts:await read(SCHEDULE_CONFLICTS,{childId:id,from,to})})
  const unavailableAdults=[];for(const id of ['fx_audit_parent','not-a-person','!malformed'])unavailableAdults.push(await read(ADULT_AVAILABILITY,{personId:id,from,to}))
  return {own,daily,conflicts,adults,defaults,cancelled,boundaries,unavailableAdults}
 }finally{client.stop()}
}
