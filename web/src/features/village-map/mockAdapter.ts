import type {MapWorld,MapPerson,Place,VillageMapAdapter,Mode,Point,RouteResult} from './types'
// Synthetic map scenario, not seeded homes, GPS, ORS output or production authorization.
// Every coordinate is a fictional display point. Never mix this world into live records.
const school:Place={id:'school',name:'Maplewood School',kind:'school',point:[-83.069,42.345],addressRead:false}
const center:Place={id:'community',name:'Oakwood Community Center',kind:'venue',point:[-83.112,42.368],addressRead:false}
const places:Place[]=[school,center,{id:'riverside',name:'Riverside Park',kind:'park',point:[-83.049,42.337],addressRead:false},{id:'field',name:'Tigers Field 3',kind:'field',point:[-83.085,42.359],addressRead:false},{id:'home',name:"Kendra's home",kind:'home',point:[-83.095,42.348],addressRead:true},{id:'library',name:'Willow Library',kind:'venue',point:[-83.063,42.36],addressRead:false}]
const person=(id:string,name:string,point:Point|undefined,label:string,source:MapPerson['position']['source'],vehicle:MapPerson['vehicle']):MapPerson=>({id,name,position:{point,label,source,addressRead:source==='home'},vehicle})
const people=[person('p_nora','Nora Ellison',school.point,school.name,'event','unknown'),person('p_mom','Kendra Ellison',[-83.095,42.348],"Kendra's home",'home','recorded'),person('p_dad','Andre Ellison',undefined,'North village area','area','recorded'),person('p_gma','Loretta Brooks',center.point,center.name,'event','none'),person('p_priya','Priya Nair',[-83.063,42.36],'Willow Library','event','unknown'),person('p_tasha','Tasha Ellison',undefined,'East village area','area','recorded')]
// Explicit synthetic current-event association; never a centroid for a withheld home.
people.find(p=>p.id==='p_gma')!.position.placeId='community'
people.find(p=>p.id==='p_nora')!.position.placeId='school'
people.find(p=>p.id==='p_priya')!.position.placeId='library'
people.find(p=>p.id==='p_mom')!.position.placeId='home'
const days=['2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-06']
const events=days.flatMap(day=>[
 {id:`community-${day}`,day,at:`${day}T14:00:00-05:00`,end:`${day}T15:00:00-05:00`,title:'Community volunteering',placeId:'community',peopleIds:['p_gma'],status:'CONFIRMED' as const},
 {id:`school-${day}`,day,at:`${day}T15:15:00-05:00`,end:`${day}T15:30:00-05:00`,title:'School pickup',placeId:'school',peopleIds:['p_nora'],status:'CONFIRMED' as const},
 {id:`soccer-${day}`,day,at:`${day}T16:30:00-05:00`,end:`${day}T17:30:00-05:00`,title:'Tigers soccer practice',placeId:'field',peopleIds:['p_nora','p_dad'],status:'CONFIRMED' as const},
 {id:`park-${day}`,day,at:`${day}T18:00:00-05:00`,end:`${day}T18:45:00-05:00`,title:'Park visit',placeId:'riverside',peopleIds:['p_nora','p_mom'],status:'PROPOSED' as const},
])
// No-driver night: explicitly synthetic paid-ride path, not inferred from a route or calendar gap.
// Stored MOCK road result. Cost is supplied, never computed by browser pricing logic.
export const sampleRide={amountUsd:12.4,capUsd:10,roadDistanceMiles:8.86,basis:'Stored sample road-distance estimate: 8.86 mi × $1.40/mi; estimate, not a provider quote.',paidRidePath:true as const,candidateId:'p_gma',state:'mock' as const}
const points:Point[]=[[-83.112,42.368],[-83.105,42.365],[-83.099,42.36],[-83.092,42.356],[-83.084,42.352],[-83.076,42.348],[-83.069,42.345]]
const times:Record<Mode,number>={Drive:1080,Walk:10200,Bike:3000}
export function createMockMapAdapter(personaId:string):VillageMapAdapter{
 const parent=['kendra','andre'].includes(personaId),limited=['priya','loretta'].includes(personaId)
 function world():MapWorld{
  if(!parent&&!limited)throw Error('UNAUTHORIZED')
  const visible=parent?people:people.filter(p=>['p_nora','p_priya',...(personaId==='loretta'?['p_gma']:[])].includes(p.id))
  const ids=new Set(visible.map(p=>p.id))
  return structuredClone({state:'mock',people:visible,places:places.filter(p=>p.kind!=='home'||parent),events:events.filter(e=>e.peopleIds.some(id=>ids.has(id))).map(e=>({...e,peopleIds:e.peopleIds.filter(id=>ids.has(id))})),days,canApprove:parent,parentName:parent?'Kendra':'Parent'})
 }
 return {mode:'mock',readWorld:async()=>world(),route:async(fromId,toId,mode,signal)=>{
  if(signal?.aborted)throw new DOMException('Aborted','AbortError')
  const data=world(),from=data.people.find(p=>p.id===fromId),to=data.places.find(p=>p.id===toId)
  if(!from||!to||!from.position.point||!to.point)throw Error('UNAUTHORIZED')
  if(!parent)throw Error('UNAUTHORIZED') // Explicit mock route grant; schedule.read is not a home/route grant.
  const geometry:Point[]=fromId==='p_gma'&&toId==='school'?points:[from.position.point,[from.position.point[0],to.point[1]],to.point]
  return {id:`sample-${fromId}-${toId}-${mode}`,fromId,toId,mode,geometry,distanceMiles:fromId==='p_gma'?8.86:3.2,durationSeconds:times[mode],rideEstimate:from.vehicle==='none'&&fromId==='p_gma'&&toId==='school'?sampleRide:null,state:'mock'} satisfies RouteResult
 }}
}
