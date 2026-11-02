import {personPoint} from './model'
import type {MapWorld,Mode,Point,RouteResult,VillageMapAdapter} from './types'

// The route proxy accepts one explicit profile per transport mode. World and stored pickup
// estimates use separate authorized graph reads; route geometry is never a price source.
export const routingProfiles={Drive:'driving-car',Walk:'foot-walking',Bike:'cycling-regular'} as const
export type RoutingProfile=typeof routingProfiles[Mode]
export type RouteWire={distanceMeters:number;durationSeconds:number;geometry:{type:'LineString';coordinates:Point[]};source:'openrouteservice';cached:boolean;disclaimer:'Estimated — not live traffic'}
export type RouteRequest={childId:string;fromPlaceId:string;toPlaceId:string;profile:RoutingProfile}
export type RouteTransport={
 readonly supportedProfiles:readonly RoutingProfile[]
 request(input:RouteRequest,bearer:string,signal:AbortSignal):Promise<RouteWire>
}
export type MapSession={generation:number;childId:string;accessToken?:string;canReadCost?:boolean;parentName?:string}
const aborted=()=>new DOMException('Aborted','AbortError')
const codes:Record<number,string>={401:'UNAUTHENTICATED',403:'COORDINATES_WITHHELD',404:'NOT_FOUND',409:'GEOMETRY_UNAVAILABLE',429:'RATE_LIMITED'}
function validPoint(value:unknown):value is Point{return Array.isArray(value)&&value.length===2&&value.every(n=>typeof n==='number'&&Number.isFinite(n))&&Math.abs(value[0])<=180&&Math.abs(value[1])<=90}
export function isRouteWire(value:unknown):value is RouteWire{
 if(!value||typeof value!=='object')return false
 const r=value as Partial<RouteWire>
 return typeof r.distanceMeters==='number'&&Number.isFinite(r.distanceMeters)&&r.distanceMeters>=0&&typeof r.durationSeconds==='number'&&Number.isFinite(r.durationSeconds)&&r.durationSeconds>=0&&r.source==='openrouteservice'&&typeof r.cached==='boolean'&&r.disclaimer==='Estimated — not live traffic'&&r.geometry?.type==='LineString'&&Array.isArray(r.geometry.coordinates)&&r.geometry.coordinates.length>=2&&r.geometry.coordinates.every(validPoint)
}
export function createDeliveredRouteTransport(request:typeof fetch=fetch):RouteTransport{
 return {supportedProfiles:Object.values(routingProfiles),async request(input,bearer,signal){
  let response:Response
  try{response=await request('/api/village/route',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json',Authorization:`Bearer ${bearer}`},body:JSON.stringify(input),signal})}
  catch{if(signal.aborted)throw aborted();throw Error('ROUTE_UNAVAILABLE')}
  if(!response.ok)throw Error(codes[response.status]??'ROUTE_UNAVAILABLE')
  const body:unknown=await response.json().catch(()=>null)
  if(!isRouteWire(body))throw Error('ROUTE_UNAVAILABLE')
  return body
 }}
}
// In-flight cache only: each completed request must pass server authorization again.
// Profile, child and session generation are distinct keys. No token in a cache key.
export const routeRequestKey=(generation:number,r:RouteRequest)=>JSON.stringify([generation,r.childId,r.fromPlaceId,r.toPlaceId,r.profile])
export function createLiveMapAdapter(options:{
 getSession:()=>MapSession|null
 // Internal frontend port, NOT a made-up HTTP/GraphQL shape. Caller must supply the final
 // authorized world projection after #78 lands; absence fails closed.
 readWorld?:(session:MapSession,signal:AbortSignal)=>Promise<MapWorld>
 transport?:RouteTransport
}):VillageMapAdapter&{dispose:()=>void}{
 const transport=options.transport??createDeliveredRouteTransport(),owner=options.getSession(),lifetime=new AbortController()
 const inflight=new Map<string,Promise<RouteWire>>()
 let world:MapWorld|null=null
 function current(){
  const session=options.getSession()
  if(lifetime.signal.aborted||!session||session.generation!==owner?.generation||session.childId!==owner?.childId)throw aborted()
  if(!session.accessToken)throw Error('UNAUTHENTICATED')
  return session
 }
 const signalFor=(signal?:AbortSignal)=>signal?AbortSignal.any([lifetime.signal,signal]):lifetime.signal
 return {mode:'live',async readWorld(signal){
  const session=current()
  if(!options.readWorld)throw Error('WORLD_READ_UNAVAILABLE')
  const combined=signalFor(signal),result=await options.readWorld(session,combined)
  current();if(combined.aborted)throw aborted()
  if(result.state!=='live')throw Error('WORLD_READ_UNAVAILABLE') // Never promote fixtures.
  // A live read never acquires approval authority. Stored costs require both the signed
  // parent/guardian session and the backend's separate pickupRideEstimate read.
  world={...result,childId:session.childId,canApprove:false,canReadCost:session.canReadCost===true&&result.canReadCost}
  return world
 },async route(fromId,toId,mode,signal){
  const session=current(),profile=routingProfiles[mode],combined=signalFor(signal)
  if(combined.aborted)throw aborted()
  if(!transport.supportedProfiles.includes(profile))throw Error('MODE_UNSUPPORTED')
  const from=world?.people.find(p=>p.id===fromId),to=world?.places.find(p=>p.id===toId)
  const origin=world?.places.find(p=>p.id===from?.position.placeId)
  if(!world||!from||!to)throw Error('NOT_FOUND')
  if(!origin)throw Error('LOCATION_NOT_RECORDED')
  if(!personPoint(from,world)||!origin.point||!to.point)throw Error('COORDINATES_WITHHELD')
  const input:RouteRequest={childId:session.childId,fromPlaceId:origin.id,toPlaceId:to.id,profile}
  const key=routeRequestKey(session.generation,input)
  // Explicit cancellation always gets its own flight; one caller cannot abort another.
  let flight=signal?undefined:inflight.get(key)
  if(!flight){
   flight=transport.request(input,session.accessToken!,combined)
   if(!signal){inflight.set(key,flight);const pending=flight;void flight.finally(()=>{if(inflight.get(key)===pending)inflight.delete(key)}).catch(()=>{})}
  }
  const result=await flight;current();if(combined.aborted)throw aborted()
  if(!isRouteWire(result))throw Error('ROUTE_UNAVAILABLE')
  return {id:key,fromId,toId,mode,geometry:result.geometry.coordinates,distanceMiles:result.distanceMeters/1609.344,durationSeconds:result.durationSeconds,rideEstimate:null,state:'live'} satisfies RouteResult
 },dispose(){lifetime.abort();inflight.clear();world=null}}
}
export function mapRouteError(error:unknown){
 const code=error instanceof Error?error.message:''
 switch(code){
  case 'MODE_UNSUPPORTED':return 'This travel mode is not supported yet.'
  case 'UNAUTHENTICATED':return 'Your session ended. Choose a perspective again.'
  case 'UNAUTHORIZED':case 'NOT_FOUND':return "This route isn't shared with you."
  case 'COORDINATES_WITHHELD':return 'Location restricted. Labels are available in the list only.'
  case 'LOCATION_NOT_RECORDED':return 'No location provided for this person in this map.'
  case 'GEOMETRY_UNAVAILABLE':return 'No route coordinates are recorded for this view.'
  case 'RATE_LIMITED':return 'Give it a moment before estimating another route.'
  default:return "Couldn't estimate this route just now."
 }
}
