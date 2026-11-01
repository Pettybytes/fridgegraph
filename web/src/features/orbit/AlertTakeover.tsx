import {useEffect,useState} from 'react'
import {Dialog} from 'radix-ui'
import {useReducedMotion} from 'motion/react'
import {Check,ArrowUpRight,MapPin,Clock,X} from 'lucide-react'
import type {OrbitController} from './controller'
import {useOrbitState,useOrbitPhoto} from './runtime'
import {formatInstant} from '@/features/calendar/time'
import {descriptorKeys} from './adapter'
import {descriptorLabels} from './OrbitPreparation'
import './alert-ui.css'
export function FoundSafe({controller,recipient=false,childName}:{controller:OrbitController;recipient?:boolean;childName?:string}){
 const state=useOrbitState(controller),reduced=useReducedMotion(),[celebrate,setCelebrate]=useState(false)
 useEffect(()=>{if(!controller.consumeCelebration())return;setCelebrate(true);const timer=setTimeout(()=>setCelebrate(false),3200);return()=>clearTimeout(timer)},[controller,state.celebrationKey])
 if(state.alert?.status!=='CLOSED'||state.alert.closeOutcome!=='FOUND_SAFE')return null
 return <section className="orbit-found" data-celebrating={celebrate&&!reduced||undefined} aria-label="Found safe" aria-live={celebrate?'polite':'off'}>
  {celebrate&&!reduced&&<><div className="orbit-safe-reveal" aria-hidden="true"/><div className="orbit-confetti" aria-hidden="true">{Array.from({length:48},(_,i)=><i key={i} style={{left:`${(i*37)%100}%`,animationDelay:`${i%7*.07}s`,rotate:`${i*31}deg`}}/>)}</div></>}
  <svg className="orbit-safe-check" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="46"/><path d="M27 51 43 67 75 34" pathLength="1"/></svg>{recipient&&childName&&<p className="orbit-found-name">{childName.trim().split(/\s+/)[0]}</p>}{recipient?<Dialog.Description asChild><h2>Found safe</h2></Dialog.Description>:<h2>Found safe</h2>}<p className="orbit-thankyou">{state.alert.thankyou??'Thank-you not recorded.'}</p>{!recipient&&<p>Closed by the parent or guardian{state.alert.closedAt?` · ${formatInstant(state.alert.closedAt)}`:''}</p>}{recipient&&state.alert.responses.filter(r=>r.person.id===controller.scope.personId).map(r=><p key={r.respondedAt+':'+r.response}>Your response: {r.response==='WITH_ME'?'with me':r.response==='ON_WAY'?'on my way':'cannot help'} · {formatInstant(r.respondedAt)}</p>)}
 </section>
}
export function AlertTakeover({controller,childName}:{controller:OrbitController;childName:string}){
 const state=useOrbitState(controller),reduced=useReducedMotion(),alert=state.alert
 const recipient=!state.authority&&!controller.scope.readOnly&&!!alert?.audience.some(member=>member.person.id===controller.scope.personId&&member.eligible)
 const image=useOrbitPhoto(controller,recipient&&alert?.status==='ACTIVE'?alert.share.photoId??undefined:undefined)
 const ownResponse=alert?.latestResponses.find(r=>r.person.id===controller.scope.personId)
 const active=alert?.status==='ACTIVE',found=alert?.status==='CLOSED'&&alert.closeOutcome==='FOUND_SAFE'
 useEffect(()=>{if(recipient&&active&&!reduced&&typeof navigator.vibrate==='function'){navigator.vibrate(200);return()=>{navigator.vibrate(0)}}},[recipient,active,reduced,alert?.id])
 if(!recipient||(!active&&!found))return null
 return <Dialog.Root open onOpenChange={open=>{if(!open)location.hash='#/today'}}><Dialog.Portal><Dialog.Overlay className="orbit-takeover-backdrop"/><Dialog.Content className={`orbit-takeover ${found?'is-found':'is-alert'}`}>
  <header><span>Simulated</span><Dialog.Title>Orbit Alert</Dialog.Title><Dialog.Close aria-label="Leave alert view"><X size={24}/></Dialog.Close></header>
  {found?<FoundSafe controller={controller} recipient childName={childName}/>:<>
   <div className="orbit-alert-subject"><div className="orbit-alert-portrait">{image.url?<img src={image.url} alt="Photo shared by the parent" onError={image.onError}/>:<p className="orbit-photo-unavailable">{image.failed?"Photo isn't available to this view.":'Photo not recorded.'}</p>}</div><div><h2>{childName}</h2><p><MapPin size={18}/>{alert.lastSeenPlace?.label??'Last known place not recorded.'}</p><p><Clock size={18}/>{alert.lastSeenAt?formatInstant(alert.lastSeenAt):'Last-seen time not recorded.'}</p><dl>{descriptorKeys.filter(key=>alert.share[key]).map(key=><div key={key}><dt>{descriptorLabels[key]}</dt><dd>{alert.share[key]!.replaceAll('_',' ')}</dd></div>)}</dl></div></div>
   <details className="orbit-shared-message"><summary>Shared message</summary><blockquote>{alert.message??'Message not recorded.'}</blockquote></details>
   <div className="orbit-alert-actions"><button aria-pressed={ownResponse?.response==='ON_WAY'} disabled={!!state.busy} onClick={()=>void controller.respond('ON_WAY')}><ArrowUpRight/>I'm on my way</button><button aria-pressed={ownResponse?.response==='WITH_ME'} disabled={!!state.busy} onClick={()=>void controller.respond('WITH_ME')}><Check/>She's with me</button><button aria-pressed={ownResponse?.response==='CANNOT_HELP'} disabled={!!state.busy} onClick={()=>void controller.respond('CANNOT_HELP')}><X/>Can't help</button></div>
   {ownResponse&&<p className="orbit-response-confirmation" role="status"><Check size={22}/>{ownResponse.response==='ON_WAY'?"You’re on your way. Your response is recorded.":ownResponse.response==='WITH_ME'?"You reported they’re with you. The parent still closes the alert.":"You can’t help. Your response is recorded."}</p>}
   <section aria-label="Your response history">{alert.responses.filter(r=>r.person.id===controller.scope.personId).map(r=><p key={r.respondedAt+':'+r.response}>{r.response==='ON_WAY'?'You reported: on my way':r.response==='WITH_ME'?'You reported: with me':'You reported: cannot help'} · {formatInstant(r.respondedAt)}</p>)}</section>
  </>}
  {state.error&&<p role="alert">{state.error}</p>}{!found&&<Dialog.Description className="orbit-takeover-guidance">{state.guidance}</Dialog.Description>}
 </Dialog.Content></Dialog.Portal></Dialog.Root>
}
