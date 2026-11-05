import {useEffect,useId,useMemo,useRef,useState} from 'react'
import {ImagePlus,Upload,X} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {useSession} from '@/features/personas/Session'
import {createMockNoticeAdapter,noticeErrorMessage} from './mockAdapter'
import {createLiveNoticeAdapter} from './liveAdapter'
import {noticeInput,fileTypes} from './input'
import {sampleFile} from './samples'
import {announceNoticeConfirmed,onNoticeSampleRequest} from './sampleSignal'
import {NoticeReview} from './NoticeReview'
import {NoticeFailure,type NoticeAdapter,type NoticeConfirmResult,type NoticeProposal,type NoticeRequest} from './types'
import './notice-plan.css'

type CleanupRegistration=(clear:()=>void)=>()=>void
// Live selection remains explicitly gated until the merged endpoint is verified served.
const deployedNoticeEnabled=import.meta.env.VITE_NOTICE_PLAN_LIVE==='true'
export function NoticeComposer(){
 const {session,registerPrivateCleanup,getCurrentSession,authMode}=useSession()
 const adapter=useMemo(()=>deployedNoticeEnabled&&authMode==='live'&&session?.accessToken
  ?createLiveNoticeAdapter(()=>getCurrentSession()?.accessToken)
  :createMockNoticeAdapter(session?.scope.childName??'',session?.persona.personId,session?.persona.parent===true||session?.persona.guardian===true),[session?.generation,session?.scope.childId,authMode,getCurrentSession])
 if(!session)return null
 return <NoticeDraftBoundary ownerKey={`${session.generation}:${session.persona.personId}:${session.scope.childId}`} registerCleanup={registerPrivateCleanup} adapter={adapter} childId={session.scope.childId} canConfirm={session.persona.parent===true||session.persona.guardian===true} readOnly={(session.marks?.demoGuide===true&&!session.marks.showcaseEditor)}/>
}
export function NoticeDraftBoundary({ownerKey,...props}:{ownerKey:string;registerCleanup:CleanupRegistration;adapter?:NoticeAdapter;childId?:string;canConfirm?:boolean;readOnly?:boolean}){
 // A new owner mounts empty synchronously, before effects; no previous-child draft frame.
 return <LocalNoticeDraft key={ownerKey} {...props}/>
}
function LocalNoticeDraft({registerCleanup,adapter,childId,canConfirm=false,readOnly=false}:{registerCleanup:CleanupRegistration;adapter?:NoticeAdapter;childId?:string;canConfirm?:boolean;readOnly?:boolean}){
 const [text,setText]=useState(''),[files,setFiles]=useState<File[]>([]),[dragging,setDragging]=useState(false),[samples,setSamples]=useState(false)
 const input=useRef<HTMLInputElement>(null),details=useRef<HTMLDetailsElement>(null),id=useId()
 const [busy,setBusy]=useState(false),[confirming,setConfirming]=useState(false),[confirmed,setConfirmed]=useState<NoticeConfirmResult|null>(null),[confirmBlocked,setConfirmBlocked]=useState(false),[proposal,setProposal]=useState<NoticeProposal|null>(null),[submittedText,setSubmittedText]=useState<string|null>(null),[error,setError]=useState('')
 const abort=useRef<AbortController|null>(null),revision=useRef(0),alive=useRef(true)
 const [loadingSample,setLoadingSample]=useState(false)
 function invalidate(){++revision.current;abort.current?.abort();setBusy(false);setConfirming(false);setConfirmed(null);setConfirmBlocked(false);setLoadingSample(false);setProposal(null);setSubmittedText(null);setError('')}
 function chooseFiles(values:File[]){invalidate();setFiles(values)}
 async function chooseSample(){
  invalidate();const controller=new AbortController();abort.current=controller;const owner=revision.current
  setLoadingSample(true)
  try{const file=await sampleFile(controller.signal);if(alive.current&&revision.current===owner&&!controller.signal.aborted){setText('');chooseFiles([file])}}
  catch{if(alive.current&&revision.current===owner&&!controller.signal.aborted)setError('Couldn’t load the sample just now.')}
  finally{if(alive.current&&revision.current===owner)setLoadingSample(false)}
 }
 // Card 1 deep-link: stage the authorized Nora sample and run the SAME review a judge clicks by
 // hand (open draft → sample → review). The explicit Confirm still stays the parent's decision.
 async function stageSampleAndReview(){
  if(!adapter||childId!=='p_nora'||busy||confirming||loadingSample)return
  invalidate();const controller=new AbortController();abort.current=controller;const owner=revision.current
  setSamples(true);setLoadingSample(true)
  let file:File|null=null
  try{file=await sampleFile(controller.signal)}
  catch{if(alive.current&&revision.current===owner&&!controller.signal.aborted)setError('Couldn’t load the sample just now.')}
  finally{if(alive.current&&revision.current===owner)setLoadingSample(false)}
  if(!file||!alive.current||revision.current!==owner||controller.signal.aborted)return
  setText('');setFiles([file])
  await run(undefined,[file])
 }
 async function run(answer?:string,explicitFiles?:File[]){
  if(!adapter||!childId||busy||confirming||loadingSample)return
  const previous=proposal
  const useFiles=explicitFiles??files,useText=explicitFiles?'':text
  const controller=new AbortController();abort.current?.abort();abort.current=controller
  const owner=++revision.current,owns=()=>alive.current&&owner===revision.current&&!controller.signal.aborted
  setBusy(true);setError('');setConfirmed(null);setConfirmBlocked(false)
  try{
   if(!answer&&(useText&&useFiles.length||useFiles.length>1)){setError('Choose pasted text or one file for this review.');return}
   const notice=await noticeInput(useText,useFiles,controller.signal)
   const request:NoticeRequest=answer&&previous?{childId,notice,resume:{proposalId:previous.proposalId,version:previous.version,answer}}:{childId,notice}
   if(!owns())return
   setSubmittedText(request.notice.kind==='text'?request.notice.text:null)
   const result=await adapter.prepare(request,controller.signal)
   if(!owns())return
   if(result.childId!==childId)throw new NoticeFailure('UNAUTHORIZED')
   if(request.resume&&(result.proposalId!==request.resume.proposalId||result.version<=request.resume.version))throw new NoticeFailure('INVALID_PROPOSAL')
   setProposal(result)
  }catch(e){if(owns())setError(noticeErrorMessage(e,adapter.mode,'prepare'))}
  finally{if(owns())setBusy(false)}
 }
 async function confirm(){
  if(!adapter||!proposal||!childId||!canConfirm||readOnly||busy||confirming||confirmed||confirmBlocked)return
  const action=proposal.changes.find(change=>'action' in change.onConfirm)?.onConfirm
  if(!action||!('action' in action)||action.action!=='requestPickup'||proposal.childId!==childId||proposal.claims.action!==action.action||JSON.stringify(proposal.claims.params)!==JSON.stringify(action.params))return
  const controller=new AbortController();abort.current?.abort();abort.current=controller
  const owner=++revision.current,owns=()=>alive.current&&owner===revision.current&&!controller.signal.aborted
  setConfirming(true);setError('')
  try{
   const result=await adapter.confirm(proposal,controller.signal)
   if(!owns())return
   if(!result.job.id)throw new NoticeFailure('INVALID_PROPOSAL')
   setConfirmed(result)
   // Report the server's recorded pickup to the Today judge card. A job id is a non-secret
   // record identifier; mode tells the card whether a real record exists (live) or not (mock).
   announceNoticeConfirmed({childId,jobId:result.job.id,status:result.job.status,mode:adapter.mode})
  }catch(e){if(owns()){setError(noticeErrorMessage(e,adapter.mode,'confirm'));if(e instanceof NoticeFailure&&['INVALID_PROPOSAL','PROPOSAL_EXPIRED','PROPOSAL_STALE','NO_ACTION_AVAILABLE','UNAUTHORIZED','UNAUTHENTICATED'].includes(e.code))setConfirmBlocked(true)}}
  finally{if(owns())setConfirming(false)}
 }
 function clear(){invalidate();setText('');setFiles([]);setDragging(false);setSamples(false);if(input.current)input.current.value=''}
 useEffect(()=>{alive.current=true;const unregister=registerCleanup(clear);return()=>{alive.current=false;++revision.current;abort.current?.abort();unregister()}},[registerCleanup])
 // Serve a staged-sample request from the Today judge card. Latest render's staging closure runs.
 const stageRef=useRef(()=>{})
 stageRef.current=()=>{if(details.current)details.current.open=true;void stageSampleAndReview()}
 useEffect(()=>onNoticeSampleRequest(()=>stageRef.current()),[])
 return <details ref={details} className="notice-draft" aria-label="Notice draft">
  <summary><ImagePlus size={18} aria-hidden="true"/><span>Add a notice</span><strong>{adapter?.mode==='live'?'Live':'Mock'}</strong></summary>
  <div className="notice-draft-body">
   <Button type="button" variant="ghost" className="notice-control" onClick={event=>{const details=event.currentTarget.closest('details');if(details){details.open=false;details.querySelector('summary')?.focus()}}}>Close notice</Button>
   <p className="notice-local-note">{adapter?.mode==='live'?'Reviewing sends the notice securely. Nothing changes until you confirm.':'Local draft only. Nothing is uploaded or created.'}</p>
   <div className={`notice-drop ${dragging?'is-dragging':''}`} onDragOver={event=>{event.preventDefault();event.stopPropagation();setDragging(true)}} onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setDragging(false)}} onDrop={event=>{event.preventDefault();event.stopPropagation();setDragging(false);chooseFiles(Array.from(event.dataTransfer.files))}}>
    <Upload size={22} aria-hidden="true"/><p>Drop a notice here</p>
    <Button type="button" variant="outline" className="notice-control" onClick={()=>input.current?.click()}>Choose notice files</Button>
    <input ref={input} id={`${id}-files`} type="file" multiple accept={adapter?fileTypes:undefined} hidden aria-label="Choose notice files locally" onChange={event=>chooseFiles(Array.from(event.target.files??[]))}/>
    <small>{adapter?`PNG, JPEG, WebP or PDF · up to 8 MB. ${adapter.mode==='live'?'Review before any change.':'Mock review only.'}`:'File support is not available yet. Selected files stay in this draft.'}</small>
   </div>
   {files.length>0&&<ul className="notice-files" aria-label="Files selected locally">{files.map((file,index)=><li key={index}><span>{file.name}</span><Button type="button" variant="ghost" className="notice-control" aria-label={`Remove ${file.name}`} onClick={()=>{invalidate();setFiles(items=>items.filter((_,i)=>i!==index));if(input.current)input.current.value=''}}><X size={16} aria-hidden="true"/></Button></li>)}</ul>}
   <label htmlFor={`${id}-text`}>Or paste notice text</label>
   <textarea id={`${id}-text`} value={text} onChange={event=>{invalidate();setText(event.target.value)}} rows={3} placeholder="Paste the notice here"/>
   <Button type="button" variant="ghost" className="notice-control" aria-expanded={samples} aria-controls={`${id}-samples`} onClick={()=>setSamples(value=>!value)}>Try a sample</Button>
   {samples&&<section id={`${id}-samples`} className="notice-samples" aria-label="Sample notices">{adapter&&childId==='p_nora'?<><Button type="button" variant="outline" className="notice-control" disabled={loadingSample||busy} onClick={()=>void chooseSample()}>Use early dismissal notice (PNG)</Button><p>Fictional notice · October 26 · 12:30 PM dismissal</p></>:<p>{adapter?'No sample is available for this perspective yet.':'Sample notices aren’t available yet.'}</p>}</section>}
   <p id={`${id}-pending`}>{adapter?`Pasted text: up to 20,000 characters. ${adapter.mode==='live'?'Review is read-only until confirmation.':'No real records are created.'}`:'Notice review isn’t connected yet.'}</p>
   {loadingSample&&<p role="status">Loading sample…</p>}{busy&&<p role="status">Reviewing {adapter?.mode==='live'?'notice':'mock notice'}…</p>}{confirming&&<p role="status">Checking {adapter?.mode==='live'?'pickup request':'mock pickup request'}…</p>}{error&&<p role="alert">{error}</p>}
   {proposal&&<NoticeReview key={`${proposal.proposalId}:${proposal.version}`} proposal={proposal} mode={adapter?.mode??'mock'} submittedText={submittedText} busy={busy||confirming} canConfirm={canConfirm&&!readOnly} confirmDisabled={confirmBlocked} confirmed={confirmed} onConfirm={()=>void confirm()} onAnswer={answer=>void run(answer)}/>}
   <div className="notice-draft-actions"><Button type="button" className="notice-control" disabled={!adapter||busy||loadingSample||(!text.trim()&&!files.length)} onClick={()=>void run()} aria-describedby={`${id}-pending`}>Review notice</Button><Button type="button" variant="ghost" className="notice-control" disabled={!text&&!files.length} onClick={clear}>Clear draft</Button></div>
  </div>
 </details>
}
