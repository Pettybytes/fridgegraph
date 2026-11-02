import {gql,type ApolloClient} from '@apollo/client'
import {addDays,localDay,validDay} from '@/features/calendar/time'
import type {MapSession} from './liveAdapter'
import type {MapEvent,MapPerson,MapWorld,Place,Point,StoredRideEstimate} from './types'

// These selections match the merged #112 villageWorld and #78 pickupRideEstimate schemas.
// No contacts, capabilities, inferred presence, route geometry or pricing formula is requested.
export const VILLAGE_WORLD=gql`query WebMapVillageWorld($childId: ID!, $asOf: String) {
  villageWorld(childId: $childId, asOf: $asOf) {
    child { id }
    people { person { id displayName } relationship homePlaceId areaLabel scheduledEventId scheduledPlaceId }
    places { id label kind lat lng coordinateState }
    events { id title start end status placeId placeState personIds }
  }
}`
export const PICKUP_JOBS=gql`query WebMapPickupJobs($childId: ID!) {
  coordinationJobs(childId: $childId) {
    id candidateEvaluations { candidate { id displayName } estimatedRideCostUsd }
  }
}`
export const PICKUP_RIDE=gql`query WebMapPickupRide($jobId: ID!, $candidateId: ID!) {
  pickupRideEstimate(jobId: $jobId, candidateId: $candidateId) {
    jobId candidateId estimatedRideCostUsd costBasis distanceMiles householdCapUsd paidRidePath
  }
}`

