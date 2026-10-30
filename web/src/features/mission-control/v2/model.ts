import { CALENDAR_ZONE, dayHours, localDay } from '@/features/calendar/time'
import data from '@/lib/frontendData/mock-data.json'
import lifecycle from '../../../../../docs/mocks/pickup-job-lifecycle.json'
import candidates from '../../../../../docs/mocks/pickup-candidates.json'
export type ContactMode='TEST_RESPONDER'|'REAL_CONSENTED'|'SIMULATED'
export const contactBadge=(mode:ContactMode|null)=>mode==='REAL_CONSENTED'?'Real call (consented)':mode==='TEST_RESPONDER'?'Test responder':mode==='SIMULATED'?'Simulated':'Contact mode not recorded'
export type LaneState='Not contacted yet'|'Waiting for reply'|'Available'|'Available, no car'|'Declined'|'No answer'
export type ReplayEvent={id:string;at:string;title:string;detail:string;candidateId?:string;state?:LaneState}
const copy:Record<string,Omit<ReplayEvent,'id'|'at'>>={
 mc_0001:{title:'Pickup request received',detail:'Rosina is coordinating Nora’s afternoon pickup.'},
 mc_0002:{title:'Four caregivers contacted together',detail:'One call and three texts went to test responders. Replies are considered independently.'},
 mc_0003:{title:'Loretta’s response evaluated',detail:'She is available, but has no car for this pickup.',candidateId:'p_gma',state:'Available, no car'},
 mc_0004:{title:'Bryan’s response evaluated',detail:'Bryan replied that he is busy.',candidateId:'p_bryan',state:'Declined'},
 mc_0005:{title:'No answer from Monique',detail:'System observation: no reply arrived within the response window. This is not a decline.',candidateId:'p_monique',state:'No answer'},
 mc_0006:{title:'Tasha is ready for parent review',detail:'She replied that she is available. Rosina’s recorded recommendation is Tasha; Kendra’s approval is still needed.',candidateId:'p_tasha',state:'Available'},
}
// DERIVED from recorded mock facts. View keys map to those exact records; no invented event time.
export const recordedEvents:ReplayEvent[]=data.missionControl.events.filter(e=>copy[e.id]).map(e=>({id:e.id,at:e.at,...copy[e.id]})).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at))
export const recordedApproval=data.missionControl.events.find(e=>e.kind==='confirmation')!
export const paidRide=lifecycle.overLimitPath
export const normalCandidates=data.missionControl.candidates
export function lanesAt(index:number){
 const shown=recordedEvents.slice(0,index+1)
 return normalCandidates.map(c=>{
  const result=shown.filter(e=>e.candidateId===c.id).at(-1)
  const sent=shown.find(e=>e.id==='mc_0002')
  return {...c,state:result?.state??(sent?'Waiting for reply':'Not contacted yet'),at:result?.at??sent?.at??null,attempt:sent?{channel:c.channel,at:sent.at,mode:'TEST_RESPONDER' as ContactMode}:null}
 })
}
export function recommendationFacts(){
 const person=candidates.data.pickupCandidates.find(c=>c.person.id==='p_tasha')
 const evaluation=lifecycle.candidateEvaluations.find(c=>c.person.id==='p_tasha')
 return {authorized:person?.authorization==='AUTHORIZED',available:evaluation?.acceptedVia==='WEBHOOK_CALLBACK'&&evaluation.reasonCode==='APPROVAL_PENDING',hasTransport:lifecycle.candidateEvaluations.some(c=>c.person.id==='p_gma'&&c.note.includes('Tasha drives')),distance:normalCandidates.find(c=>c.id==='p_tasha')?.distanceMiles??null}
}

// Include seconds so simultaneous dispatch and later evaluations remain visibly distinguishable.
export function formatRecordedTime(at:string){return new Intl.DateTimeFormat('en-US',{timeZone:CALENDAR_ZONE,hour:'numeric',minute:'2-digit',second:'2-digit',hour12:true,...(dayHours(localDay(at))!==24?{timeZoneName:'short' as const}:{})}).format(new Date(at))}
