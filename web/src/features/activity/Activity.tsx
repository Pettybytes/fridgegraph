import {useCallback} from 'react'
import {useCachedResource} from '@/lib/frontendData/resourceCache'
import {RouteSkeleton} from '@/app/RouteSkeleton'
import {gql} from '@apollo/client'
import type {createGraphClient} from '@/lib/frontendData/graphqlAdapter'
import type {FrontendAdapter} from '@/lib/frontendData/types'
import type {StoredMissionControl} from '@/lib/frontendData/deliveredAdapter'
import {useSession} from '@/features/personas/Session'
import {formatDay,localDay} from '@/features/calendar/time'
import {activityEntries,localMoment,mayReadFamilyActivity,orbitStatusCopy,type Slip,type Entry} from './model'
import {readSchoolReports,type SchoolReport} from './schoolReports'
import {readVillagerAdditions,type VillagerAddition} from './villagerAdditions'
import {attempt,sourceNotice,type ReadState,type Source} from './readState'
import {TypeNode,type CardType} from '@/components/fg/cards'
import {Car,GraduationCap,Siren,Check,HeartPulse,Phone,Users,ArrowUpRight} from 'lucide-react'
import type {ReactNode} from 'react'
import './activity.css'

/* Each recorded event becomes a horizontal card; its TYPE drives the icon chip colour
   (design.md §12 legend). Honest labels are preserved exactly (the detail is the recorded
   wording; Simulated stays Simulated). */
