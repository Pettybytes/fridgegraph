import {gql} from '@apollo/client'
import type {createGraphClient} from '@/lib/frontendData/graphqlAdapter'
export type SchoolReport={id:string;kind:string;text:string;at:string;reportedAt?:string|null}
const WITH_TIME=gql`query WebActivitySchoolReportsWithTime($childId:ID!){schoolReports(childId:$childId){id kind text at reportedAt}}`
const DATE_ONLY=gql`query WebActivitySchoolReportsDateOnly($childId:ID!){schoolReports(childId:$childId){id kind text at}}`
export function isMissingReportedAt(error:unknown){
 const failure=error as {bodyText?:string;errors?:unknown;result?:unknown;cause?:unknown}|null
 const details=[String(error),failure?.bodyText,JSON.stringify(failure?.errors),JSON.stringify(failure?.result),String(failure?.cause)].join(' ').replaceAll('\\\"','"')
 return /Cannot query field ["']reportedAt["'] on type ["']SchoolReport["']/.test(details)
}
export async function readSchoolReports(client:ReturnType<typeof createGraphClient>,childId:string,runRead:<T>(read:()=>Promise<T>)=>Promise<T>):Promise<SchoolReport[]>{
 const read=(query:typeof WITH_TIME)=>runRead(async()=>{
  const result=await client.query<{schoolReports:SchoolReport[]}>({query,variables:{childId},fetchPolicy:'no-cache'})
  if(!result.data||!Array.isArray(result.data.schoolReports))throw Error('SCHOOL_REPORTS_UNAVAILABLE')
  return result.data.schoolReports
 })
 try{return await read(WITH_TIME)}catch(error){if(!isMissingReportedAt(error))throw error;return read(DATE_ONLY)}
}
