import {gql} from '@apollo/client'
import {createGraphqlAdapter,JOBS} from './graphqlAdapter'
import type {JobRead} from './graphqlAdapter'
import type {createGraphClient} from './graphqlAdapter'
import type {FrontendAdapter,Scope,MissionControlData} from './types'
export const STORED_ATTEMPTS=gql`query WebStoredAttempts($jobId:ID!){attempts(jobId:$jobId){id channel at candidate{id displayName} destinationMode closedAt closedReason}}`
export const STORED_TIMELINE=gql`query WebStoredTimeline($jobId:ID!){jobTimeline(jobId:$jobId){at kind attemptId candidate{id displayName} detail}}`
export type StoredAttempt={id:string;channel:string;at:string;candidate:{id:string;displayName:string}|null;destinationMode:'TEST_RESPONDER'|'REAL_CONSENTED';closedAt:string|null;closedReason:string|null}
export type StoredMoment={at:string;kind:string;attemptId:string|null;candidate:{id:string;displayName:string}|null;detail:string|null}
export type StoredRun={job:JobRead;attempts:StoredAttempt[];timeline:StoredMoment[]}
export type StoredMissionControl=MissionControlData&{recordedRuns:StoredRun[]}
export function createDeliveredAdapter(client:ReturnType<typeof createGraphClient>,runRead:<T>(read:()=>Promise<T>)=>Promise<T>):FrontendAdapter{
 const base=createGraphqlAdapter(client)
 async function read<T>(query:Parameters<typeof client.query>[0]['query'],variables:Record<string,string>):Promise<T>{
  return runRead(async()=>{const result=await client.query<T>({query,variables,fetchPolicy:'no-cache'});if(!result.data)throw new Error('READ_UNAVAILABLE');return result.data})
 }
 return {...base,
  async clearStore(){client.stop();await client.clearStore()},
  readVillage:scope=>runRead(()=>base.readVillage(scope)),
  async readMissionControl(scope:Scope):Promise<StoredMissionControl>{
   const data=await read<{coordinationJobs:JobRead[]}>(JOBS,{childId:scope.childId})
   const recordedRuns=await Promise.all(data.coordinationJobs.map(async job=>{
    const [attempts,timeline]=await Promise.all([read<{attempts:StoredAttempt[]}>(STORED_ATTEMPTS,{jobId:job.id}),read<{jobTimeline:StoredMoment[]}>(STORED_TIMELINE,{jobId:job.id})])
    return {job,attempts:attempts.attempts,timeline:[...timeline.jobTimeline].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at))}
   }))
   return {provenance:'live',recordedRuns,candidates:[],events:[],coordinationJobs:data.coordinationJobs,confirmations:data.coordinationJobs.flatMap(j=>j.confirmation?[j.confirmation]:[])}
  },
 }
}
