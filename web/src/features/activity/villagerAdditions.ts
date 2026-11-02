import {gql} from '@apollo/client'
import type {createGraphClient} from '@/lib/frontendData/graphqlAdapter'
export type VillagerAddition={id:string;person:{id:string;displayName:string};addedBy:{id:string};relationshipType:string;scopes:string[];confirmedAt:string}
const QUERY=gql`query WebActivityVillagerAdditions($childId:ID!){villagerAdditions(childId:$childId){id person{id displayName} addedBy{id} relationshipType scopes confirmedAt}}`
/** `villagerAdditions` is a brand-new field (not yet deployed everywhere this code ships) — same
 * class of schema-drift tolerance as schoolReports.ts's reportedAt fallback, except here there is
 * no narrower query to fall back to: until the field is live, this degrades to an empty list
 * rather than breaking the rest of Activity. */
export function isMissingVillagerAdditions(error:unknown){
 const failure=error as {bodyText?:string;errors?:unknown;result?:unknown;cause?:unknown}|null
 const details=[String(error),failure?.bodyText,JSON.stringify(failure?.errors),JSON.stringify(failure?.result),String(failure?.cause)].join(' ').replaceAll('\\\"','"')
 return /Cannot query field ["']villagerAdditions["']/.test(details)
}
export async function readVillagerAdditions(client:ReturnType<typeof createGraphClient>,childId:string,runRead:<T>(read:()=>Promise<T>)=>Promise<T>):Promise<VillagerAddition[]>{
 try{
  return await runRead(async()=>{
   const result=await client.query<{villagerAdditions:VillagerAddition[]}>({query:QUERY,variables:{childId},fetchPolicy:'no-cache'})
   if(!result.data||!Array.isArray(result.data.villagerAdditions))throw Error('VILLAGER_ADDITIONS_UNAVAILABLE')
   return result.data.villagerAdditions
  })
 }catch(error){if(isMissingVillagerAdditions(error))return [];throw error}
}
