import {formatTime,localDay} from '@/features/calendar/time'
import type {StoredMissionControl} from '@/lib/frontendData/deliveredAdapter'
import type {SchoolReport} from './schoolReports'
export type Entry={id:string;at:string;day:string;kind:'PROPOSED'|'APPROVED'|'DECLINED'|'SIMULATED'|'REPORTED'|'RECORDED'|'CONFIRMED';who:string;what:string;href?:string;place?:string}
export type Slip={id:string;title:string;history:{decision:string;at:string;approver:{id:string}}[]}
export function activityEntries(data:StoredMissionControl,slips:Slip[],people:Record<string,string>={},reports:SchoolReport[]=[]):Entry[]{
 const entries:Entry[]=[]
 const add=(entry:Omit<Entry,'day'>)=>{if(Number.isFinite(Date.parse(entry.at)))entries.push({...entry,day:localDay(entry.at)})}
 for(const run of data.recordedRuns){
  const attempts=new Map(run.attempts.map(a=>[a.id,a]))
  for(const [index,moment] of run.timeline.entries()){
   const person=moment.candidate?.displayName??'Caregiver not recorded',attempt=moment.attemptId?attempts.get(moment.attemptId):undefined
   const base={id:`job:${run.job.id}:${index}`,at:moment.at,href:'#/mission-control',place:'Mission Control'}
   if(moment.kind==='JOB_CREATED')add({...base,kind:'PROPOSED',who:'Creator not recorded',what:'Pickup coordination job created. A plan is not yet a decision.'})
   if(moment.kind==='ATTEMPT_OPENED')add({...base,kind:attempt?.destinationMode==='TEST_RESPONDER'?'SIMULATED':'RECORDED',who:person,what:attempt?.destinationMode==='TEST_RESPONDER'?`${moment.detail??'Outreach'} simulated with a test responder. Notified does not mean delivered.`:`${moment.detail??'Outreach'} attempt recorded. Delivery is not verified.`})
   if(moment.kind==='ATTEMPT_CLOSED')add({...base,kind:'RECORDED',who:person,what:moment.detail==='TIMEOUT'?'No reply in time was recorded.':moment.detail==='NO_ANSWER'?'No answer was recorded.':'Contact attempt ended. The outcome is not recorded here.'})
   if(moment.kind==='CONFIRMATION')add({...base,kind:'CONFIRMED',who:person,what:'A confirmation was recorded.'})
  }
 }
 for(const slip of slips)for(const [index,decision] of slip.history.entries()){
  const kind=decision.decision.toUpperCase()
  if(kind==='APPROVED'||kind==='DECLINED')add({id:`consent:${slip.id}:${index}`,at:decision.at,kind,who:people[decision.approver.id]??'Parent',what:`${slip.title}: ${kind.toLowerCase()} by explicit decision.`,href:'#/calendar',place:'Consent'})
 }
 for(const report of reports){
  const day=/^\d{4}-\d{2}-\d{2}$/.test(report.at)?report.at:null
  if(!day)continue
  const precise=report.reportedAt&&Number.isFinite(Date.parse(report.reportedAt))?report.reportedAt:null
  entries.push({id:`school:${report.id}`,at:precise??day,day,kind:'REPORTED',who:'School report',what:report.text})
 }
 return entries.sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))
}
export function localMoment(at:string){return /^\d{4}-\d{2}-\d{2}$/.test(at)?'Time not recorded':formatTime(at,true)}

export function mayReadFamilyActivity(parent:boolean,guardian:boolean){return parent||guardian}
export function orbitStatusCopy(status:{status:string|null;closeOutcome?:string|null;thankyou?:string|null}){return status.status==='CLOSED'&&status.closeOutcome==='FOUND_SAFE'?'Found safe. '+(status.thankyou??'Thank you.'):status.status==='ACTIVE'?'Alert active. Notified does not mean delivered.':'No active alert recorded.'}
