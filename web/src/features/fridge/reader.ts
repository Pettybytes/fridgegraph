import {gql,type ApolloClient} from '@apollo/client'
import type {OrbitController} from '../orbit/controller'
import type {FridgeReader,Goal,Slot,Source} from './model'
const queries={goals:gql`query FridgeGoals($childId:ID!){goals(childId:$childId){id title horizon status}}`,care:gql`query FridgeCare($childId:ID!){carePlan(childId:$childId){text}}`}
// Orbit is supplied by the existing controller, which owns authorization, polling and closure.
// No alert photos, descriptors, location, or audience are copied into this feature.
export function createFridgeReader(client:ApolloClient,runRead:<T>(fn:()=>Promise<T>)=>Promise<T>,orbit:OrbitController|null):FridgeReader{
 return {subscribe:orbit?.subscribe,async read(source:Source,childId,signal){try{
  if(source==='orbit'){
   if(!orbit||!orbit.current()||orbit.scope.childId!==childId)return {status:'failed'}
   const state=orbit.getSnapshot()
   if(state.phase==='loading')return {status:'loading'}
   if(state.error)return {status:state.error.includes("isn't shared")?'refused':'failed'}
   return state.alert?.status==='ACTIVE'?{status:'ready',value:[{id:`orbit-${state.alert.id}`,kind:'note',text:'Open Orbit Alert',caption:'Source: Orbit',position:{x:.215,y:.46,width:.105,rotation:-3},owner:null,source:'live',paper:1,destination:`#/orbit?alertId=${encodeURIComponent(state.alert.id)}`} satisfies Slot]}:{status:'empty'}
  }
  const result=await runRead(()=>client.query<{goals?:Goal[];carePlan?:{text:string}|null}>({query:queries[source],variables:{childId},fetchPolicy:'no-cache',context:{fetchOptions:{signal}}}))
  if(!result.data)throw Error('UNAVAILABLE')
  if(source==='goals'){if(!result.data.goals)throw Error('UNAVAILABLE');return result.data.goals.length?{status:'ready',value:result.data.goals}:{status:'empty'}}
  if(result.data.carePlan===undefined)throw Error('UNAVAILABLE')
  return result.data.carePlan?{status:'ready',value:[{id:'care-plan',kind:'note',text:result.data.carePlan.text,caption:'Source: care plan',position:{x:.215,y:.26,width:.12,rotation:-3},owner:null,source:'live',paper:0,destination:'#/care-information'} satisfies Slot]}:{status:'empty'}
 }catch(error){if(signal.aborted)throw error;const e=error as {message?:string;errors?:{extensions?:{code?:string}}[]};return {status:/UNAUTHORIZED|UNAUTHENTICATED|FORBIDDEN/.test([e.message,...(e.errors??[]).map(x=>x.extensions?.code)].join(' '))?'refused':'failed'}}}}
}
