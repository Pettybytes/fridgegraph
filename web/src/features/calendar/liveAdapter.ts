import {gql} from '@apollo/client'
import type {createGraphClient} from '@/lib/frontendData/graphqlAdapter'
import type {AuthSession} from '@/features/personas/auth'
import {addDays,validDay} from './time'
const EVENT_FIELDS=`id title start end location status notes color`
export const CHILD_EVENTS=gql`query WebChildEvents($childId:ID!,$from:String!,$to:String!,$includeCancelled:Boolean!){childEvents(childId:$childId,from:$from,to:$to,includeCancelled:$includeCancelled){${EVENT_FIELDS}}}`
export const EFFECTIVE_SCHEDULE=gql`query WebEffectiveSchedule($childId:ID!,$date:String!){effectiveScheduleFor(childId:$childId,date:$date){parent{id displayName} source arrangementId}}`
export const SCHEDULE_CONFLICTS=gql`query WebScheduleConflicts($childId:ID!,$from:String!,$to:String!){scheduleConflicts(childId:$childId,from:$from,to:$to){kind onDay arrangementIds}}`
export const ADULT_AVAILABILITY=gql`query WebAdultAvailability($personId:ID!,$from:String!,$to:String!){adultAvailability(personId:$personId,from:$from,to:$to){person{id displayName} start end state}}`
export const CREATE_EVENT=gql`mutation WebCreateEvent($childId:ID!,$title:String!,$start:String!,$end:String!,$location:String,$notes:String,$color:String,$status:String){createCalendarEvent(childId:$childId,title:$title,start:$start,end:$end,location:$location,notes:$notes,color:$color,status:$status){${EVENT_FIELDS}}}`
export const UPDATE_EVENT=gql`mutation WebUpdateEvent($id:ID!,$title:String!,$start:String!,$end:String!,$location:String,$notes:String,$color:String,$status:String){updateCalendarEvent(id:$id,title:$title,start:$start,end:$end,location:$location,notes:$notes,color:$color,status:$status){${EVENT_FIELDS}}}`
export const DELETE_EVENT=gql`mutation WebDeleteEvent($id:ID!){deleteCalendarEvent(id:$id)}`
export type ReadOutcome<T>={state:'ready';value:T}|{state:'refused'}|{state:'failed'}
export type LiveEvent={id:string;title:string;start:string;end:string;location:string|null;status:string;notes:string|null;color:string|null}
// What the event form collects. childId is required to create; an edit targets an existing id.
export type EventDraft={title:string;start:string;end:string;location:string|null;notes:string|null;color:string|null;status:string}
export type WriteResult<T>={ok:true;value:T}|{ok:false;reason:'refused'|'failed'}
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
 // Mutations go through the parent-only schedule RPCs. A refusal (non-parent, demo guide) comes
 // back as UNAUTHORIZED and is surfaced as 'refused'; anything else is 'failed'. The caller re-reads
 // the window on success so the new row (shared across tenants) appears.
 async function write<T>(mutation:Parameters<typeof client.mutate>[0]['mutation'],variables:Record<string,string|null>,field:string):Promise<WriteResult<T>>{
  try{
   const value=await runRead(async()=>{const result=await client.mutate<Record<string,T>>({mutation,variables});if(!result.data||result.data[field]===undefined)throw Error('WRITE_UNAVAILABLE');return result.data[field]})
   if(getGeneration()!==generation)throw Error('SESSION_CHANGED')
   return {ok:true,value}
  }catch(error){
   if(getGeneration()!==generation)throw Error('SESSION_CHANGED')
   const e=error as {message?:string;errors?:{extensions?:{code?:string}}[]}
   return /UNAUTHORIZED/.test(e.message??'')||e.errors?.some(x=>x.extensions?.code==='UNAUTHORIZED')?{ok:false,reason:'refused'}:{ok:false,reason:'failed'}
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
 // A parent may drag to move/resize; caregivers and read-only personas may not.
 // There is no move/resize mutation here (reads only), so a parent's drag is still
 // reverted and shown as "not saved" by the view - never a silent fake save.
 return {mode:'live' as const,scope:session.scope,parent:session.persona.parent===true,readWindow,
  createEvent:(childId:string,draft:EventDraft):Promise<WriteResult<LiveEvent>>=>write<LiveEvent>(CREATE_EVENT,{childId,...draft},'createCalendarEvent'),
  updateEvent:(id:string,draft:EventDraft):Promise<WriteResult<LiveEvent>>=>write<LiveEvent>(UPDATE_EVENT,{id,...draft},'updateCalendarEvent'),
  deleteEvent:(id:string):Promise<WriteResult<string>>=>write<string>(DELETE_EVENT,{id},'deleteCalendarEvent'),
  knownEvent:(id:string)=>events.get(id),knownChild:(id:string)=>eventChildren.get(id),getActionScope:()=>actionScope,subscribe:(notify:()=>void)=>{listeners.add(notify);return()=>{listeners.delete(notify)}},clear(){events.clear();eventChildren.clear();actionScope.calendarChildIds.clear();publish()}}
}
