import {gql} from '@apollo/client'
import type {createGraphClient} from '@/lib/frontendData/graphqlAdapter'
import type {AuthSession} from '@/features/personas/auth'
import {addDays,validDay} from './time'
export const CHILD_EVENTS=gql`query WebChildEvents($childId:ID!,$from:String!,$to:String!,$includeCancelled:Boolean!){childEvents(childId:$childId,from:$from,to:$to,includeCancelled:$includeCancelled){id title start end location status}}`
export const EFFECTIVE_SCHEDULE=gql`query WebEffectiveSchedule($childId:ID!,$date:String!){effectiveScheduleFor(childId:$childId,date:$date){parent{id displayName} source arrangementId}}`
export const SCHEDULE_CONFLICTS=gql`query WebScheduleConflicts($childId:ID!,$from:String!,$to:String!){scheduleConflicts(childId:$childId,from:$from,to:$to){kind onDay arrangementIds}}`
export const ADULT_AVAILABILITY=gql`query WebAdultAvailability($personId:ID!,$from:String!,$to:String!){adultAvailability(personId:$personId,from:$from,to:$to){person{id displayName} start end state}}`
export type ReadOutcome<T>={state:'ready';value:T}|{state:'refused'}|{state:'failed'}
export type LiveEvent={id:string;title:string;start:string;end:string;location:string|null;status:string}
export type EffectiveCare={parent:{id:string;displayName:string}|null;source:string;arrangementId:string|null}
export type ScheduleConflict={kind:string;onDay:string;arrangementIds:string[]}
export type Availability={person:{id:string;displayName:string};start:string;end:string;state:'BUSY'|'FREE'}
export type LiveWindow={childId:string;days:string[];events:ReadOutcome<LiveEvent[]>;care:Record<string,ReadOutcome<EffectiveCare>>;conflicts:ReadOutcome<ScheduleConflict[]>;availability:ReadOutcome<Availability[]>}
export const outcomeCopy={empty:'No records are available to this view',refused:"This isn't shared with you",failed:"Couldn't load this just now"}
export type LiveCalendarAdapter=ReturnType<typeof createLiveCalendarAdapter>
export function createLiveCalendarAdapter(client:ReturnType<typeof createGraphClient>,session:Pick<AuthSession,'generation'|'persona'|'scope'|'marks'>,runRead:<T>(read:()=>Promise<T>)=>Promise<T>,getGeneration:()=>number){
 const generation=session.generation,events=new Map<string,LiveEvent>(),eventChildren=new Map<string,string>(),listeners=new Set<()=>void>()
 let actionScope={calendarChildIds:new Set<string>(session.persona.parent||session.persona.guardian||session.persona.grants.includes('schedule.read')||session.marks?.demoGuide?[session.scope.childId]:[]),calendarEventIds:new Set<string>()}
 const publish=()=>{actionScope={calendarChildIds:new Set(actionScope.calendarChildIds),calendarEventIds:new Set(events.keys())};for(const notify of listeners)notify()}
 async function read<T>(query:Parameters<typeof client.query>[0]['query'],variables:Record<string,string|boolean>,field:string):Promise<ReadOutcome<T>>{
  try{
   const value=await runRead(async()=>{const result=await client.query<Record<string,T>>({query,variables,fetchPolicy:'no-cache'});if(!result.data||result.data[field]===undefined)throw Error('READ_UNAVAILABLE');return result.data[field]})
   if(getGeneration()!==generation)throw Error('SESSION_CHANGED')
   return {state:'ready',value}
  }catch(error){
   if(getGeneration()!==generation)throw Error('SESSION_CHANGED')
   const e=error as {message?:string;errors?:{extensions?:{code?:string}}[]}
   return /UNAUTHORIZED/.test(e.message??'')||e.errors?.some(x=>x.extensions?.code==='UNAUTHORIZED')?{state:'refused'}:{state:'failed'}
  }
 }
 async function readWindow({childId,from,to,includeCancelled=false}:{childId:string;from:string;to:string;includeCancelled?:boolean}):Promise<LiveWindow>{
  if(!validDay(from)||!validDay(to)||from>to)throw Error('INVALID_DATE')
  const days:string[]=[];for(let day=from;day<=to;day=addDays(day,1)){if(days.length>=42)throw Error('INVALID_DATE');days.push(day)}
  const [eventResult,conflicts,schedules]=await Promise.all([
   read<LiveEvent[]>(CHILD_EVENTS,{childId,from,to,includeCancelled},'childEvents'),
   read<ScheduleConflict[]>(SCHEDULE_CONFLICTS,{childId,from,to},'scheduleConflicts'),
   Promise.all(days.map(async date=>[date,await read<EffectiveCare>(EFFECTIVE_SCHEDULE,{childId,date},'effectiveScheduleFor')] as const)),
  ])
  const care=Object.fromEntries(schedules)
  // Only IDs actually returned for this child's care, plus this caller's own identity. No mock roster.
  const people=new Set([session.persona.personId,...schedules.flatMap(([,r])=>r.state==='ready'&&r.value.parent?[r.value.parent.id]:[])])
  const windows=await Promise.all([...people].map(personId=>read<Availability[]>(ADULT_AVAILABILITY,{personId,from,to},'adultAvailability')))
  // Keep each adult read's outcome; an authorized [] is never promoted to UNAUTHORIZED.
  const availability:ReadOutcome<Availability[]>=windows.some(r=>r.state==='failed')?{state:'failed'}:windows.some(r=>r.state==='refused')?{state:'refused'}:{state:'ready',value:windows.flatMap(r=>r.state==='ready'?r.value:[])}
  if(getGeneration()!==generation)throw Error('SESSION_CHANGED')
  if(eventResult.state==='ready'){actionScope.calendarChildIds.add(childId);for(const event of eventResult.value){events.set(event.id,event);eventChildren.set(event.id,childId)}}
  if(eventResult.state==='refused'){actionScope.calendarChildIds.delete(childId);for(const [id,owner] of eventChildren)if(owner===childId){events.delete(id);eventChildren.delete(id)}}
  publish()
  return {childId,days,events:eventResult,care,conflicts,availability}
 }
 return {mode:'live' as const,scope:session.scope,readWindow,knownEvent:(id:string)=>events.get(id),knownChild:(id:string)=>eventChildren.get(id),getActionScope:()=>actionScope,subscribe:(notify:()=>void)=>{listeners.add(notify);return()=>{listeners.delete(notify)}},clear(){events.clear();eventChildren.clear();actionScope.calendarChildIds.clear();publish()}}
}
