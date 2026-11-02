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
import './activity.css'
const SLIPS=gql`query WebActivitySlips($childId:ID!){permissionSlips(childId:$childId){id title history{decision at approver{id}}}}`
const STATUS=gql`query WebActivityOrbit($childId:ID!){orbitStatus(childId:$childId){alertId status closeOutcome thankyou latestResponses{person{id displayName} respondedAt response}}}`
const CHECK=gql`query WebActivityCheck($childId:ID!){checkInStatus(childId:$childId){recorded}}`
type OrbitSummary={alertId:string|null;status:string|null;closeOutcome?:string|null;thankyou?:string|null;latestResponses:{person:{id:string;displayName:string};respondedAt:string;response:string}[]}
export function Activity({client,adapter}:{client:ReturnType<typeof createGraphClient>|null;adapter:FrontendAdapter}){
 const {session,runRead,getSessionGeneration}=useSession(),[state,setState]=useState<{phase:'loading'|'ready'|'error'|'refused';data?:StoredMissionControl;slips:Slip[];reports:SchoolReport[];additions:VillagerAddition[];school:'ready'|'unavailable'|'refused';orbit?:OrbitSummary;check?:{recorded:boolean};error?:string}>({phase:'loading',slips:[],reports:[],additions:[],school:'ready'})
 const childId=session?.scope.childId,personId=session?.persona.personId,parent=mayReadFamilyActivity(!!session?.persona.parent,!!session?.persona.guardian)
 useEffect(()=>{
  let active=true;const generation=session?.generation;setState({phase:'loading',slips:[],reports:[],additions:[],school:'ready'})
  if(!session||!client||!parent){setState({phase:'refused',slips:[],reports:[],additions:[],school:'refused'});return()=>{active=false}}
  const read=async<T,>(query:typeof SLIPS,field:string)=>runRead(async()=>{const result=await client.query<Record<string,T>>({query,variables:{childId},fetchPolicy:'no-cache'});if(!result.data||result.data[field]===undefined)throw Error('READ_UNAVAILABLE');return result.data[field]})
  void (async()=>{try{
   const [base,school]=await Promise.all([Promise.all([adapter.readMissionControl(session.scope) as Promise<StoredMissionControl>,read<Slip[]>(SLIPS,'permissionSlips'),read<OrbitSummary>(STATUS,'orbitStatus'),read<{recorded:boolean}>(CHECK,'checkInStatus'),readVillagerAdditions(client,childId!,runRead)]),readSchoolReports(client,childId!,runRead).then(reports=>({reports}),error=>({error}))])
   if(active&&getSessionGeneration()===generation){const [data,slips,orbit,check,additions]=base;setState({phase:'ready',data,slips,orbit,check,additions,reports:'reports'in school?school.reports:[],school:'error'in school?/UNAUTHORIZED|UNAUTHENTICATED|AUTH_ERROR/.test(String(school.error))?'refused':'unavailable':'ready'})}
  }catch(error){if(active&&getSessionGeneration()===generation)setState({phase:/UNAUTHORIZED|UNAUTHENTICATED|AUTH_ERROR/.test(String(error))?'refused':'error',slips:[],reports:[],additions:[],school:'unavailable',error:String(error)})}})()
  return()=>{active=false}
 },[client,adapter,session?.generation,childId,personId,parent,runRead,getSessionGeneration])
 if(state.phase==='loading')return <section className="activity" role="status">Loading activity…</section>
 if(state.phase==='refused')return <section className="activity" role="alert"><h2>This activity is not shared with you</h2><p>Your perspective cannot read this child’s family activity.</p></section>
 if(state.phase==='error')return <section className="activity" role="alert"><h2>Activity unavailable</h2><p>Unable to load recorded activity. Please try again.</p></section>
 const entries=activityEntries(state.data!,state.slips,{[personId!]:session!.persona.name},state.reports,state.additions)
 for(const response of state.orbit?.latestResponses??[]){
  if(Number.isFinite(Date.parse(response.respondedAt)))entries.push({id:`orbit:${response.person.id}:${response.respondedAt}`,at:response.respondedAt,day:localDay(response.respondedAt),kind:'REPORTED',who:response.person.displayName,what:response.response==='WITH_ME'?'Reported WITH_ME. This is a report, not verification.':`Reported ${response.response.replaceAll('_',' ').toLowerCase()}. This is a report, not verification.`,href:'#/orbit',place:'Orbit'})
 }
 entries.sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))
 const days=[...new Set(entries.map(e=>e.day))]
 return <section className="activity" aria-label={`${session!.scope.childName} activity`}><p>Recorded activity for {session!.scope.childName}. Times shown in Detroit local time.</p>
 {state.school!=='ready'&&<aside className="activity-status" role="alert"><h2>School reports {state.school==='refused'?'not shared':'unavailable'}</h2><p>{state.school==='refused'?'This perspective cannot read school reports.':'School reports could not be loaded. Other authorized activity is shown below.'}</p></aside>}
 {state.orbit?.status&&<aside className="activity-status"><h2>Orbit status</h2><p>{orbitStatusCopy(state.orbit)}</p><a href="#/orbit">Open Orbit</a></aside>}
 {state.check?.recorded===false&&<p className="activity-status">Check-in not recorded. <a href="#/orbit">Open Orbit</a></p>}
 {!entries.length?<p className="activity-status">No records are available to this view</p>:days.map(day=><section key={day} className="activity-day"><h2>{formatDay(day,true)}</h2><ol>{entries.filter(e=>e.day===day).map(e=><li key={e.id}><time dateTime={e.at}>{localMoment(e.at)}</time><div><strong>{e.kind}</strong><h3>{e.who}</h3><p>{e.what}</p>{e.href&&<a href={e.href}>Open in {e.place}</a>}</div></li>)}</ol></section>)}
 </section>
}
