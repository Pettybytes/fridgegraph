import {useEffect,useId,useRef,useState} from 'react'
import {Upload,Image as ImageIcon,Check} from 'lucide-react'
import {FridgeButton as Button} from './FridgeControls'
import {createPinIntakeClient,pinErrorMessage,sampleSlipFile,type PinIntakeClient,type PinPrepareResult,type PinAudience,type PinnedResult} from './pinIntake'

type Phase={kind:'idle'}|{kind:'uploading'}|{kind:'photo'}|{kind:'review';result:PinPrepareResult}|{kind:'pinning';result:PinPrepareResult}|{kind:'pinned';pinned:PinnedResult}

/** Readiness-driven pin intake. Default OFF: until the backend readiness probe reports ready (which
 *  needs the operator to enable it after verifying the live path end to end), this shows the exact
 *  honest "unavailable" state : the same copy the fridge has always shown. It flips to the real
 *  "+ Add image and upload" flow only when the real path works. The browser holds no credential; it
 *  forwards the caller's bearer through the client and renders the server's typed proposal to confirm. */
export function FridgeIntake({client,childId,canUse,onPinned}:{client:PinIntakeClient|null;childId:string;canUse:boolean;onPinned?:(pin:PinnedResult['pin'])=>void}){
 const [ready,setReady]=useState<'loading'|'ready'|'off'>('loading')
 const [phase,setPhase]=useState<Phase>({kind:'idle'})
 const [caption,setCaption]=useState('')
 const [audience,setAudience]=useState<PinAudience>('PARENTS_ONLY')
 const [plainPhoto,setPlainPhoto]=useState(true)
 const [error,setError]=useState('')
 const [assetId,setAssetId]=useState<string|null>(null)
 const [saving,setSaving]=useState(false)
 const [preparedFor,setPreparedFor]=useState('')
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
  if(!keepFile){setCaption('');setAudience('PARENTS_ONLY');setPlainPhoto(true);setAssetId(null);if(previewUrl){URL.revokeObjectURL(previewUrl);setPreviewUrl(null)}if(inputRef.current)inputRef.current.value=''}
 }

 async function choose(file:File|undefined,document=!plainPhoto){
  if(!file||!client)return
  reset(true);setAssetId(null)
  if(previewUrl)URL.revokeObjectURL(previewUrl)
  const url=URL.createObjectURL(file);setPreviewUrl(url)
  const controller=new AbortController();abort.current=controller
  setPhase({kind:'uploading'});setError('')
  try{
   const {assetId}=await client.upload({childId,file},controller.signal)
   if(controller.signal.aborted||!alive.current)return
   setAssetId(assetId)
   if(!document){setPhase({kind:'photo'});return}
   const result=await client.prepare({childId,assetId,caption:caption.trim()||undefined,audience,document:true,concept:'sheet of paper'},controller.signal)
   setPreparedFor(JSON.stringify([caption.trim(),audience]))
   if(controller.signal.aborted||!alive.current)return
   setPhase({kind:'review',result})
  }catch(e){if(!controller.signal.aborted&&alive.current){setError(pinErrorMessage(e));setPhase({kind:'idle'})}}
 }

 async function loadSample(){
  if(!client||phase.kind==='uploading')return
  setError('')
  try{const file=await sampleSlipFile();setPlainPhoto(false);await choose(file,true)}
  catch(e){if(alive.current)setError(pinErrorMessage(e))}
 }

 async function confirm(){
  if(saving||!client||!assetId||(phase.kind!=='photo'&&phase.kind!=='review'))return
  const prior=phase
  setSaving(true)
  const controller=new AbortController();abort.current=controller
  setPhase({kind:'uploading'});setError('')
  try{
   let result=prior.kind==='review'?prior.result:null
   if(!result||preparedFor!==JSON.stringify([caption.trim(),audience])){
    result=await client.prepare({childId,assetId,caption:caption.trim()||(plainPhoto?'Family photo':undefined),audience,document:!plainPhoto,concept:plainPhoto?undefined:'sheet of paper'},controller.signal)
    if(controller.signal.aborted||!alive.current)return
    setPreparedFor(JSON.stringify([caption.trim(),audience]))
    if(!plainPhoto){setPhase({kind:'review',result});return}
   }
   if(!result.proposal){setPhase({kind:'review',result});return}
   setPhase({kind:'pinning',result})
   const pinned=await client.confirm({proposal:result.proposal,caption:result.extracted.caption,extracted:result.extracted},controller.signal)
   if(controller.signal.aborted||!alive.current)return
   setPhase({kind:'pinned',pinned});onPinned?.(pinned.pin)
  }catch(e){if(!controller.signal.aborted&&alive.current){setError(pinErrorMessage(e));setPhase(prior)}}finally{if(alive.current)setSaving(false)}
 }

 // Honest unavailable state : preserved verbatim from the original fridge intake.
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
    <Button type="button" variant="secondary" className="fridge-intake-btn" onClick={()=>reset()}>Pin another</Button>
   </div>
  :phase.kind==='photo'?<section className="fridge-intake-review" aria-label="Review photo">
    {previewUrl&&<div className="fridge-intake-preview"><img src={previewUrl} alt="The photo you chose, shown for review"/></div>}
   </section>
  :phase.kind==='review'||phase.kind==='pinning'?<PinReview
    result={phase.result} previewUrl={previewUrl}/>
  :<div className="fridge-intake-compose">
    <Button type="button" className="fridge-intake-btn" disabled={phase.kind==='uploading'} onClick={()=>inputRef.current?.click()}><ImageIcon size={18} aria-hidden="true"/>+ Add image and upload</Button>
    <input ref={inputRef} id={`${id}-file`} type="file" accept="image/png,image/jpeg,image/webp" hidden aria-label="Choose a photo or paper to pin" onChange={e=>void choose(e.target.files?.[0])}/>
    <label className="fridge-intake-check"><input type="checkbox" disabled={phase.kind==='uploading'} checked={!plainPhoto} onChange={e=>setPlainPhoto(!e.target.checked)}/><span>This is a document</span></label>
    <p className="fridge-intake-note"><Upload size={14} aria-hidden="true"/> PNG, JPEG or WebP up to 10 MB. Location data is removed. Rosina reads documents only when you choose that option.</p>
    <button type="button" className="fridge-intake-sample" disabled={phase.kind==='uploading'} onClick={()=>void loadSample()}>Try a sample: a Lincoln Elementary permission slip, photographed on the counter</button>
   </div>}
  {phase.kind!=='pinned'&&<>
   <label className="fridge-intake-field"><span>Caption (optional)</span><input type="text" value={caption} maxLength={300} placeholder="A family moment" disabled={saving} onChange={e=>setCaption(e.target.value)}/></label>
   {<fieldset className="fridge-intake-audience" disabled={phase.kind==='pinning'||phase.kind==='uploading'}><legend>Who can see it</legend>
    <label><input type="radio" name={`${id}-audience`} checked={audience==='PARENTS_ONLY'} onChange={()=>setAudience('PARENTS_ONLY')}/>Parents only</label>
    <label><input type="radio" name={`${id}-audience`} checked={audience==='SHARED'} onChange={()=>setAudience('SHARED')}/>Shared with granted readers</label>
   </fieldset>}
   {(phase.kind==='photo'||phase.kind==='review'||phase.kind==='pinning')&&<div className="fridge-intake-actions">
    <Button type="button" className="fridge-intake-btn" disabled={phase.kind==='pinning'} onClick={()=>void confirm()}>{phase.kind==='pinning'?'Adding…':'Add to fridge'}</Button>
    <Button type="button" variant="ghost" disabled={phase.kind==='pinning'} onClick={()=>reset()}>Choose another</Button>
   </div>}
  </>}
  {phase.kind==='uploading'&&<p role="status">{plainPhoto?'Preparing your photo…':'Reading your document…'}</p>}
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

function PinReview({result,previewUrl}:{result:PinPrepareResult;previewUrl:string|null}){
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

 </section>
}

/** Factory used by ConnectedFridge for a live session (its own bearer). */
export function buildPinIntakeClient(getAccessToken:()=>string|null|undefined):PinIntakeClient{return createPinIntakeClient(getAccessToken)}
