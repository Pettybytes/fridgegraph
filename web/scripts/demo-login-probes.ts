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
