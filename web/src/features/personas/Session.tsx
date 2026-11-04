import {DemoResetError,RESET_COMPLETE,RESET_FORBIDDEN} from './demoReset'
import {createContext,useContext,useRef,useState,useCallback,useEffect} from 'react'
import type {ReactNode} from 'react'
import {flushSync} from 'react-dom'
import type {AuthAdapter,AuthSession,DemoFamily,DemoFamilyInput,PersonaId} from './auth'
import {canResetDemo} from './auth'
import {BUSY,PerspectiveError} from './liveAuth'
import {clearRememberedPerspective,rememberPerspective,rememberedPerspective} from './perspectiveMemory'
import {retryReadOnce} from './renewal'
import {validDay} from '@/features/calendar/time'
type Cleanup=()=>void|Promise<unknown>
export type SessionContextValue={
 session:AuthSession|null;switching:boolean;error:string;families:DemoFamily[];authMode:AuthAdapter['mode'];notice:string;resetting:boolean;resetError:string;resetRetryAt:number;unavailable:ReadonlySet<PersonaId>;retryAt:Partial<Record<PersonaId,number>>
 getSessionGeneration():number;getCurrentSession():AuthSession|null;renewSession():Promise<AuthSession|null>
 runRead<T>(read:()=>Promise<T>):Promise<T>
 switchPerson(id?:PersonaId):Promise<void>;resetDemo():Promise<boolean>;createDemoFamily(input:DemoFamilyInput):Promise<void>;registerPrivateCleanup(cleanup:Cleanup):()=>void;registerResetVerification(verify:(signal:AbortSignal)=>Promise<void>):()=>void
}
/** Exported only so dev-only preview harnesses (e.g. activity-preview.html) can provide a fake
 * session value directly, without a live AuthAdapter. Never imported by application code — use
 * SessionProvider + useSession for anything that ships. */
