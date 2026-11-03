import {useEffect,useId,useRef,useState} from 'react'
import {Upload,Image as ImageIcon,Check,X} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {createPinIntakeClient,pinErrorMessage,type PinIntakeClient,type PinPrepareResult,type PinAudience,type PinnedResult} from './pinIntake'

type Phase={kind:'idle'}|{kind:'uploading'}|{kind:'review';result:PinPrepareResult}|{kind:'pinning';result:PinPrepareResult}|{kind:'pinned';pinned:PinnedResult}

/** Readiness-driven pin intake. Default OFF: until the backend readiness probe reports ready (which
 *  needs the operator to enable it after verifying the live path end to end), this shows the exact
 *  honest "unavailable" state — the same copy the fridge has always shown. It flips to the real
 *  "+ Add image and upload" flow only when the real path works. The browser holds no credential; it
 *  forwards the caller's bearer through the client and renders the server's typed proposal to confirm. */
export function FridgeIntake({client,childId,canUse,onPinned}:{client:PinIntakeClient|null;childId:string;canUse:boolean;onPinned?:(pin:PinnedResult['pin'])=>void}){
 const [ready,setReady]=useState<'loading'|'ready'|'off'>('loading')
 const [phase,setPhase]=useState<Phase>({kind:'idle'})
 const [caption,setCaption]=useState('')
 const [audience,setAudience]=useState<PinAudience>('PARENTS_ONLY')
 const [plainPhoto,setPlainPhoto]=useState(false)
 const [error,setError]=useState('')
 const [previewUrl,setPreviewUrl]=useState<string|null>(null)
 const inputRef=useRef<HTMLInputElement>(null),abort=useRef<AbortController|null>(null),alive=useRef(true),id=useId()

 useEffect(()=>{
  alive.current=true
  const controller=new AbortController()
  if(client)void client.readiness(controller.signal).then(r=>{if(alive.current&&!controller.signal.aborted)setReady(r.ready?'ready':'off')},()=>{if(alive.current)setReady('off')})
  else setReady('off')
  return()=>{alive.current=false;controller.abort();abort.current?.abort()}
 },[client])

 // Never leave a private photo object URL dangling in browser memory (design contract §10).
 useEffect(()=>()=>{if(previewUrl)URL.revokeObjectURL(previewUrl)},[previewUrl])

 function reset(keepFile=false){
  abort.current?.abort()
  setPhase({kind:'idle'});setError('')
  if(!keepFile){setCaption('');setAudience('PARENTS_ONLY');setPlainPhoto(false);if(previewUrl){URL.revokeObjectURL(previewUrl);setPreviewUrl(null)}if(inputRef.current)inputRef.current.value=''}
 }

 async function choose(file:File|undefined){
  if(!file||!client)return
  reset(true)
  if(previewUrl)URL.revokeObjectURL(previewUrl)
  const url=URL.createObjectURL(file);setPreviewUrl(url)
  const controller=new AbortController();abort.current=controller
  setPhase({kind:'uploading'});setError('')
  try{
   const {assetId}=await client.upload({childId,file},controller.signal)
   if(controller.signal.aborted||!alive.current)return
   const result=await client.prepare({childId,assetId,caption:caption.trim()||undefined,audience,document:!plainPhoto,concept:plainPhoto?undefined:'sheet of paper'},controller.signal)
   if(controller.signal.aborted||!alive.current)return
   setPhase({kind:'review',result})
  }catch(e){if(!controller.signal.aborted&&alive.current){setError(pinErrorMessage(e));setPhase({kind:'idle'})}}
 }

 async function confirm(){
  if(phase.kind!=='review'||!client)return
  const result=phase.result,proposal=result.proposal
  if(!proposal)return
  const controller=new AbortController();abort.current=controller
  setPhase({kind:'pinning',result});setError('')
  try{
   const pinned=await client.confirm({proposal,caption:result.extracted.caption,extracted:result.extracted},controller.signal)
   if(controller.signal.aborted||!alive.current)return
   setPhase({kind:'pinned',pinned});onPinned?.(pinned.pin)
  }catch(e){if(!controller.signal.aborted&&alive.current){setError(pinErrorMessage(e));setPhase({kind:'review',result})}}
 }

 // Honest unavailable state — preserved verbatim from the original fridge intake.
 if(ready!=='ready'){
  return <div className="fridge-intake-state">
   <button disabled aria-describedby={`${id}-reason`}>+ Add photo or paper</button>
   <p id={`${id}-reason`}>{ready==='loading'?'Checking whether photo and paper intake is available…':'Photo and paper intake is unavailable. Private upload, extraction, confirmation, storage and authorized retrieval have not been verified together.'}</p>
  </div>
 }

 if(!canUse)return <div className="fridge-intake-state"><button disabled aria-describedby={`${id}-reason`}>+ Add image and upload</button><p id={`${id}-reason`}>Only a parent or guardian of this child can pin to their fridge.</p></div>

 return <div className="fridge-intake" aria-label="Pin a photo or paper to the fridge">
  {phase.kind==='pinned'?<div className="fridge-intake-done" role="status">
    <Check size={18} aria-hidden="true"/><span>Pinned to the fridge{phase.pinned.created?'':' (already there)'}.</span>
    <Button type="button" variant="outline" className="fridge-intake-btn" onClick={()=>reset()}>Pin another</Button>
   </div>
  :phase.kind==='review'||phase.kind==='pinning'?<PinReview
    result={phase.result} previewUrl={previewUrl} audience={audience} onAudience={setAudience}
    busy={phase.kind==='pinning'} onConfirm={()=>void confirm()} onBack={()=>reset(true)} canConfirm={!!phase.result.proposal}/>
  :<div className="fridge-intake-compose">
    <Button type="button" className="fridge-intake-btn" disabled={phase.kind==='uploading'} onClick={()=>inputRef.current?.click()}><ImageIcon size={18} aria-hidden="true"/>+ Add image and upload</Button>
    <input ref={inputRef} id={`${id}-file`} type="file" accept="image/png,image/jpeg,image/webp" hidden aria-label="Choose a photo or paper to pin" onChange={e=>void choose(e.target.files?.[0])}/>
    <label className="fridge-intake-field"><span>Caption (optional)</span><input type="text" value={caption} maxLength={120} placeholder="e.g. Field trip slip" onChange={e=>setCaption(e.target.value)}/></label>
    <label className="fridge-intake-check"><input type="checkbox" checked={plainPhoto} onChange={e=>setPlainPhoto(e.target.checked)}/><span>This is a plain photo, not a document (skip cropping)</span></label>
    <p className="fridge-intake-note"><Upload size={14} aria-hidden="true"/> PNG, JPEG or WebP up to 10 MB. The photo is stripped of location data, read privately, and pinned only after you confirm.</p>
   </div>}
  {phase.kind==='uploading'&&<p role="status">Reading your photo privately…</p>}
  {error&&<p role="alert" className="fridge-intake-error">{error}</p>}
 </div>
}

