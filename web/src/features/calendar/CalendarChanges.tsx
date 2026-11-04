import {gql} from '@apollo/client'
import {useCallback} from 'react'
import {useChildAccess} from '@/features/personas/childContext'
import {useSession} from '@/features/personas/Session'
import {useCachedResource} from '@/lib/frontendData/resourceCache'
import {calendarWallLabel} from '@/features/rosina/CalendarChangeCard'
import {formatInstant} from './time'
const CHANGES=gql`query WebCalendarChanges($childId:ID!){calendarChanges(childId:$childId){id at actor{id displayName} kind eventId title start}}`
type Change={id:string;at:string;actor:{id:string;displayName:string};kind:string;eventId:string;title:string;start:string}
/** Both surfaces project the committed village_event rows, never chat proposals. */
export function CalendarChanges({summary=false}:{summary?:boolean}){
 const child=useChildAccess(),{session}=useSession()
 const client=child?.client??null,childId=child?.selectedChildId??session?.scope.childId
 const permitted=!!(session?.persona.parent||session?.persona.guardian||session?.marks?.demoGuide)
 const load=useCallback(async()=>{
  const result=await child!.runRead(()=>client!.query<{calendarChanges:Change[]}>({query:CHANGES,variables:{childId},fetchPolicy:'network-only'}))
  if(!result.data)throw Error('Calendar changes unavailable')
  return result.data.calendarChanges
 },[client,childId,child?.runRead])
 const snapshot=useCachedResource(permitted?client:null,`calendar-changes:${childId}`,load,750)
 if(!permitted||!client)return null
 if(snapshot?.error)return <section aria-label="Calendar changes"><p role="status">Calendar changes could not be refreshed.</p></section>
 const changes=snapshot?.value??[]
 if(!changes.length)return null
 return <section className="activity-day" aria-label="Calendar changes"><h2 className="activity-day-head">Calendar changes</h2>
 {summary&&<p>{changes.length===100?'100+':changes.length} recorded calendar changes</p>}
 <div className="activity-cards">{changes.slice(0,summary?3:100).map(change=><article key={change.id} className="activity-card"><div className="activity-card-body"><strong>Calendar · {change.actor.displayName} {change.kind==='CALENDAR_EVENT_CREATED'?'added':change.kind==='CALENDAR_EVENT_UPDATED'?'updated':'cancelled'} {change.title}</strong><p>{calendarWallLabel(change.start)} · America/Detroit</p><a href={`#/calendar?childId=${encodeURIComponent(childId!)}&day=${change.start.slice(0,10)}`}>Open Family Calendar</a></div><time className="activity-card-time" dateTime={change.at}>{formatInstant(change.at)}</time></article>)}</div></section>
}