export const SessionContext=createContext<SessionContextValue|null>(null)
const Context=SessionContext
export function SessionProvider({adapter,children}:{adapter:AuthAdapter;children:ReactNode}){
 const [session,setSession]=useState<AuthSession|null>(null),[switching,setSwitching]=useState(false),[error,setError]=useState(''),[families,setFamilies]=useState<DemoFamily[]>([])
 const [unavailable,setUnavailable]=useState<Set<PersonaId>>(new Set()),[retryAt,setRetryAt]=useState<Partial<Record<PersonaId,number>>>({})
 const [notice,setNotice]=useState(''),[resetting,setResetting]=useState(false),[resetError,setResetError]=useState(''),[resetRetryAt,setResetRetryAt]=useState(0)
 const resetAbort=useRef<AbortController|null>(null),resetFlight=useRef<{generation:number;promise:Promise<boolean>}|null>(null),resetVerifications=useRef(new Set<(signal:AbortSignal)=>Promise<void>>())
 const [tick,setTick]=useState(0)
 const generation=useRef(0),currentSession=useRef<AuthSession|null>(null),cleanups=useRef(new Set<Cleanup>()),transitionAbort=useRef<AbortController|null>(null),renewAbort=useRef<AbortController|null>(null)
 const calendarDayForNextPerspective=useRef<string|null>(null)
 const flight=useRef<{generation:number;promise:Promise<AuthSession|null>}|null>(null),backoff=useRef(0),notBefore=useRef(0),mounted=useRef(true)
 const getSessionGeneration=useCallback(()=>generation.current,[]),getCurrentSession=useCallback(()=>currentSession.current,[])
 const registerPrivateCleanup=useCallback((clear:Cleanup)=>{cleanups.current.add(clear);return()=>{cleanups.current.delete(clear)}},[])
 useEffect(()=>{mounted.current=true;const signal=new AbortController();if(adapter.unavailablePersonas)void adapter.unavailablePersonas(signal.signal).then(ids=>{if(!signal.signal.aborted)setUnavailable(new Set(ids))});return()=>{mounted.current=false;signal.abort();++generation.current;transitionAbort.current?.abort();renewAbort.current?.abort();resetAbort.current?.abort();currentSession.current=null;flight.current=null;resetFlight.current=null}},[adapter])
 // A reload re-runs the server-side persona pick for the remembered perspective (the server
 // mints the session; browser storage holds only the persona id). A failed re-pick falls
 // through to the picker exactly like a failed manual pick.
 useEffect(()=>{
  const id=rememberedPerspective()
  if(!id)return
  // Deferred out of the effect flush: transition uses flushSync, which cannot run while
  // React is still committing. The picker renders for that tick, as during any sign-in.
  const timer=setTimeout(()=>{if(!currentSession.current)void transition(id,true)},0)
  return()=>clearTimeout(timer)
 },[adapter])
 function discard(){
  ++generation.current;transitionAbort.current?.abort();renewAbort.current?.abort();resetAbort.current?.abort();resetFlight.current=null;flight.current=null;currentSession.current=null;backoff.current=0;notBefore.current=0
  const pending=[...cleanups.current];cleanups.current.clear();return pending
 }
 const expire=useCallback(()=>{
  // An ended session returns to the picker; it must not silently re-pick on reload.
  clearRememberedPerspective()
  calendarDayForNextPerspective.current=null
  const pending=discard();setSession(null);setSwitching(false);setFamilies([]);setError('Your session ended, choose a perspective again')
  void Promise.allSettled(pending.map(clear=>clear()))
 },[])
 async function transition(id?:PersonaId,restore=false){
  if(id&&(retryAt[id]??0)>Date.now()){setError(BUSY);return}
  // Switching or leaving a perspective forgets it; only an explicit new pick is remembered.
  if(!id)clearRememberedPerspective()
  if(!id&&currentSession.current){
   const day=location.hash.startsWith('#/calendar?')?new URLSearchParams(location.hash.split('?')[1]??'').get('day'):null
   calendarDayForNextPerspective.current=validDay(day)?day:null
  }
  const hadSession=!!currentSession.current,pending=discard(),owner=generation.current,controller=new AbortController();transitionAbort.current=controller
  flushSync(()=>{setSession(null);setSwitching(true);setError('');setNotice('');setResetError('');setResetRetryAt(0);setResetting(false);setFamilies([])})
  if(hadSession)window.history.replaceState(null,'',`${location.pathname}${location.search}#/mission-control`)
  try{
   await Promise.all(pending.map(clear=>clear()))
   if(owner!==generation.current)return
   const next=id?await adapter.signInAsPersona(id,controller.signal):null
   if(owner!==generation.current||controller.signal.aborted||!mounted.current)return
   // A restore keeps the route the reload arrived on; initialRoute only fills an empty hash.
   if(next?.persona.initialRoute&&!(restore&&location.hash.length>2)){
    const day=next.persona.initialRoute==='calendar'?calendarDayForNextPerspective.current:null
    window.history.replaceState(null,'',`${location.pathname}${location.search}#/${next.persona.initialRoute}${day?`?day=${day}`:''}`)
   }
   if(id)calendarDayForNextPerspective.current=null
   const value=next?{...next,generation:owner}:null;currentSession.current=value;setSession(value)
   if(id&&value)rememberPerspective(id)
  }catch(failure){if(owner===generation.current&&!controller.signal.aborted&&mounted.current){
   if(failure instanceof PerspectiveError&&failure.terminal&&id)setUnavailable(items=>new Set([...items,id]))
   if(failure instanceof PerspectiveError&&failure.retryAfterMs&&id)setRetryAt(items=>({...items,[id]:Date.now()+failure.retryAfterMs}))
   setError(failure instanceof PerspectiveError?failure.message:BUSY)
  }}finally{if(owner===generation.current&&mounted.current)setSwitching(false)}
 }
 const registerResetVerification=useCallback((verify:(signal:AbortSignal)=>Promise<void>)=>{resetVerifications.current.add(verify);return()=>{resetVerifications.current.delete(verify)}},[])
 useEffect(()=>{
  if(!notice)return
  const timer=setTimeout(()=>setNotice(''),3000)
  return()=>clearTimeout(timer)
 },[notice])
 useEffect(()=>{
  if(!resetRetryAt)return
  const owner=generation.current,timer=setTimeout(()=>{if(generation.current===owner)setResetRetryAt(0)},Math.max(0,resetRetryAt-Date.now()))
  return()=>clearTimeout(timer)
 },[resetRetryAt])
 function resetDemo():Promise<boolean>{
  const original=currentSession.current,owner=generation.current
  if(resetFlight.current?.generation===owner)return resetFlight.current.promise
  if(!canResetDemo(original?.persona)){setResetError(RESET_FORBIDDEN);return Promise.resolve(false)}
  if(adapter.mode==='live'&&(!original?.accessToken||original.marks?.demo!==true))return Promise.resolve(false)
  if(Date.now()<resetRetryAt)return Promise.resolve(false)
  const controller=new AbortController();resetAbort.current=controller;setResetting(true);setResetError('')
  function refreshAfterReset(replacement?:{accessToken:string;expiresAt:number}|null){
   // A reset returns the demo to its start state: the next reload offers the picker.
   clearRememberedPerspective()
   ++generation.current;transitionAbort.current?.abort();renewAbort.current?.abort();flight.current=null;backoff.current=0;notBefore.current=0
   const pending=[...cleanups.current],latest=currentSession.current??original;cleanups.current.clear()
   // Install the fresh bearer before a new generation can issue any reads.
   const next=latest?{...latest,generation:generation.current,...(replacement?{accessToken:replacement.accessToken,expiresAt:replacement.expiresAt}:{})}:null
   currentSession.current=next
   // A fresh generation owns new adapters. Dispose the old private stores without waiting
   // for unrelated reads or network cleanup before reporting a committed reset.
   for(const clear of pending)try{void Promise.resolve(clear()).catch(()=>{})}catch{}
   flushSync(()=>{setSession(next);setFamilies([]);setResetRetryAt(0);setResetting(false)})
   resetFlight.current=null
  }
  const promise=(async()=>{
   await Promise.resolve()
   const owns=()=>mounted.current&&generation.current===owner&&!controller.signal.aborted
   try{
    const receipt=await adapter.resetDemo(original?.accessToken,controller.signal,original?.persona.id)
    if(!owns())return false
    if((adapter.mode==='live'&&!receipt)||(receipt&&(receipt.status!=='committed'||!receipt.runId||receipt.personaId!==original?.persona.id)))throw new DemoResetError('uncertain')
    refreshAfterReset(receipt?.session)
    setNotice(RESET_COMPLETE);setResetError('');return true
   }catch(error){
    if(!owns())return false
    const failure=error instanceof DemoResetError?error:new DemoResetError('uncertain')
    if(failure.kind==='uncertain'){flushSync(()=>{setNotice('');setResetError(failure.message)});refreshAfterReset();return false}
    setResetError(failure.message)
    if(failure.kind==='cooldown')setResetRetryAt(Date.now()+failure.retryAfterMs)
    return false
   }finally{
    if(resetFlight.current?.generation===owner)resetFlight.current=null
    if(mounted.current&&generation.current===owner)setResetting(false)
   }
  })()
  resetFlight.current={generation:owner,promise};return promise
 }
 const renewSession=useCallback(async():Promise<AuthSession|null>=>{
  const original=currentSession.current,owner=generation.current
  if(!original?.accessToken||!original.expiresAt)return null
  if(flight.current?.generation===owner)return flight.current.promise
  if(Date.now()<notBefore.current)return null
  const controller=new AbortController();renewAbort.current=controller
  const promise=(async()=>{
   await Promise.resolve()
   try{
    const renewed=await adapter.signInAsPersona(original.persona.id,controller.signal)
    if(owner!==generation.current||controller.signal.aborted||!mounted.current)return null
    if(!renewed.expiresAt||renewed.expiresAt*1000<=Date.now()){expire();return null}
    const unchanged=renewed.expiresAt===original.expiresAt
    backoff.current=unchanged?Math.min(120000,backoff.current?backoff.current*2:30000):0
    notBefore.current=unchanged?Date.now()+backoff.current:0
    const next={...renewed,generation:owner};currentSession.current=next;setSession(next);setTick(t=>t+1);return next
   }catch(failure){
    if(owner!==generation.current||controller.signal.aborted||!mounted.current)return null
    backoff.current=Math.min(120000,backoff.current?backoff.current*2:30000)
    notBefore.current=Date.now()+Math.max(backoff.current,failure instanceof PerspectiveError?failure.retryAfterMs:0)
    if((original.expiresAt??0)*1000<=Date.now())expire();else setTick(t=>t+1)
    return null
   }finally{if(flight.current?.generation===owner)flight.current=null}
  })()
  flight.current={generation:owner,promise};return promise
 },[adapter,expire])
 useEffect(()=>{
  if(!session?.expiresAt)return
  const now=Date.now(),expiry=session.expiresAt*1000
  const delay=Math.max(0,expiry-240000-now,notBefore.current-now)
  const timer=setTimeout(()=>{void renewSession()},delay)
  // Expiry always has a separate safety timer, even if Retry-After extends past it.
  const end=setTimeout(()=>{const latest=currentSession.current;if(latest?.generation===session.generation&&(latest.expiresAt??0)*1000<=Date.now())expire()},Math.max(0,expiry-now)+5)
  return()=>{clearTimeout(timer);clearTimeout(end)}
 },[session?.expiresAt,session?.generation,tick,renewSession,expire])
 const runRead=useCallback(<T,>(read:()=>Promise<T>)=>{const owner=generation.current;return retryReadOnce('query',read,renewSession,()=>mounted.current&&generation.current===owner)},[renewSession])
 async function createDemoFamily(input:DemoFamilyInput){const owner=generation.current,value=await adapter.createDemoFamily(input);if(owner===generation.current)setFamilies(items=>[...items,value])}
 return <Context.Provider value={{session,switching,error,families,authMode:adapter.mode,notice,resetting,resetError,resetRetryAt,unavailable,retryAt,getSessionGeneration,getCurrentSession,renewSession,runRead,switchPerson:id=>transition(id),resetDemo,createDemoFamily,registerPrivateCleanup,registerResetVerification}}>{children}</Context.Provider>
}
export function useSession(){const value=useContext(Context);if(!value)throw new Error('SessionProvider is required');return value}
