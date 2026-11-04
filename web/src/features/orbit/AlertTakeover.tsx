import {useEffect,useState} from 'react'
import {Dialog} from 'radix-ui'
import {useReducedMotion} from 'motion/react'
import {Check,ArrowUpRight,X} from 'lucide-react'
import type {OrbitController} from './controller'
import {useOrbitState,useOrbitPhoto} from './runtime'
import {formatInstant} from '@/features/calendar/time'
import type {Alert} from './adapter'
import {portraitFor} from '@/components/fg/portraits'
import {OrbitResolution} from './OrbitResolution'
import {OrbitFactsCard} from './OrbitFactsCard'
import './alert-ui.css'

/**
 * Last seen is one recorded unit, never a derived instant.
 *
 * The place can stand alone (a parent named where the child was last seen); the TIME only appears
 * with a recorded provenance, because a timestamp without one is exactly the defect this guards:
 * an activation instant or a `now()` dressed up as an observation. Absence is stated, not filled.
 */
export function lastSeenCopy(alert: Alert) {
  const place = alert.lastSeenPlace?.label ?? null
  const provenance = alert.lastSeenProvenance ?? null
  const time = provenance ? alert.lastSeenAt ?? null : null
  const recorded = provenance === 'PARENT_ENTERED'
  return {
    place,
    time,
    recorded,
    placeText: place ?? null,
    timeText: time ? formatInstant(time) : null,
    missingText: place ? null : 'Last-seen place and time not recorded.',
  }
}

export function FoundSafe({controller,recipient=false,childName}:{controller:OrbitController;recipient?:boolean;childName?:string}){
 const state=useOrbitState(controller),reduced=useReducedMotion(),[celebrate,setCelebrate]=useState(false)
 useEffect(()=>{if(!controller.consumeCelebration())return;setCelebrate(true);const timer=setTimeout(()=>setCelebrate(false),3200);return()=>clearTimeout(timer)},[controller,state.celebrationKey])
 if(state.error||state.alert?.status!=='CLOSED'||state.alert.closeOutcome!=='FOUND_SAFE')return null
 return <OrbitResolution recipient={recipient} childName={childName} thankyou={state.alert.thankyou} closedAt={state.alert.closedAt} ownResponses={recipient?state.alert.responses.filter(r=>r.person.id===controller.scope.personId):[]} celebrate={celebrate&&!reduced} parentConfirmed={!recipient&&state.acknowledgedClosure?.alertId===state.alert.id&&state.acknowledgedClosure.personId===controller.scope.personId}/>
}

export function AlertTakeover({controller,childName}:{controller:OrbitController;childName:string}){
 const state=useOrbitState(controller),reduced=useReducedMotion(),alert=state.alert
 const recipient=!state.authority&&!controller.scope.readOnly&&!!alert?.audience.some(member=>member.person.id===controller.scope.personId&&member.eligible)
 const active=state.phase==='active'&&!state.error&&alert?.status==='ACTIVE',found=!state.error&&alert?.status==='CLOSED'&&alert.closeOutcome==='FOUND_SAFE'
 const image=useOrbitPhoto(controller,recipient&&active?alert?.share.photoId??undefined:undefined)
 const ownResponse=alert?.latestResponses.find(r=>r.person.id===controller.scope.personId)
 const lastSeen=alert?lastSeenCopy(alert):null
 useEffect(()=>{if(recipient&&active&&!reduced&&typeof navigator.vibrate==='function'){navigator.vibrate(200);return()=>{navigator.vibrate(0)}}},[recipient,active,reduced,alert?.id])
 if(!recipient||(!active&&!found))return null
 const stateKey=found?'found':'active'
 // Full-bleed background behind the ACTIVE overlay: the shared photo, else the child's portrait,
 // else a branded wash — never an empty box. The found screen is sanitized and stays photo-free.
 const backdropUrl=active?(image.url??portraitFor({personId:controller.scope.childId})):undefined
 return <Dialog.Root open onOpenChange={open=>{if(!open)location.hash='#/today'}}><Dialog.Portal><Dialog.Overlay className="orbit-takeover-backdrop"/><Dialog.Content className={`orbit-takeover ${found?'is-found':'is-alert'}`} data-state={stateKey}>
  {active&&<div className={`orbit-takeover-photo${backdropUrl?'':' is-fallback'}`} style={backdropUrl?{backgroundImage:`url("${backdropUrl}")`}:undefined} aria-hidden="true"/>}
  <header><span>{found?'Simulated · recorded close':'Simulated · recorded active alert'}</span><Dialog.Title>Orbit Alert</Dialog.Title><Dialog.Close aria-label="Leave alert view"><X size={24}/></Dialog.Close></header>
  <div className="orbit-takeover-stage" key={stateKey}>
  {found?<FoundSafe controller={controller} recipient childName={childName}/>
  :<>
   <div className="orbit-glass-heading"><p>Recorded active alert</p><h2>Orbit active.</h2><p>You can respond to the alert shared with you. Only your own response is shown here.</p></div>
   <OrbitFactsCard childName={childName} lastSeen={lastSeen!} share={alert!.share} image={image} photoAlt="Photo shared by the parent" missingPhotoText="Photo not recorded." failedPhotoText="Photo isn't available to this view." onOpen={()=>{location.hash='#/orbit'}}/>
   <details className="orbit-shared-message"><summary>Shared message</summary><blockquote>{alert!.message??'Message not recorded.'}</blockquote></details>
   <div className="orbit-alert-actions"><button aria-pressed={ownResponse?.response==='ON_WAY'} disabled={!!state.busy} onClick={()=>void controller.respond('ON_WAY')}><ArrowUpRight/>I'm on my way</button><button aria-pressed={ownResponse?.response==='WITH_ME'} disabled={!!state.busy} onClick={()=>void controller.respond('WITH_ME')}><Check/>She's with me</button><button aria-pressed={ownResponse?.response==='CANNOT_HELP'} disabled={!!state.busy} onClick={()=>void controller.respond('CANNOT_HELP')}><X/>Can't help</button></div>
   {ownResponse&&<p className="orbit-response-confirmation" role="status"><Check size={22}/>{ownResponse.response==='ON_WAY'?"You’re on your way. Your response is recorded.":ownResponse.response==='WITH_ME'?"You reported they’re with you. The parent still closes the alert.":"You can’t help. Your response is recorded."}</p>}
   <section aria-label="Your response history">{alert!.responses.filter(r=>r.person.id===controller.scope.personId).map(r=><p key={r.respondedAt+':'+r.response}>{r.response==='ON_WAY'?'You reported: on my way':r.response==='WITH_ME'?'You reported: with me':'You reported: cannot help'} · {formatInstant(r.respondedAt)}</p>)}</section>
  </>}
  </div>
  {state.error&&<p role="alert">{state.error}</p>}{!found&&<Dialog.Description className="orbit-takeover-guidance">{state.guidance}</Dialog.Description>}
 </Dialog.Content></Dialog.Portal></Dialog.Root>
}