function fieldRows(e:PinPrepareResult['extracted']):{label:string;value:string}[]{
 const rows:{label:string;value:string}[]=[]
 if(e.title?.value)rows.push({label:'Title',value:e.title.value})
 if(e.event?.value)rows.push({label:'Event',value:e.event.value})
 if(e.date)rows.push({label:'Date',value:e.date})
 if(e.startTime)rows.push({label:'Time',value:e.startTime})
 if(e.place?.value)rows.push({label:'Place',value:e.place.value})
 if(e.term?.value)rows.push({label:'Term',value:e.term.value})
 if(e.dueDate)rows.push({label:'Due',value:e.dueDate})
 if(e.signatureRequired)rows.push({label:'Signature',value:'Required'})
 return rows
}
const KIND_LABEL:Record<string,string>={drawing:'Drawing',permission_slip:'Permission slip',report_card:'Report card',appointment_card:'Appointment card',other:'Paper'}

function PinReview({result,previewUrl,audience,onAudience,busy,onConfirm,onBack,canConfirm}:{result:PinPrepareResult;previewUrl:string|null;audience:PinAudience;onAudience:(a:PinAudience)=>void;busy:boolean;onConfirm:()=>void;onBack:()=>void;canConfirm:boolean}){
 const seg=result.segmentation,rows=fieldRows(result.extracted)
 const cropStyle=seg.applied?{left:`${seg.crop.x*100}%`,top:`${seg.crop.y*100}%`,width:`${seg.crop.width*100}%`,height:`${seg.crop.height*100}%`,transform:`rotate(${seg.rotationDeg}deg)`}:undefined
 return <section className="fridge-intake-review" aria-label="Review before pinning">
  <div className="fridge-intake-preview">
   {previewUrl&&<img src={previewUrl} alt="The photo you chose, shown for review"/>}
   {seg.applied&&cropStyle&&<span className="fridge-intake-crop" style={cropStyle} aria-hidden="true"/>}
  </div>
  <p className="fridge-intake-seg" role="status">{seg.applied
   ?`Cropped to the paper with Segment Anything 3.1${seg.confidence!=null?` (${Math.round(seg.confidence*100)}% match)`:''}. You can change this after pinning.`
   :`Shown uncropped. ${seg.reason==='plain photo'?'Treated as a plain photo.':'Rosina couldn’t isolate the paper, so the whole image is kept.'}`}</p>
  <dl className="fridge-intake-read">
   <div><dt>What Rosina read</dt><dd>{KIND_LABEL[result.classification.kind]??'Paper'}{result.classification.uncertain?' · not certain':''}</dd></div>
   {rows.map(r=><div key={r.label}><dt>{r.label}</dt><dd>{r.value}</dd></div>)}
  </dl>
  {result.status==='NEEDS_CLARIFICATION'&&result.clarification&&<p className="fridge-intake-clarify" role="status">{result.clarification.question} Add it to the caption and review again.</p>}
  <fieldset className="fridge-intake-audience"><legend>Who can see it</legend>
   {result.audience.options.map(opt=><label key={opt}><input type="radio" name="pin-audience" checked={audience===opt} onChange={()=>onAudience(opt)}/><span>{opt==='PARENTS_ONLY'?'Parents only':'Shared with granted readers'}</span></label>)}
  </fieldset>
  <div className="fridge-intake-actions">
   <Button type="button" className="fridge-intake-btn" disabled={busy||!canConfirm} onClick={onConfirm}>{busy?'Pinning…':'Pin it to the fridge'}</Button>
   <Button type="button" variant="ghost" className="fridge-intake-btn" disabled={busy} onClick={onBack}><X size={16} aria-hidden="true"/>Choose another</Button>
  </div>
  {!canConfirm&&<p role="status">Add a short caption so this has a label, then review again.</p>}
 </section>
}

/** Factory used by ConnectedFridge for a live session (its own bearer). */
export function buildPinIntakeClient(getAccessToken:()=>string|null|undefined):PinIntakeClient{return createPinIntakeClient(getAccessToken)}
