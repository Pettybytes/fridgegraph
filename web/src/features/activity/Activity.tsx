import {useEffect,useState} from 'react'
import {gql} from '@apollo/client'
import type {createGraphClient} from '@/lib/frontendData/graphqlAdapter'
import type {FrontendAdapter} from '@/lib/frontendData/types'
import type {StoredMissionControl} from '@/lib/frontendData/deliveredAdapter'
import {useSession} from '@/features/personas/Session'
import {formatDay,localDay} from '@/features/calendar/time'
import {activityEntries,localMoment,mayReadFamilyActivity,orbitStatusCopy,type Slip} from './model'
import {readSchoolReports,type SchoolReport} from './schoolReports'
import {readVillagerAdditions,type VillagerAddition} from './villagerAdditions'
import {attempt,sourceNotice,type ReadState,type Source} from './readState'
import './activity.css'
const SLIPS=gql`query WebActivitySlips($childId:ID!){permissionSlips(childId:$childId){id title history{decision at approver{id}}}}`
const STATUS=gql`query WebActivityOrbit($childId:ID!){orbitStatus(childId:$childId){alertId status closeOutcome thankyou latestResponses{person{id displayName} respondedAt response}}}`
const CHECK=gql`query WebActivityCheck($childId:ID!){checkInStatus(childId:$childId){recorded}}`
type OrbitSummary={alertId:string|null;status:string|null;closeOutcome?:string|null;thankyou?:string|null;latestResponses:{person:{id:string;displayName:string};respondedAt:string;response:string}[]}
type View={data:Source<StoredMissionControl|null>;slips:Source<Slip[]>;orbit:Source<OrbitSummary|null>;check:Source<{recorded:boolean}|null>;additions:Source<VillagerAddition[]>;reports:Source<SchoolReport[]>}
const EMPTY:View={data:{state:'ready',data:null},slips:{state:'ready',data:[]},orbit:{state:'ready',data:null},check:{state:'ready',data:null},additions:{state:'ready',data:[]},reports:{state:'ready',data:[]}}
const NAMED:[keyof View,string][]=[['data','Activity feed'],['slips','Consent decisions'],['orbit','Orbit status'],['check','Check-in'],['additions','Village additions'],['reports','School reports']]
export function Activity({client,adapter}:{client:ReturnType<typeof createGraphClient>|null;adapter:FrontendAdapter}){
 const {session,runRead,getSessionGeneration}=useSession(),[phase,setPhase]=useState<'loading'|'ready'|'refused'|'unavailable'>('loading'),[view,setView]=useState<View>(EMPTY)
 const childId=session?.scope.childId,personId=session?.persona.personId,parent=mayReadFamilyActivity(!!session?.persona.parent,!!session?.persona.guardian)
 useEffect(()=>{
  let active=true;const generation=session?.generation;setPhase('loading');setView(EMPTY)
  if(!session||!parent){setPhase('refused');return()=>{active=false}}
  if(!client){setPhase('unavailable');return()=>{active=false}}
  const read=async<T,>(query:typeof SLIPS,field:string)=>runRead(async()=>{const result=await client.query<Record<string,T>>({query,variables:{childId},fetchPolicy:'no-cache'});if(!result.data||result.data[field]===undefined)throw Error('READ_UNAVAILABLE');return result.data[field]})
  void (async()=>{
   // Every source is contained. One failing read can no longer reject the others.
   const [data,slips,orbit,check,additions,reports]=await Promise.all([
    attempt<StoredMissionControl|null>(()=>adapter.readMissionControl(session.scope) as Promise<StoredMissionControl>,null),
    attempt<Slip[]>(()=>read<Slip[]>(SLIPS,'permissionSlips'),[]),
    attempt<OrbitSummary|null>(()=>read<OrbitSummary>(STATUS,'orbitStatus'),null),
    attempt<{recorded:boolean}|null>(()=>read<{recorded:boolean}>(CHECK,'checkInStatus'),null),
    attempt<VillagerAddition[]>(()=>readVillagerAdditions(client,childId!,runRead),[]),
    attempt<SchoolReport[]>(()=>readSchoolReports(client,childId!,runRead),[]),
   ])
   if(active&&getSessionGeneration()===generation)setView({data,slips,orbit,check,additions,reports})
   if(active&&getSessionGeneration()===generation)setPhase('ready')
  })()
  return()=>{active=false}
 },[client,adapter,session?.generation,childId,personId,parent,runRead,getSessionGeneration])
 if(phase==='loading')return <section className="activity" role="status">Loading activity…</section>
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
 return <section className="activity" aria-label={`${session!.scope.childName} activity`}><p>Recorded activity for {session!.scope.childName}. Times shown in Detroit local time.</p>
 {failed.map(({key,label,state})=>{const notice=sourceNotice(label,state);return <aside key={key} className="activity-status" role={state==='privilege'?'status':'alert'}><h2>{notice.heading}</h2><p>{notice.body}</p></aside>})}
 {view.orbit.state==='ready'&&view.orbit.data?.status&&<aside className="activity-status"><h2>Orbit status</h2><p>{orbitStatusCopy(view.orbit.data)}</p><a href="#/orbit">Open Orbit</a></aside>}
 {view.check.state==='ready'&&view.check.data?.recorded===false&&<p className="activity-status">Check-in not recorded. <a href="#/orbit">Open Orbit</a></p>}
 {!entries.length?(failed.length?<p className="activity-status">No records could be loaded for this view. {failed.length} source{failed.length===1?'':'s'} unavailable above.</p>:<p className="activity-status">No records are available to this view</p>):days.map(day=><section key={day} className="activity-day"><h2>{formatDay(day,true)}</h2><ol>{entries.filter(e=>e.day===day).map(e=><li key={e.id}><time dateTime={e.at}>{localMoment(e.at)}</time><div><strong>{e.kind}</strong><h3>{e.who}</h3><p>{e.what}</p>{e.href&&<a href={e.href}>Open in {e.place}</a>}</div></li>)}</ol></section>)}
 </section>
}
