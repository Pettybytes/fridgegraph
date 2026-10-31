import {createContext,useContext,useRef,useState,useCallback,useEffect} from 'react'
import type {ReactNode} from 'react'
import {flushSync} from 'react-dom'
import type {AuthAdapter,AuthSession,DemoFamily,DemoFamilyInput,PersonaId} from './auth'
import {BUSY,PerspectiveError} from './liveAuth'
import {retryReadOnce} from './renewal'
type Cleanup=()=>void|Promise<unknown>
type SessionContextValue={
 session:AuthSession|null;switching:boolean;error:string;families:DemoFamily[];authMode:AuthAdapter['mode'];unavailable:ReadonlySet<PersonaId>;retryAt:Partial<Record<PersonaId,number>>
 getSessionGeneration():number;getCurrentSession():AuthSession|null;renewSession():Promise<AuthSession|null>
 runRead<T>(read:()=>Promise<T>):Promise<T>
 switchPerson(id?:PersonaId):Promise<void>;resetDemo():Promise<void>;createDemoFamily(input:DemoFamilyInput):Promise<void>;registerPrivateCleanup(cleanup:Cleanup):()=>void
}
const Context=createContext<SessionContextValue|null>(null)
export function SessionProvider({adapter,children}:{adapter:AuthAdapter;children:ReactNode}){
 const [session,setSession]=useState<AuthSession|null>(null),[switching,setSwitching]=useState(false),[error,setError]=useState(''),[families,setFamilies]=useState<DemoFamily[]>([])
 const [unavailable,setUnavailable]=useState<Set<PersonaId>>(new Set()),[retryAt,setRetryAt]=useState<Partial<Record<PersonaId,number>>>({})
 const [tick,setTick]=useState(0)
 const generation=useRef(0),currentSession=useRef<AuthSession|null>(null),cleanups=useRef(new Set<Cleanup>()),transitionAbort=useRef<AbortController|null>(null),renewAbort=useRef<AbortController|null>(null)
 const flight=useRef<{generation:number;promise:Promise<AuthSession|null>}|null>(null),backoff=useRef(0),notBefore=useRef(0),mounted=useRef(true)
 const getSessionGeneration=useCallback(()=>generation.current,[]),getCurrentSession=useCallback(()=>currentSession.current,[])
 const registerPrivateCleanup=useCallback((clear:Cleanup)=>{cleanups.current.add(clear);return()=>{cleanups.current.delete(clear)}},[])
 useEffect(()=>{mounted.current=true;const signal=new AbortController();if(adapter.unavailablePersonas)void adapter.unavailablePersonas(signal.signal).then(ids=>{if(!signal.signal.aborted)setUnavailable(new Set(ids))});return()=>{mounted.current=false;signal.abort();++generation.current;transitionAbort.current?.abort();renewAbort.current?.abort();currentSession.current=null;flight.current=null}},[adapter])
 function discard(){
  ++generation.current;transitionAbort.current?.abort();renewAbort.current?.abort();flight.current=null;currentSession.current=null;backoff.current=0;notBefore.current=0
  const pending=[...cleanups.current];cleanups.current.clear();return pending
 }
 const expire=useCallback(()=>{
  const pending=discard();setSession(null);setSwitching(false);setFamilies([]);setError('Your session ended, choose a perspective again')
  void Promise.allSettled(pending.map(clear=>clear()))
 },[])
 async function transition(id?:PersonaId,reset=false){
  if(id&&(retryAt[id]??0)>Date.now()){setError(BUSY);return}
  const hadSession=!!currentSession.current,pending=discard(),owner=generation.current,controller=new AbortController();transitionAbort.current=controller
  flushSync(()=>{setSession(null);setSwitching(true);setError('');setFamilies([])})
  if(hadSession||reset)window.history.replaceState(null,'',`${location.pathname}${location.search}#/mission-control`)
  try{
   await Promise.all(pending.map(clear=>clear()))
   if(owner!==generation.current)return
   if(reset)await adapter.resetDemo()
   const next=id?await adapter.signInAsPersona(id,controller.signal):null
   if(owner!==generation.current||controller.signal.aborted||!mounted.current)return
   if(next?.persona.initialRoute)window.history.replaceState(null,'',`${location.pathname}${location.search}#/${next.persona.initialRoute}`)
   const value=next?{...next,generation:owner}:null;currentSession.current=value;setSession(value)
  }catch(failure){if(owner===generation.current&&!controller.signal.aborted&&mounted.current){
   if(failure instanceof PerspectiveError&&failure.terminal&&id)setUnavailable(items=>new Set([...items,id]))
   if(failure instanceof PerspectiveError&&failure.retryAfterMs&&id)setRetryAt(items=>({...items,[id]:Date.now()+failure.retryAfterMs}))
   setError(failure instanceof PerspectiveError?failure.message:BUSY)
  }}finally{if(owner===generation.current&&mounted.current)setSwitching(false)}
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
 return <Context.Provider value={{session,switching,error,families,authMode:adapter.mode,unavailable,retryAt,getSessionGeneration,getCurrentSession,renewSession,runRead,switchPerson:id=>transition(id),resetDemo:()=>transition(undefined,true),createDemoFamily,registerPrivateCleanup}}>{children}</Context.Provider>
}
export function useSession(){const value=useContext(Context);if(!value)throw new Error('SessionProvider is required');return value}
