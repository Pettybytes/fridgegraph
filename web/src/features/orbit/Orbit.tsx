import {useEffect} from 'react'
import {Dialog} from 'radix-ui'
import {MessageCircle,ArrowRight,Check,RefreshCw} from 'lucide-react'
import {formatTime,formatInstant} from '@/features/calendar/time'
import {useSession} from '@/features/personas/Session'
import {descriptorKeys,vocabularyKinds} from './adapter'
import type {ResponseChoice} from './adapter'
import type {OrbitController} from './controller'
import {useOrbit,useOrbitState,useOrbitPhoto} from './runtime'
import './orbit.css'
const labels={wearColor:'Clothing color',wearGarment:'Clothing',hair:'Hair',carryColor:'Carrying color',carryItem:'Carrying'}
const responses:Record<ResponseChoice,string>={WITH_ME:'With me',ON_WAY:'On my way',CANNOT_HELP:"Can't help"}
const askEvent=(childName:string)=>{location.hash='#/ask-rosina';window.dispatchEvent(new CustomEvent('orbit:ask',{detail:`Help me prepare an Orbit message for ${childName}.`}))}
export function OrbitCheckInCard(){const controller=useOrbit();return controller?<CheckInCard controller={controller}/>:null}
function CheckInCard({controller}:{controller:OrbitController}){
 const state=useOrbitState(controller),{session}=useSession()
 if(!state.authority||!controller.checkInOverdue()||state.alert?.status==='ACTIVE')return null
 return <aside className="orbit-notice" data-state="derived"><span className="orbit-simulation">Simulated notification</span><div><span className="orbit-notice-mark" aria-hidden="true"><MessageCircle size={22}/></span><h2>{session?.scope.childName.split(' ')[0]}'s {formatTime(state.check!.dueAt!)} check-in hasn't been recorded.</h2></div><p>{state.guidance}</p><a href="#/orbit">Review Orbit <ArrowRight size={16}/></a></aside>
}
export function Orbit(){const controller=useOrbit();return controller?<OrbitView controller={controller}/>:<section className="orbit-empty" data-state="unavailable"><h2>Orbit isn't connected in this view.</h2><p>Choose a live perspective to see the records shared with it.</p></section>}
export function OrbitView({controller}:{controller:OrbitController}){
 const state=useOrbitState(controller),{session}=useSession(),image=useOrbitPhoto(controller,state.busy==='upload'?undefined:state.photoId)
 const parent=state.authority&&!controller.scope.readOnly,active=state.alert?.status==='ACTIVE',closed=state.alert?.status==='CLOSED'
 useEffect(()=>{const alertId=()=>new URLSearchParams(location.hash.split('?')[1]??'').get('alertId')??undefined;const refresh=()=>{const phase=controller.getSnapshot().phase;if(!['loading','editing','preparing','preview','activating'].includes(phase))void controller.refresh(alertId())};if(alertId())refresh();window.addEventListener('hashchange',refresh);const timer=setInterval(()=>{if(document.visibilityState!=='hidden'&&!['loading','editing','preparing','preview','activating','closed'].includes(controller.getSnapshot().phase))refresh()},2500);return()=>{clearInterval(timer);window.removeEventListener('hashchange',refresh)}},[controller])
 const name=session?.scope.childName.split(' ')[0]??'Your child'
 return <section className="orbit-page" aria-label="Orbit" data-state="live">
  <div className="orbit-context"><span className="orbit-simulation">Simulated notification</span>{controller.scope.readOnly&&<span>Demo guide is read-only</span>}</div>
  {state.guidance&&<p className="orbit-guidance" role="note">{state.guidance}</p>}
  {state.phase==='loading'?<p role="status">Loading the records shared with you…</p>:<>
   {state.error&&<div className="orbit-error" role="alert"><p>{state.error}</p><button type="button" onClick={()=>{void(state.phase==='unavailable'?controller.load():controller.refresh())}}><RefreshCw size={15}/> Refresh recorded state</button></div>}
   {parent&&<ol className="orbit-steps" aria-label="Orbit progress">{['Prepare','Review','Active','Closed'].map((label,i)=>{const step=closed?3:active?2:state.preview?1:0;return <li key={label} aria-current={i===step?'step':undefined}><span>{i<step?<Check size={13}/>:i+1}</span>{label}</li>})}</ol>}
   {parent&&!state.started&&!active&&!closed&&<div className="orbit-entry"><h2>{controller.checkInOverdue()?`${name}'s ${formatTime(state.check!.dueAt!)} check-in hasn't been recorded.`:state.check?.text??'Your shared check-in records'}</h2><p>Rosina can help you prepare a message for your approved village. You review it before anything is activated.</p><button className="orbit-primary" onClick={()=>askEvent(name)}>Ask Rosina to prepare a message <ArrowRight size={17}/></button></div>}
   {parent&&state.started&&!active&&!closed&&<div className="orbit-preparation">
    <section className="orbit-details"><h2>What to share</h2><p>Choose only the details you want in this message.</p><fieldset disabled={!!state.busy}><legend className="sr-only">Message description</legend>{descriptorKeys.map(key=><label key={key}>{labels[key]}<select value={state.values[key]??''} onChange={e=>controller.edit(key,e.target.value)}><option value="">Not specified</option>{state.vocabulary.filter(v=>v.kind===vocabularyKinds[key]).map(v=><option key={v.value} value={v.value}>{v.value.replaceAll('_',' ')}</option>)}</select></label>)}<label className="orbit-upload">{state.photoId?'Replace photo':'Add a photo (optional)'}<input type="file" accept="image/jpeg,image/png" onChange={e=>{const file=e.target.files?.[0];if(file)void controller.upload(file);e.target.value=''}}/></label></fieldset>
    {state.busy==='upload'&&<p role="status">Preparing the shared photo…</p>}
    {image.url&&<img className="orbit-photo" src={image.url} alt="Shared photo"/>}{image.failed&&<p>Photo isn't shared with this view.</p>}
    {!state.preview&&<button className="orbit-primary" disabled={!!state.busy} onClick={()=>{void controller.review()}}>{state.busy==='preview'?'Preparing your preview…':'Review message'} <ArrowRight size={16}/></button>}
    </section>
    <section className="orbit-message" aria-label="Message preview"><span className="orbit-message-label">Your village will see</span>{state.preview?<><blockquote>{state.preview.message}</blockquote><p className="orbit-audience">Your approved village ({state.preview.audienceSize} people) will be notified.</p><button className="orbit-primary" disabled={!controller.confirmable()} onClick={()=>{void controller.activate()}}>{state.phase==='activating'?'Activating…':'Confirm and activate Orbit'}</button></>:<><h2>Review before you share.</h2><p>{state.busy==='preview'?'Your exact message is being prepared.':'Review the updated message before confirming.'}</p><button className="orbit-primary" disabled>Confirm and activate Orbit</button></>}</section>
   </div>}
   {(active||closed)&&state.alert&&<>
    <section className="orbit-record"><div className="orbit-record-heading"><div><p>{closed?'Closed':'Active'}</p><h2>{closed?'Your village’s responses are recorded.':'Your village can respond.'}</h2></div><span className={`orbit-status ${closed?'is-closed':''}`}>{closed?'Closed':'Active'}</span></div>
     {state.alert.message?<blockquote>{state.alert.message}</blockquote>:<p>Message not recorded.</p>}
     {image.url&&<img className="orbit-photo" src={image.url} alt="Shared photo"/>}{image.failed&&<p>Photo isn't shared with this view.</p>}
     {state.alert.activatedAt&&<p className="orbit-record-time">Activated {formatInstant(state.alert.activatedAt)}</p>}{closed&&state.alert.closedAt&&<p className="orbit-record-time">Closed {formatInstant(state.alert.closedAt)}</p>}
     {controller.mayRespond()&&<div className="orbit-your-response"><h3>Your response</h3><div>{(Object.keys(responses) as ResponseChoice[]).map(value=><button disabled={!!state.busy} key={value} onClick={()=>{void controller.respond(value)}}>{responses[value]}</button>)}</div></div>}
    </section>
    <section className="orbit-responses" aria-label="Recorded responses"><header><h2>{parent||controller.scope.readOnly?'Recorded responses':'Your recorded responses'}</h2><button onClick={()=>{void controller.refresh()}} disabled={!!state.busy} aria-label="Refresh Orbit responses"><RefreshCw size={17}/></button></header>
     {state.alert.responses.length?<ol>{state.alert.responses.map(response=><li className="orbit-response" key={`${response.person.id}:${response.respondedAt}:${response.response}`}><span className="orbit-response-initial" aria-hidden="true">{response.person.displayName[0]}</span><div><strong>{response.person.displayName} responded</strong><p>“{responses[response.response as ResponseChoice]??'Response not recognized'}”</p><time dateTime={response.respondedAt}>{formatInstant(response.respondedAt)}</time></div></li>)}</ol>:<p>No responses have been recorded.</p>}
    </section>
    {parent&&active&&<div className="orbit-close"><p>Responses do not close Orbit. You decide when to close it.</p><button className="orbit-primary" disabled={!!state.busy} onClick={()=>controller.requestClose()}>Close Orbit</button></div>}
   </>}
   {!parent&&!active&&!closed&&<section className="orbit-empty"><h2>No Orbit message is shared with this view.</h2><p>Only records you have permission to read appear here.</p></section>}
   {parent&&closed&&<p className="orbit-final">Closed alerts keep the responses that were recorded.</p>}
  </>}
  <Dialog.Root open={state.closeConfirm} onOpenChange={open=>{if(!open)controller.cancelClose()}}><Dialog.Portal><Dialog.Overlay className="orbit-confirm-backdrop"/><Dialog.Content className="orbit-confirm"><Dialog.Title>Close this Orbit alert?</Dialog.Title><Dialog.Description>The responses will stay recorded. This is a separate action from anyone's response.</Dialog.Description><button className="orbit-primary" onClick={()=>{void controller.close()}}>Confirm close Orbit</button><Dialog.Close>Keep open</Dialog.Close></Dialog.Content></Dialog.Portal></Dialog.Root>
 </section>
}
