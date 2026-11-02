import {expect,it,vi} from 'vitest'
import type {ApolloClient} from '@apollo/client'
import type {DocumentNode} from 'graphql'
import {createVillageWorldReader} from './worldReader'
import {eventPlaceLabel,personPoint} from './model'
import type {MapSession} from './liveAdapter'

const day='2026-11-01'
const world=(asOf:string)=>({child:{id:'p_nora'},people:[
 {person:{id:'p_caregiver',displayName:'Caregiver from graph'},relationship:'caregiver',homePlaceId:null,areaLabel:null,scheduledEventId:null,scheduledPlaceId:null},
],places:[
 {id:'rp_school',label:'School label from graph',kind:'SCHOOL',lat:42.35,lng:-83.07,coordinateState:'SET'},
 {id:'rp_private',label:'Private place label from graph',kind:'PARK',lat:null,lng:null,coordinateState:'WITHHELD'},
],events:asOf===day?[
 {id:'e_linked',title:'Pickup record',start:'2026-11-01T18:00:00Z',end:null,status:'CONFIRMED',placeId:'rp_school',placeState:'LINKED',personIds:[]},
 {id:'e_withheld',title:'Private event',start:'2026-11-01T19:00:00Z',end:null,status:'PROPOSED',placeId:null,placeState:'WITHHELD',personIds:[]},
 {id:'e_unlinked',title:'Event without a place',start:'2026-11-01T20:00:00Z',end:null,status:'CONFIRMED',placeId:null,placeState:'UNLINKED',personIds:[]},
]:[]})
const session:MapSession={generation:1,childId:'p_nora',accessToken:'test-session',parentName:'Kendra',canReadCost:false}
function setup(ride:'haversine'|'refused'|'none'='none'){
 const calls:string[]=[]
 const query=vi.fn(async({query,variables}:{query:DocumentNode;variables:Record<string,string>})=>{
  const name=query.definitions.find(definition=>definition.kind==='OperationDefinition')?.name?.value??''
  calls.push(name)
  if(name==='WebMapVillageWorld')return {data:{villageWorld:world(variables.asOf)}}
  if(name==='WebMapPickupJobs'){
   if(ride==='refused')throw Object.assign(Error('refused'),{errors:[{extensions:{code:'UNAUTHORIZED'}}]})
   return {data:{coordinationJobs:[{id:'job_recorded',candidateEvaluations:[{candidate:{id:'p_caregiver',displayName:'Caregiver from graph'},estimatedRideCostUsd:0},{candidate:{id:'p_driver',displayName:'Driver from graph'},estimatedRideCostUsd:null}]}]}}
  }
  if(name==='WebMapPickupRide')return {data:{pickupRideEstimate:{jobId:variables.jobId,candidateId:variables.candidateId,estimatedRideCostUsd:0,costBasis:ride,distanceMiles:0,householdCapUsd:10,paidRidePath:true}}}
  throw Error('Unexpected operation')
 })
 return {read:createVillageWorldReader({query} as unknown as ApolloClient,read=>read(),()=>Date.parse('2026-11-02T03:00:00Z')),calls,query}
}
it('projects only graph identities, withheld coordinates and three distinct event place states',async()=>{
 location.hash=''
 const {read,calls}=setup(),result=await read(session,new AbortController().signal)
 expect(result).toMatchObject({state:'live',childId:'p_nora',days:['2026-11-01','2026-11-02','2026-11-03','2026-11-04','2026-11-05']})
 expect(result.people).toHaveLength(1)
 expect(result.people[0].position).toMatchObject({source:'unavailable',label:'No location provided for this person in this map'})
 expect(personPoint(result.people[0],result)).toBeUndefined()
 expect(result.places.map(place=>[place.id,place.name,place.point])).toEqual([['rp_school','School label from graph',[-83.07,42.35]],['rp_private','Private place label from graph',undefined]])
 expect(result.events.map(event=>[event.id,event.placeState,event.placeId,event.peopleIds])).toEqual([['e_linked','LINKED','rp_school',[]],['e_withheld','WITHHELD',null,[]],['e_unlinked','UNLINKED',null,[]]])
 expect(result.events.map(event=>eventPlaceLabel(event,result))).toEqual(['School label from graph','Place details not shared with you','No place linked to this event'])
 expect(calls).toEqual(Array(5).fill('WebMapVillageWorld'))
})
it('reads a stored paid-ride estimate only for a parent/guardian session, including a real zero and basis',async()=>{
 location.hash=''
 const {read,calls}=setup('haversine')
 const limited=await read(session,new AbortController().signal)
 expect(limited.canReadCost).toBe(false)
 expect(limited.storedRideEstimates).toEqual([])
 expect(calls).not.toContain('WebMapPickupJobs')
 const parent=await read({...session,canReadCost:true},new AbortController().signal)
 expect(parent.canReadCost).toBe(true)
 expect(parent.rideReadState).toBe('ready')
 expect(parent.storedRideEstimates).toEqual([{jobId:'job_recorded',candidateId:'p_caregiver',candidateName:'Caregiver from graph',amountUsd:0,capUsd:10,distanceMiles:0,basis:'haversine',paidRidePath:true}])
 expect(calls.filter(name=>name==='WebMapPickupRide')).toHaveLength(1)
})
it('keeps a pickup cost refusal distinct from an authorized empty world',async()=>{
 location.hash=''
 const {read}=setup('refused'),result=await read({...session,canReadCost:true},new AbortController().signal)
 expect(result.people).toHaveLength(1)
 expect(result.rideReadState).toBe('refused')
 expect(result.storedRideEstimates).toEqual([])
})
