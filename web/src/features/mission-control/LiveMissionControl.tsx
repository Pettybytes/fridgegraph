import {RouteSkeleton} from '@/app/RouteSkeleton'
import {useState} from 'react'
import type {ReactNode} from 'react'
import {useSurfaceData,useDataContext,dataErrorMessage} from '@/lib/frontendData/provider'
import type {StoredMissionControl,StoredRun} from '@/lib/frontendData/deliveredAdapter'
import {useSession} from '@/features/personas/Session'
import {formatRecordedTime,contactBadge} from './v2/model'
import {pickupStatusLabel,contactChannelLabel} from '@/lib/frontendData/displayCopy'
import {reasonLabel} from '@/lib/frontendData/types'
import {MissionControlV2} from './v2/MissionControlV2'
import {VillagePulse} from './pulse/VillagePulse'
import './v2/mission-control-v2.css'
const title:Record<string,string>={JOB_CREATED:'Pickup request recorded',ATTEMPT_OPENED:'Outreach recorded',ATTEMPT_CLOSED:'Contact attempt ended',COST_CALCULATED:'Travel estimate recorded',CONFIRMATION:'Parent approval recorded'}
export function LiveMissionControl({accessDenied}:{accessDenied:ReactNode}){
 const result=useSurfaceData<StoredMissionControl>('mission-control'),{session}=useSession()
 const [sample,setSample]=useState(false),[selected,setSelected]=useState('')
 if(sample)return <section><p className="persona-mock">Sample scenario · fictional replay, not this perspective’s live run</p><button onClick={()=>setSample(false)}>Back to live pickup records</button><MissionControlV2 accessDenied={accessDenied}/></section>
 const data=result.data?.frontendSnapshot,runs=data?.recordedRuns??[],run=runs.find(r=>r.job.id===selected)??runs[0]
 return <section className="mcv" aria-label="Mission Control live records" data-state="live" data-execution-state="unavailable"><div className="mcv-scenarios"><strong>Live data · stored demo records</strong><button onClick={()=>setSample(true)}>View sample scenario</button></div>
 {/* Live read provenance does not prove dispatch. No execution-source field is delivered. */}
 <p className="mcv-missing">Sample activity from stored demo records. Calls and texts are simulated in this example; sending isn’t verified here.</p>
 {session?.marks?.demoGuide&&<p className="mcv-missing">Demo guide is read-only</p>}
 <VillagePulse result={result}/>
 {result.loading&&!data?<RouteSkeleton />:result.error?/UNAUTHORIZED/.test(result.error.message)?accessDenied:<p role="alert">{dataErrorMessage(result.error)}</p>:!run?<div className="mcv-empty"><h2>No recorded pickup run</h2><p>No records are available to this view</p>{!(session?.persona.parent||session?.marks?.demoGuide)&&accessDenied}</div>:<>
 <label>Pickup record<select aria-label="Pickup record" value={run.job.id} onChange={e=>setSelected(e.target.value)}>{runs.map((r,i)=><option key={r.job.id} value={r.job.id}>Pickup {i+1} · {pickupStatusLabel(r.job.status)}</option>)}</select></label>
 <header className="mcv-job"><div><p>{run.timeline.length?'Sample activity':'Pickup record · event times not recorded'}</p><h2>{session?.scope.childName.split(' ')[0]}’s pickup</h2><p>{pickupStatusLabel(run.job.status)}</p></div></header>
 <div className="mcv-lane-grid">{run.attempts.map(a=><article key={a.id} className="mcv-lane"><h3>{a.candidate?.displayName??'Caregiver not recorded'}</h3><span className="mcv-contact">{contactBadge(a.destinationMode)}</span><p>{contactChannelLabel(a.channel)}</p><time dateTime={a.at}>{formatRecordedTime(a.at)}</time><p>{a.closedAt?'Attempt ended · see recorded activity':'Attempt open · no reply recorded'}</p>{a.closedAt&&<time dateTime={a.closedAt}>{formatRecordedTime(a.closedAt)}</time>}</article>)}</div>
 <section className="mcv-decision"><h3>Current caregiver information</h3>{!run.job.candidateEvaluations.length&&<p>No caregiver evaluation has been recorded.</p>}{run.job.candidateEvaluations.map(e=><p key={e.candidate.id}>{e.candidate.displayName}: {reasonLabel(e.reasonCode)}. {e.available===true?'Available':e.available===false?'Not available':'Availability not recorded'}.</p>)}</section>
 <LiveApproval run={run} canApprove={Boolean(session?.persona.parent&&!session?.marks?.demoGuide)} refetch={()=>{void result.refetch()}}/>
 <section className="mcv-timeline"><h3>Recorded activity</h3>{!run.timeline.length?<p>Event times not recorded.</p>:<ol>{run.timeline.map((e,i)=><li key={`${e.at}:${e.kind}:${i}`}><time dateTime={e.at}>{formatRecordedTime(e.at)}</time><div><h4>{title[e.kind]??'Recorded activity'}</h4>{e.candidate&&<p>{e.candidate.displayName}</p>}{e.kind==='ATTEMPT_OPENED'&&<p>{contactChannelLabel(e.detail??'Unknown')}</p>}{e.kind==='ATTEMPT_CLOSED'&&<p>Contact attempt ended. No decline is inferred from silence.</p>}</div></li>)}</ol>}</section>
 </>}
 </section>
}

/** The parent's one-tap approval for a LIVE job awaiting it. Two deliberate taps (review, then
 * confirm) and the approval is recorded through the graph's own parent-gated mutation; the
 * polling read shows the confirmation within one cycle. Approval is never a completed pickup. */
function LiveApproval({run,canApprove,refetch}:{run:StoredRun;canApprove:boolean;refetch:()=>void}){
 const {adapter,scope}=useDataContext()
 const [phase,setPhase]=useState<'idle'|'review'|'busy'|'done'|'failed'>('idle')
 if(!adapter.approvePickup)return null
 if(run.job.status!=='awaiting_approval'&&phase!=='done')return null
 const recommended=run.job.candidateEvaluations.find(e=>e.available===true)??run.job.candidateEvaluations[0]
 async function approve(){
  if(!adapter.approvePickup)return
  setPhase('busy')
  try{await adapter.approvePickup(scope,{jobId:run.job.id,version:run.job.version,decision:'APPROVED'});setPhase('done');refetch()}
  catch{setPhase('failed')}
 }
 return <aside className="mcv-decision" aria-label="Parent decision">
  <h3>Parent approval</h3>
  {phase==='done'?<><strong>Approval recorded.</strong><p>Approval is a decision record. The pickup itself is a separate fact with its own record.</p></>:<>
  <p>{recommended?`${recommended.candidate.displayName} is the recorded option for this pickup.`:'This request is waiting for your decision.'} Nothing is arranged until you approve.</p>
  {!canApprove&&<p>Only this child's parent can approve.</p>}
  {phase==='idle'&&<button type="button" className="mcv-primary" disabled={!canApprove} onClick={()=>setPhase('review')}>Review and approve</button>}
  {phase==='review'&&<><p>Approving records your decision{recommended?` for ${recommended.candidate.displayName}`:''}. It does not contact anyone and does not mark the pickup done.</p><button type="button" className="mcv-primary" onClick={()=>{void approve()}}>Confirm approval</button> <button type="button" className="mcv-secondary" onClick={()=>setPhase('idle')}>Back</button></>}
  {phase==='busy'&&<p role="status">Recording your approval…</p>}
  {phase==='failed'&&<p role="alert">That approval did not go through. Nothing was recorded. Try again in a moment.</p>}
  </>}
 </aside>
}
