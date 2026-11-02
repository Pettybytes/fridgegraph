import {gql,type ApolloClient} from '@apollo/client'
import {notePositions} from './model'
import type {FridgeReader,Goal,Slot,Source} from './model'
const queries={goals:gql`query FridgeGoals($childId:ID!){goals(childId:$childId){id title horizon status}}`,care:gql`query FridgeCare($childId:ID!){carePlan(childId:$childId){text}}`}
// Each source is an independent caller-authorized read; decorative art is never queried.
export function createFridgeReader(client:ApolloClient,runRead:<T>(fn:()=>Promise<T>)=>Promise<T>):FridgeReader{
 return {async read(source:Source,childId,signal){try{
  const result=await runRead(()=>client.query<{goals?:Goal[];carePlan?:{text:string}|null}>({query:queries[source],variables:{childId},fetchPolicy:'no-cache',context:{fetchOptions:{signal}}}))
  if(!result.data)throw Error('UNAVAILABLE')
  if(source==='goals'){if(!result.data.goals)throw Error('UNAVAILABLE');return result.data.goals.length?{status:'ready',value:result.data.goals}:{status:'empty'}}
  if(result.data.carePlan===undefined)throw Error('UNAVAILABLE')
  return result.data.carePlan?{status:'ready',value:[{id:'care-plan',kind:'note',text:result.data.carePlan.text,caption:'Source: care plan',heading:'Care notes',position:notePositions.care,owner:null,source:'live',paper:0,magnet:'apple',destination:'#/care-information'} satisfies Slot]}:{status:'empty'}
 }catch(error){if(signal.aborted)throw error;const e=error as {message?:string;errors?:{extensions?:{code?:string}}[]};return {status:/UNAUTHORIZED|UNAUTHENTICATED|FORBIDDEN/.test([e.message,...(e.errors??[]).map(x=>x.extensions?.code)].join(' '))?'refused':'failed'}}}}
}
