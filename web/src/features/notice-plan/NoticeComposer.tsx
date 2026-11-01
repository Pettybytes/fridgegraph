import {useEffect,useId,useMemo,useRef,useState} from 'react'
import {FileText,Upload,X} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {useSession} from '@/features/personas/Session'
import {createMockNoticeAdapter,noticeErrorMessage} from './mockAdapter'
import {noticeInput,fileTypes} from './input'
import {sampleFile} from './samples'
import {NoticeReview} from './NoticeReview'
import {NoticeFailure,type NoticeAdapter,type NoticeProposal,type NoticeRequest} from './types'
import './notice-plan.css'

type CleanupRegistration=(clear:()=>void)=>()=>void
// Stable prepare/review sections use a local mock. Confirm remains unwired until its
// full onConfirm envelope mapping is published; no real notice endpoint is called.
export function NoticeComposer(){
 const {session,registerPrivateCleanup}=useSession()
 const adapter=useMemo(()=>createMockNoticeAdapter(session?.scope.childName??''),[session?.generation,session?.scope.childId])
 if(!session)return null
 return <NoticeDraftBoundary ownerKey={`${session.generation}:${session.persona.personId}:${session.scope.childId}`} registerCleanup={registerPrivateCleanup} adapter={adapter} childId={session.scope.childId}/>
}
export function NoticeDraftBoundary({ownerKey,...props}:{ownerKey:string;registerCleanup:CleanupRegistration;adapter?:NoticeAdapter;childId?:string}){
 // A new owner mounts empty synchronously, before effects; no previous-child draft frame.
 return <LocalNoticeDraft key={ownerKey} {...props}/>
}
function LocalNoticeDraft({registerCleanup,adapter,childId}:{registerCleanup:CleanupRegistration;adapter?:NoticeAdapter;childId?:string}){
 const [text,setText]=useState(''),[files,setFiles]=useState<File[]>([]),[dragging,setDragging]=useState(false),[samples,setSamples]=useState(false)
 const input=useRef<HTMLInputElement>(null),id=useId()
 const [busy,setBusy]=useState(false),[proposal,setProposal]=useState<NoticeProposal|null>(null),[submittedText,setSubmittedText]=useState<string|null>(null),[error,setError]=useState('')
 const abort=useRef<AbortController|null>(null),revision=useRef(0),alive=useRef(true)
 const [loadingSample,setLoadingSample]=useState(false)
 function invalidate(){++revision.current;abort.current?.abort();setBusy(false);setLoadingSample(false);setProposal(null);setSubmittedText(null);setError('')}
 function chooseFiles(values:File[]){invalidate();setFiles(values)}
 async function chooseSample(){
  invalidate();const controller=new AbortController();abort.current=controller;const owner=revision.current
  setLoadingSample(true)
  try{const file=await sampleFile(controller.signal);if(alive.current&&revision.current===owner&&!controller.signal.aborted){setText('');chooseFiles([file])}}
  catch{if(alive.current&&revision.current===owner&&!controller.signal.aborted)setError('Couldn’t load the sample just now.')}
  finally{if(alive.current&&revision.current===owner)setLoadingSample(false)}
 }
 async function run(answer?:string){
  if(!adapter||!childId||busy||loadingSample)return
  const previous=proposal
  const controller=new AbortController();abort.current?.abort();abort.current=controller
  const owner=++revision.current,owns=()=>alive.current&&owner===revision.current&&!controller.signal.aborted
  setBusy(true);setError('')
  try{
   if(!answer&&(text&&files.length||files.length>1)){setError('Choose pasted text or one file for this review.');return}
   const request:NoticeRequest=answer&&previous?{childId,resume:{proposalId:previous.proposalId,version:previous.version,answer}}:{childId,notice:await noticeInput(text,files,controller.signal)}
   if(!owns())return
   if('notice' in request)setSubmittedText(request.notice.kind==='text'?request.notice.text:null)
   const result=await adapter.prepare(request,controller.signal)
   if(!owns())return
   if(result.childId!==childId)throw new NoticeFailure('UNAUTHORIZED')
   if('resume' in request&&(result.proposalId!==request.resume.proposalId||result.version<=request.resume.version))throw new NoticeFailure('INVALID_PROPOSAL')
   setProposal(result)
  }catch(e){if(owns())setError(noticeErrorMessage(e))}
  finally{if(owns())setBusy(false)}
 }
 function clear(){invalidate();setText('');setFiles([]);setDragging(false);setSamples(false);if(input.current)input.current.value=''}
 useEffect(()=>{alive.current=true;const unregister=registerCleanup(clear);return()=>{alive.current=false;++revision.current;abort.current?.abort();unregister()}},[registerCleanup])
 return <details className="notice-draft" aria-label="Notice draft">
  <summary><FileText size={18} aria-hidden="true"/><span>Add a notice</span><strong>Mock</strong></summary>
  <div className="notice-draft-body">
   <p className="notice-local-note">Local draft only. Nothing is uploaded or created.</p>
   <div className={`notice-drop ${dragging?'is-dragging':''}`} onDragOver={event=>{event.preventDefault();event.stopPropagation();setDragging(true)}} onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setDragging(false)}} onDrop={event=>{event.preventDefault();event.stopPropagation();setDragging(false);chooseFiles(Array.from(event.dataTransfer.files))}}>
    <Upload size={22} aria-hidden="true"/><p>Drop a notice here</p>
    <Button type="button" variant="outline" className="notice-control" onClick={()=>input.current?.click()}>Choose notice files</Button>
    <input ref={input} id={`${id}-files`} type="file" multiple accept={adapter?fileTypes:undefined} hidden aria-label="Choose notice files locally" onChange={event=>chooseFiles(Array.from(event.target.files??[]))}/>
    <small>{adapter?'PNG, JPEG, WebP or PDF · up to 8 MB. Mock review only.':'File support is not available yet. Selected files stay in this draft.'}</small>
   </div>
   {files.length>0&&<ul className="notice-files" aria-label="Files selected locally">{files.map((file,index)=><li key={index}><span>{file.name}</span><Button type="button" variant="ghost" className="notice-control" aria-label={`Remove ${file.name}`} onClick={()=>{invalidate();setFiles(items=>items.filter((_,i)=>i!==index));if(input.current)input.current.value=''}}><X size={16} aria-hidden="true"/></Button></li>)}</ul>}
   <label htmlFor={`${id}-text`}>Or paste notice text</label>
   <textarea id={`${id}-text`} value={text} onChange={event=>{invalidate();setText(event.target.value)}} rows={3} placeholder="Paste the notice here"/>
   <Button type="button" variant="ghost" className="notice-control" aria-expanded={samples} aria-controls={`${id}-samples`} onClick={()=>setSamples(value=>!value)}>Try a sample</Button>
   {samples&&<section id={`${id}-samples`} className="notice-samples" aria-label="Sample notices">{adapter&&childId==='p_nora'?<><Button type="button" variant="outline" className="notice-control" disabled={loadingSample||busy} onClick={()=>void chooseSample()}>Use early dismissal notice (PNG)</Button><p>Fictional notice · October 26 · 12:30 PM dismissal</p></>:<p>{adapter?'No sample is available for this perspective yet.':'Sample notices aren’t available yet.'}</p>}</section>}
   <p id={`${id}-pending`}>{adapter?'Pasted text: up to 20,000 characters. No real records are created.':'Notice review isn’t connected yet.'}</p>
   {loadingSample&&<p role="status">Loading sample…</p>}{busy&&<p role="status">Reviewing mock notice…</p>}{error&&<p role="alert">{error}</p>}
   {proposal&&<NoticeReview key={`${proposal.proposalId}:${proposal.version}`} proposal={proposal} submittedText={submittedText} busy={busy} onAnswer={answer=>void run(answer)}/>}
   <div className="notice-draft-actions"><Button type="button" className="notice-control" disabled={!adapter||busy||loadingSample||(!text.trim()&&!files.length)} onClick={()=>void run()} aria-describedby={`${id}-pending`}>Review notice</Button><Button type="button" variant="ghost" className="notice-control" disabled={!text&&!files.length} onClick={clear}>Clear draft</Button></div>
  </div>
 </details>
}