type WorldWire={
 child:{id:string}
 people:Array<{person:{id:string;displayName:string};relationship:string|null;homePlaceId:string|null;areaLabel:string|null;scheduledEventId:string|null;scheduledPlaceId:string|null}>
 places:Array<{id:string;label:string|null;kind:string;lat:number|null;lng:number|null;coordinateState:'SET'|'WITHHELD'|'NOT_RECORDED'}>
 events:Array<{id:string;title:string;start:string;end:string|null;status:string|null;placeId:string|null;placeState:'LINKED'|'UNLINKED'|'WITHHELD';personIds:string[]}>
}
type JobsWire={coordinationJobs:Array<{id:string;candidateEvaluations:Array<{candidate:{id:string;displayName:string};estimatedRideCostUsd:number|null}>}>}
type RideWire={pickupRideEstimate:{jobId:string;candidateId:string;estimatedRideCostUsd:number|null;costBasis:string|null;distanceMiles:number|null;householdCapUsd:number|null;paidRidePath:boolean}|null}
type Read=<T>(query:ReturnType<typeof gql>,variables:Record<string,string>,signal:AbortSignal)=>Promise<T>
const noLocation='No location provided for this person in this map'
const isPoint=(lat:unknown,lng:unknown):lat is number=>typeof lat==='number'&&Number.isFinite(lat)&&Math.abs(lat)<=90&&typeof lng==='number'&&Number.isFinite(lng)&&Math.abs(lng)<=180
const codeOf=(error:unknown)=>{
 const details=error as {errors?:Array<{extensions?:{code?:string}}>}
 const code=details?.errors?.find(item=>item.extensions?.code==='UNAUTHORIZED'||item.extensions?.code==='UNAUTHENTICATED')?.extensions?.code
 return code??(error instanceof Error&&/\bUNAUTHENTICATED\b/.test(error.message)?'UNAUTHENTICATED':error instanceof Error&&/\bUNAUTHORIZED\b/.test(error.message)?'UNAUTHORIZED':'WORLD_READ_UNAVAILABLE')
}
const kindOf=(kind:string):Place['kind']=>{
 switch(kind.toLowerCase()){
  case 'school':case 'school_pickup':return 'school'
  case 'home':return 'home'
  case 'field':case 'sports_field':case 'practice_field':return 'field'
  case 'park':return 'park'
  default:return 'venue'
 }
}
function projectWorld(wires:WorldWire[],session:MapSession,days:string[]):MapWorld{
 if(wires.length!==days.length||wires.some(w=>!w||w.child?.id!==session.childId||!Array.isArray(w.people)||!Array.isArray(w.places)||!Array.isArray(w.events)))throw Error('WORLD_READ_UNAVAILABLE')
 const placeRows=new Map(wires.flatMap(w=>w.places.map(place=>[place.id,place] as const)))
 const places:Place[]=[...placeRows.values()].map(row=>{
  const point:Point|undefined=row.coordinateState==='SET'&&isPoint(row.lat,row.lng)?[row.lng!,row.lat]:undefined
  return {id:row.id,name:row.label??'Place label not shared',kind:kindOf(row.kind),...(point?{point}:{}),addressRead:!!point,coordinateState:row.coordinateState}
 })
 const placeById=new Map(places.map(place=>[place.id,place]))
 const eventIds=new Set(wires.flatMap(w=>w.events.map(event=>event.id)))
 const peopleRows=new Map(wires.flatMap(w=>w.people.map(person=>[person.person.id,person] as const)))
 const people:MapPerson[]=[...peopleRows.values()].map(row=>{
  const home=row.homePlaceId?placeById.get(row.homePlaceId):undefined
  const event=row.scheduledEventId&&eventIds.has(row.scheduledEventId)&&row.scheduledPlaceId?placeById.get(row.scheduledPlaceId):undefined
  const position:MapPerson['position']=event?.point&&event.kind!=='home'
   ?{source:'event',placeId:event.id,label:event.name,addressRead:false}
   :home?.point&&home.kind==='home'
    ?{source:'home',placeId:home.id,point:home.point,label:home.name,addressRead:true}
    :row.areaLabel?{source:'area',label:row.areaLabel,addressRead:false}
     :{source:'unavailable',label:noLocation,addressRead:false}
  return {id:row.person.id,name:row.person.displayName,position,vehicle:'unknown'}
 })
 const personIds=new Set(people.map(person=>person.id))
 const events:MapEvent[]=wires.flatMap((wire,index)=>wire.events.map(event=>({
  id:event.id,day:days[index],at:event.start,end:event.end??event.start,title:event.title,
  placeId:event.placeState==='LINKED'&&event.placeId&&placeById.has(event.placeId)?event.placeId:null,
  placeState:event.placeState,peopleIds:event.personIds.filter(id=>personIds.has(id)),status:event.status??'NOT_RECORDED',
 })))
 return {childId:session.childId,state:'live',people,places,events,days,canApprove:false,canReadCost:false,parentName:session.parentName??'Household'}
}
async function readStoredRides(read:Read,session:MapSession,signal:AbortSignal):Promise<Pick<MapWorld,'storedRideEstimates'|'rideReadState'>>{
 if(!session.canReadCost)return {storedRideEstimates:[]}
 try{
  const data=await read<JobsWire>(PICKUP_JOBS,{childId:session.childId},signal)
  if(!Array.isArray(data.coordinationJobs))throw Error('WORLD_READ_UNAVAILABLE')
  const candidates=data.coordinationJobs.flatMap(job=>job.candidateEvaluations.filter(item=>item.estimatedRideCostUsd!==null).map(item=>({jobId:job.id,candidate:item.candidate})))
  const results=await Promise.all(candidates.map(async ({jobId,candidate})=>{
   const {pickupRideEstimate:ride}=await read<RideWire>(PICKUP_RIDE,{jobId,candidateId:candidate.id},signal)
   if(!ride||ride.jobId!==jobId||ride.candidateId!==candidate.id||ride.paidRidePath!==true||typeof ride.estimatedRideCostUsd!=='number'||!Number.isFinite(ride.estimatedRideCostUsd))return null
   return {jobId,candidateId:candidate.id,candidateName:candidate.displayName,amountUsd:ride.estimatedRideCostUsd,capUsd:ride.householdCapUsd,distanceMiles:ride.distanceMiles,basis:ride.costBasis,paidRidePath:true} satisfies StoredRideEstimate
  }))
  return {storedRideEstimates:results.filter((item):item is StoredRideEstimate=>item!==null),rideReadState:'ready'}
 }catch(error){
  if(signal.aborted)throw new DOMException('Aborted','AbortError')
  return {storedRideEstimates:[],rideReadState:codeOf(error)==='UNAUTHORIZED'?'refused':'unavailable'}
 }
}
export function createVillageWorldReader(client:ApolloClient,runRead:<T>(read:()=>Promise<T>)=>Promise<T>,now:()=>number=Date.now){
 const read:Read=async<T>(query:ReturnType<typeof gql>,variables:Record<string,string>,signal:AbortSignal)=>{
  try{
   const result=await runRead(()=>client.query<T>({query,variables,fetchPolicy:'no-cache',context:{fetchOptions:{signal}}}))
   if(signal.aborted)throw new DOMException('Aborted','AbortError')
   if(!result.data)throw Error('WORLD_READ_UNAVAILABLE')
   return result.data
  }catch(error){if(signal.aborted)throw new DOMException('Aborted','AbortError');throw Error(codeOf(error))}
 }
 return async(session:MapSession,signal:AbortSignal):Promise<MapWorld>=>{
  const requested=new URLSearchParams(location.hash.split('?')[1]??'').get('day')
  const first=requested&&validDay(requested)?requested:localDay(now())
  const days=Array.from({length:5},(_,index)=>addDays(first,index))
  const wires=await Promise.all(days.map(asOf=>read<{villageWorld:WorldWire}>(VILLAGE_WORLD,{childId:session.childId,asOf},signal).then(data=>data.villageWorld)))
  const world=projectWorld(wires,session,days)
  return {...world,...await readStoredRides(read,session,signal),canReadCost:session.canReadCost===true}
 }
}