function activityType(e:Entry):CardType{
 if(e.place==='Orbit')return 'orbit'
 if(e.id.startsWith('school:'))return 'school'
 if(e.id.startsWith('villager:'))return 'neutral'
 if(e.kind==='SIMULATED')return 'pending'                               // test responder = gray
 if(e.place==='Mission Control'&&e.kind==='RECORDED')return 'pending'   // outreach = gray
 if(e.kind==='PROPOSED'||e.kind==='CONFIRMED'||e.kind==='APPROVED'||e.kind==='DECLINED')return 'pickup'
 return 'neutral'
}
const TYPE_ICON:Record<CardType,ReactNode>={pickup:<Car/>,school:<GraduationCap/>,orbit:<Siren/>,safe:<Check/>,care:<HeartPulse/>,pending:<Phone/>,neutral:<Users/>,invite:<Users/>,fridge:<Users/>,rosina:<Users/>}
function activityTitle(e:Entry):string{
 if(e.place==='Orbit')return 'Orbit response'
 if(e.id.startsWith('school:'))return 'School report'
 if(e.id.startsWith('villager:'))return 'Village update'
 switch(e.kind){case 'PROPOSED':return 'Pickup requested';case 'SIMULATED':return 'Outreach (test responder)';case 'RECORDED':return 'Outreach';case 'CONFIRMED':return 'Confirmation';case 'APPROVED':return 'Approved';case 'DECLINED':return 'Declined';default:return 'Recorded'}
}
const STATUS_BADGE:Record<Entry['kind'],string>={PROPOSED:'Proposed',SIMULATED:'Simulated',REPORTED:'Reported',RECORDED:'Recorded',CONFIRMED:'Recorded',APPROVED:'Recorded',DECLINED:'Recorded'}
function ActivityCard({e}:{e:Entry}){
 const type=activityType(e),person=e.id.startsWith('school:')?null:e.who,badge=STATUS_BADGE[e.kind]
 return <article className="activity-card" data-fgc-type={type}>
  <TypeNode type={type}>{TYPE_ICON[type]}</TypeNode>
  <div className="activity-card-body">
   <div className="activity-card-head"><span className="activity-card-title">{activityTitle(e)}</span><span className="activity-badge" data-status={badge.toLowerCase()}>{badge}</span></div>
   {person?<span className="activity-card-person">{person}</span>:null}
   <p className="activity-card-detail">{e.what}</p>
   {e.href?<a className="activity-card-open" href={e.href}>Open in {e.place}<ArrowUpRight size={14} aria-hidden /></a>:null}
  </div>
  <time className="activity-card-time" dateTime={e.at}>{localMoment(e.at)}</time>
 </article>
}
const SLIPS=gql`query WebActivitySlips($childId:ID!){permissionSlips(childId:$childId){id title history{decision at approver{id}}}}`
const STATUS=gql`query WebActivityOrbit($childId:ID!){orbitStatus(childId:$childId){alertId status closeOutcome thankyou latestResponses{person{id displayName} respondedAt response}}}`
const CHECK=gql`query WebActivityCheck($childId:ID!){checkInStatus(childId:$childId){recorded}}`
type OrbitSummary={alertId:string|null;status:string|null;closeOutcome?:string|null;thankyou?:string|null;latestResponses:{person:{id:string;displayName:string};respondedAt:string;response:string}[]}
type View={data:Source<StoredMissionControl|null>;slips:Source<Slip[]>;orbit:Source<OrbitSummary|null>;check:Source<{recorded:boolean}|null>;additions:Source<VillagerAddition[]>;reports:Source<SchoolReport[]>}
const EMPTY:View={data:{state:'ready',data:null},slips:{state:'ready',data:[]},orbit:{state:'ready',data:null},check:{state:'ready',data:null},additions:{state:'ready',data:[]},reports:{state:'ready',data:[]}}
const NAMED:[keyof View,string][]=[['data','Activity feed'],['slips','Consent decisions'],['orbit','Orbit status'],['check','Check-in'],['additions','Village additions'],['reports','School reports']]
export async function loadActivity(client:ReturnType<typeof createGraphClient>,adapter:FrontendAdapter,scope:Parameters<FrontendAdapter['readMissionControl']>[0],runRead:<T>(read:()=>Promise<T>)=>Promise<T>):Promise<View>{
 const childId=scope.childId
 const read=async<T,>(query:typeof SLIPS,field:string)=>runRead(async()=>{const result=await client.query<Record<string,T>>({query,variables:{childId},fetchPolicy:'network-only'});if(!result.data||result.data[field]===undefined)throw Error('READ_UNAVAILABLE');return result.data[field]})
 const [data,slips,orbit,check,additions,reports]=await Promise.all([
  attempt<StoredMissionControl|null>(()=>adapter.readMissionControl(scope) as Promise<StoredMissionControl>,null),
  attempt<Slip[]>(()=>read<Slip[]>(SLIPS,'permissionSlips'),[]),
  attempt<OrbitSummary|null>(()=>read<OrbitSummary>(STATUS,'orbitStatus'),null),
  attempt<{recorded:boolean}|null>(()=>read<{recorded:boolean}>(CHECK,'checkInStatus'),null),
  attempt<VillagerAddition[]>(()=>readVillagerAdditions(client,childId,runRead),[]),
  attempt<SchoolReport[]>(()=>readSchoolReports(client,childId,runRead),[]),
 ])
 return {data,slips,orbit,check,additions,reports}
}
export function Activity({client,adapter}:{client:ReturnType<typeof createGraphClient>|null;adapter:FrontendAdapter}){
 const {session,runRead}=useSession()
 const childId=session?.scope.childId,personId=session?.persona.personId,parent=!!session?.marks?.demoGuide||mayReadFamilyActivity(!!session?.persona.parent,!!session?.persona.guardian)
 const load=useCallback(()=>loadActivity(client!,adapter,session!.scope,runRead),[client,adapter,session?.generation,childId,runRead])
 const cached=useCachedResource(parent?client:null,`activity:${childId}`,load,4000)
 const phase=!session||!parent?'refused':!client?'unavailable':cached?'ready':'loading'
 const view=cached?.value??EMPTY
 if(phase==='loading')return <RouteSkeleton />
 if(cached?.error)return <section className="activity" role="alert">Couldn’t refresh activity. Try again.</section>
 if(phase==='refused')return <section className="activity" role="alert"><h2>This activity is not shared with you</h2><p>Your perspective cannot read this child’s family activity.</p></section>
 if(phase==='unavailable')return <section className="activity" data-state="unavailable"><h2>Activity isn’t connected in this view.</h2><p>Choose a live perspective to see the records shared with it.</p></section>
 const entries=activityEntries(view.data.state==='ready'&&view.data.data?view.data.data:{candidates:[],events:[],recordedRuns:[]} as unknown as StoredMissionControl,view.slips.state==='ready'?view.slips.data:[],{[personId!]:session!.persona.name},view.reports.state==='ready'?view.reports.data:[],view.additions.state==='ready'?view.additions.data:[])
 for(const response of (view.orbit.state==='ready'?view.orbit.data?.latestResponses:[])??[]){
  if(Number.isFinite(Date.parse(response.respondedAt)))entries.push({id:`orbit:${response.person.id}:${response.respondedAt}`,at:response.respondedAt,day:localDay(response.respondedAt),kind:'REPORTED',who:response.person.displayName,what:response.response==='WITH_ME'?'Reported WITH_ME. This is a report, not verification.':`Reported ${response.response.replaceAll('_',' ').toLowerCase()}. This is a report, not verification.`,href:'#/orbit',place:'Orbit'})
 }
 entries.sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))
 const days=[...new Set(entries.map(e=>e.day))]
 // A source that failed is reported by name; a source that succeeded and returned nothing is empty.
 const failed=NAMED.map(([key,label])=>({key,label,state:view[key].state})).filter((source):source is {key:keyof View;label:string;state:Exclude<ReadState,'ready'>}=>source.state!=='ready')
 return <section className="activity" aria-label={`${session!.scope.childName} activity`}><p className="activity-lead">Recorded activity for {session!.scope.childName}. Times shown in Detroit local time.</p>
 {failed.map(({key,label,state})=>{const notice=sourceNotice(label,state);return <aside key={key} className="activity-status" role={state==='privilege'?'status':'alert'}><h2>{notice.heading}</h2><p>{notice.body}</p></aside>})}
 {view.orbit.state==='ready'&&view.orbit.data?.status&&<aside className="activity-status"><h2>Orbit status</h2><p>{orbitStatusCopy(view.orbit.data)}</p><a href="#/orbit">Open Orbit</a></aside>}
 {view.check.state==='ready'&&view.check.data?.recorded===false&&<p className="activity-status">Check-in not recorded. <a href="#/orbit">Open Orbit</a></p>}
 {!entries.length?(failed.length?<p className="activity-status">Some activity sources did not answer; they are named above and retry on their own.</p>:<p className="activity-status">Nothing recorded for this view yet. New activity appears here as it happens.</p>):days.map(day=><section key={day} className="activity-day"><h2 className="activity-day-head">{formatDay(day,true)}</h2><div className="activity-cards">{entries.filter(e=>e.day===day).map(e=><ActivityCard key={e.id} e={e}/>)}</div></section>)}
 </section>
}
