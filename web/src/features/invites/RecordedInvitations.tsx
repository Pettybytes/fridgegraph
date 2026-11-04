import { gql } from '@apollo/client'
import { useEffect, useState } from 'react'
import { useChildAccess } from '@/features/personas/childContext'
import { addDays, localDay, formatInstant } from '@/features/calendar/time'
import { Surface } from '@/components/fg/primitives'
const RECORDS = gql`query WebRecordedInvitations($childId: ID!, $from: String!, $to: String!) {
 coordinationJobs(childId: $childId) { id type status }
 childEvents(childId: $childId, from: $from, to: $to) { id title start end location }
}`
type Records = { coordinationJobs: {id:string;type:string;status:string}[]; childEvents:{id:string;title:string;start:string;end:string;location:string|null}[] }
export function RecordedInvitations() {
 const access=useChildAccess(), [records,setRecords]=useState<Records|null>(null),[failed,setFailed]=useState(false)
 useEffect(()=>{
  if(!access?.client)return
  let active=true
  const from=addDays(localDay(Date.now()),-30),to=addDays(from,90)
  void access.runRead(()=>access.client!.query<Records>({query:RECORDS,variables:{childId:access.selectedChildId,from,to},fetchPolicy:'no-cache'}))
   .then(result=>{if(active&&result.data)setRecords(result.data)},()=>{if(active)setFailed(true)})
  return()=>{active=false}
 },[access?.client,access?.selectedChildId,access?.runRead])
 if(failed)return <p role="alert">Couldn't load invitation records. Try opening this page again.</p>
 if(!records)return <p role="status">Loading recorded invitations…</p>
 const invitations=records.coordinationJobs.filter(job=>job.type==='INVITATION')
 const gatherings=records.childEvents.filter(event=>/party|birthday|celebration|reunion|shower/i.test(event.title))
 return <Surface role="region" aria-label="Recorded invitations" className="invites-panel">
  <h2>Recorded invitations for {access?.selectedChildName}</h2>
  <p>Viewing another showcase family. Select Nora, Max or Leo to prepare an invitation.</p>
  {invitations.length?<ul>{invitations.map(job=><li key={job.id}>Invitation {job.id}: {job.status.replaceAll('_',' ')}</li>)}</ul>:<p>No invitation requests have been recorded.</p>}
  <h3>Gatherings on the calendar</h3>
  <p>These are scheduled events. An event is not proof that an invitation was sent.</p>
  {gatherings.length?<ul>{gatherings.map(event=><li key={event.id}><strong>{event.title}</strong><p>{formatInstant(event.start,event.end)}{event.location?` · ${event.location}`:''}</p><a href={`#/calendar?eventId=${encodeURIComponent(event.id)}&childId=${encodeURIComponent(access!.selectedChildId)}`}>View calendar event</a></li>)}</ul>:<p>No gatherings are recorded in this date range.</p>}
 </Surface>
}
