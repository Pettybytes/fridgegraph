import {OrbitStart} from './OrbitStart'
import {AlertTakeover,FoundSafe,lastSeenCopy} from './AlertTakeover'
import {OrbitFactsCard} from './OrbitFactsCard'
import {OrbitMessage} from './OrbitMessage'
import {Portrait} from '@/components/signature/Portrait'
import {portraitFor} from '@/components/fg/portraits'
import {useActivePolling} from './useActivePolling'
import {useEffect} from 'react'
import {Dialog} from 'radix-ui'
import {MessageCircle,ArrowRight,Check,RefreshCw} from 'lucide-react'
import {formatTime,formatInstant,formatInstantSeconds} from '@/features/calendar/time'
import {useSession} from '@/features/personas/Session'
import type {ResponseChoice} from './adapter'
import type {OrbitController} from './controller'
import {useOrbit,useOrbitState,useOrbitPhoto} from './runtime'
import './orbit.css'
import './alert-ui.css'
// Orbit renders Portrait directly (response rows, subject), so it must carry the signature styles
// itself rather than relying on OrbitConstellation's import, which this view no longer uses.
import '@/components/signature/signature.css'
const responses:Record<ResponseChoice,string>={WITH_ME:'With me',ON_WAY:'On my way',CANNOT_HELP:"Can't help"}
export function OrbitCheckInCard(){const controller=useOrbit();return controller?<CheckInCard controller={controller}/>:null}
function CheckInCard({controller}:{controller:OrbitController}){
 const state=useOrbitState(controller),{session}=useSession()
 if(!state.authority||!controller.checkInOverdue()||state.alert?.status==='ACTIVE')return null
 return <aside className="orbit-notice" data-state="derived"><span className="orbit-simulation">Simulated notification</span><div><span className="orbit-notice-mark" aria-hidden="true"><MessageCircle size={22}/></span><h2>{session?.scope.childName.split(' ')[0]}'s {formatTime(state.check!.dueAt!)} check-in hasn't been recorded.</h2></div><p role="note">{state.guidance}</p><a href="#/orbit">Review Orbit <ArrowRight size={16}/></a></aside>
}
export function Orbit(){const controller=useOrbit();return controller?<OrbitView controller={controller}/>:<section className="orbit-empty" data-state="unavailable"><h2>Orbit isn't connected in this view.</h2><p>Choose a live perspective to see the records shared with it.</p></section>}
export function OrbitView({controller}:{controller:OrbitController}){
 const state=useOrbitState(controller),{session}=useSession(),image=useOrbitPhoto(controller,state.authority&&state.phase==='active'&&!state.error?state.photoId:undefined)
 const parent=state.authority&&!controller.scope.readOnly,active=state.phase==='active'&&!state.error&&state.alert?.status==='ACTIVE',closed=!state.error&&state.alert?.status==='CLOSED'
 useEffect(()=>{const alertId=()=>new URLSearchParams(location.hash.split('?')[1]??'').get('alertId')??undefined;const refresh=()=>{const phase=controller.getSnapshot().phase;if(!['loading','editing','preparing','preview','activating'].includes(phase))void controller.refresh(alertId())};if(alertId())refresh();window.addEventListener('hashchange',refresh);return()=>{window.removeEventListener('hashchange',refresh)}},[controller,state.phase])
 useActivePolling(controller,active)
 const visibleResponses=(state.alert?.responses??[]).filter(response=>parent||controller.scope.readOnly||response.person.id===controller.scope.personId)
 const lastSeen=state.alert?lastSeenCopy(state.alert):null,childFullName=session?.scope.childName??'Name not shared'
 const parentPhoto=image.url??portraitFor({personId:controller.scope.childId})
 if(!parent&&!controller.scope.readOnly&&state.alert?.audience.some(member=>member.person.id===controller.scope.personId&&member.eligible)&&(active||(closed&&state.alert.closeOutcome==='FOUND_SAFE')))return <AlertTakeover controller={controller} childName={session?.scope.childName??'Name not shared'}/>
 return <section className={`orbit-page ${active&&parent?'orbit-page-active':''}`} aria-label="Orbit" data-state="live">
  <AlertTakeover controller={controller} childName={session?.scope.childName??'Name not shared'}/>{parent&&<FoundSafe controller={controller} childName={childFullName} closerName={session?.scope.parentName}/>}
  <div className="orbit-context"><span className="orbit-simulation">Simulated notification</span>{controller.scope.readOnly&&<span>Demo guide is read-only</span>}<button type="button" className="sg-refresh" disabled={!!state.busy} onClick={()=>{void controller.refresh()}} aria-label="Refresh Orbit"><RefreshCw size={16}/></button></div>
  {state.guidance&&<p className="orbit-guidance" role="note">{state.guidance}</p>}
  {state.phase==='loading'?<p role="status">Loading the records shared with you…</p>:<>
   {state.error&&<div className="orbit-error" role="alert"><p>{state.error}</p><button type="button" onClick={()=>{void(state.phase==='unavailable'?controller.load():controller.refresh())}}><RefreshCw size={15}/> Refresh recorded state</button></div>}
   {!state.error&&(parent||state.alert)&&!(parent&&(active||closed))&&<figure className="orbit-subject"><Portrait name={session?.scope.childName??'Name not shared'} src={session?.scope.childName?portraitFor({personId:controller.scope.childId}):undefined}/><figcaption><span>Orbit for</span><strong>{session?.scope.childName??'Name not shared'}</strong></figcaption></figure>}
   {parent&&!state.error&&<ol className="orbit-steps" aria-label="Orbit progress">{['Prepare','Review','Active','Closed'].map((label,i)=>{const step=closed?3:active?2:state.preview?1:0;return <li key={label} aria-current={i===step?'step':undefined}><span>{i<step?<Check size={13}/>:i+1}</span>{label}</li>})}</ol>}
   {parent&&!state.error&&!active&&!closed&&<OrbitStart controller={controller} childName={session?.scope.childName??'Name not shared'}/>}
   {active&&parent&&state.alert&&<div className="orbit-parent-alert" data-state="active">
    <div className={`orbit-takeover-photo${parentPhoto?'':' is-fallback'}`} style={parentPhoto?{backgroundImage:`url("${parentPhoto}")`}:undefined} aria-hidden="true"/>
    <div className="orbit-takeover-stage" key="parent-active">
     <p className="orbit-card-status">Orbit active · your approved village can respond</p>
     <OrbitFactsCard childName={childFullName} lastSeen={lastSeen!} share={state.alert.share} image={image} photoAlt="Photo you shared" missingPhotoText="Photo not recorded." failedPhotoText="Couldn't display the shared photo." onOpen={()=>{location.hash='#/orbit'}}/>
     <OrbitMessage message={state.alert.message} at={state.alert.activatedAt}/>
     <section className="orbit-vresponses" aria-label="Recorded responses"><h3>Recorded responses</h3>
      {visibleResponses.length?<ol>{visibleResponses.map(response=><li className="orbit-vrow" key={`${response.person.id}:${response.respondedAt}:${response.response}`}><span className="orbit-vrow-portrait"><Portrait name={response.person.displayName} src={portraitFor({personId:response.person.id})}/></span><div><strong>{response.person.displayName}</strong><p>{responses[response.response as ResponseChoice]??'Response not recognized'}</p></div><time dateTime={response.respondedAt}>{formatInstant(response.respondedAt)}</time></li>)}</ol>:<p className="orbit-vempty">No responses have been recorded.</p>}
     </section>
     <div className="orbit-close"><p>Responses do not close Orbit. You decide when to close it.</p><button className="orbit-primary" disabled={!!state.busy} onClick={()=>controller.requestClose()}>Found safe</button></div>
    </div>
   </div>}
   {/* The parent found-safe close is the green glass card above; the plain record card stays for the
       read-only guide and for any non found-safe closure. */}
   {((active&&!parent)||(closed&&!(parent&&state.alert?.closeOutcome==='FOUND_SAFE')))&&state.alert&&<>
    <section className="orbit-record"><div className="orbit-record-heading"><div><p>{closed?'Closed':'Active'}</p><h2>{closed?(state.acknowledgedClosure?.alertId===state.alert.id&&state.acknowledgedClosure.personId===session?.persona.personId?`Closed by ${session.scope.parentName}`:'Your village’s responses are recorded.'):'Your village can respond.'}</h2></div><span className={`orbit-status ${closed?'is-closed':''}`}>{closed?'Closed':'Active'}</span></div>
     {state.alert.message?<blockquote>{state.alert.message}</blockquote>:<p>Message not recorded.</p>}
     {active&&image.url&&<img className="orbit-photo" src={image.url} alt="Shared photo" onError={image.onError}/>}{active&&image.failed&&<p>Couldn't display the shared photo.</p>}
     {state.alert.activatedAt&&<p className="orbit-record-time">{closed?'Opened':'Activated'} {closed?formatInstantSeconds(state.alert.activatedAt):formatInstant(state.alert.activatedAt)}</p>}{closed&&state.alert.closedAt&&<p className="orbit-record-time">Closed {formatInstantSeconds(state.alert.closedAt)}</p>}
     {closed&&state.alert.closeOutcome!=='FOUND_SAFE'&&<p className="orbit-record-time">Closure outcome: {state.alert.closeOutcome?state.alert.closeOutcome.toLowerCase().replaceAll('_',' '):'not recorded'}.</p>}
     {controller.mayRespond()&&<div className="orbit-your-response"><h3>Your response</h3><div>{(Object.keys(responses) as ResponseChoice[]).map(value=><button disabled={!!state.busy} key={value} onClick={()=>{void controller.respond(value)}}>{responses[value]}</button>)}</div></div>}
    </section>
    <section className="orbit-responses" aria-label="Recorded responses"><header><h2>{parent||controller.scope.readOnly?'Recorded responses':'Your recorded responses'}</h2><button onClick={()=>{void controller.refresh()}} disabled={!!state.busy} aria-label="Refresh Orbit responses"><RefreshCw size={17}/></button></header>
     {visibleResponses.length?<ol>{visibleResponses.map(response=><li className="orbit-response" key={`${response.person.id}:${response.respondedAt}:${response.response}`}><span className="orbit-response-portrait"><Portrait name={response.person.displayName} src={portraitFor({personId:response.person.id})}/></span><div><strong>{response.person.displayName} responded</strong><p>“{responses[response.response as ResponseChoice]??'Response not recognized'}”</p><time dateTime={response.respondedAt}>{formatInstant(response.respondedAt)}</time></div></li>)}</ol>:<p>No responses have been recorded.</p>}
    </section>
   </>}
   {!parent&&!state.error&&!active&&!closed&&<section className="orbit-empty"><h2>{controller.scope.readOnly?'No Orbit alert recorded for this child.':'No Orbit message is shared with this view.'}</h2><p>{controller.scope.readOnly?state.check?.text:'Only records you have permission to read appear here.'}</p><button type="button" className="orbit-primary" onClick={()=>{void controller.refresh()}}>Refresh recorded state</button></section>}
   {parent&&closed&&<p className="orbit-final">Closed alerts keep the responses that were recorded.</p>}
  </>}
  <Dialog.Root open={state.closeConfirm} onOpenChange={open=>{if(!open)controller.cancelClose()}}><Dialog.Portal><Dialog.Overlay className="orbit-confirm-backdrop"/><Dialog.Content className="orbit-confirm"><Dialog.Title>Confirm found safe?</Dialog.Title><Dialog.Description>Confirm that the child has been found safe. This closes the alert and sends the recorded thank-you to the approved audience.</Dialog.Description><button className="orbit-primary" onClick={()=>{void controller.close()}}>Confirm found safe</button><Dialog.Close>Keep open</Dialog.Close></Dialog.Content></Dialog.Portal></Dialog.Root>
 </section>
}
