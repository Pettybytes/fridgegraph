import type {RosinaAdapter,RosinaRequest,RosinaResponse} from './adapter'
export const LIVE_FALLBACK="I couldn't check that just now. Please try again in a moment."
export class RosinaCancelled extends Error { constructor(){super('Rosina request cancelled');this.name='AbortError'} }
export type RosinaProgress='sending'|'waiting'|'reading'
type Options={onProgress?:(phase:RosinaProgress)=>void;getGeneration?:()=>number|null;request?:typeof fetch;timeoutMs?:number}
// Token and generation getters read the CURRENT in-memory session, never a captured bearer.
export function createLiveRosinaAdapter(getAccessToken:()=>string|null|undefined|Promise<string|null|undefined>,{getGeneration=()=>0,request=fetch,timeoutMs=35000,onProgress}:Options={}):RosinaAdapter {
 return {mode:'live',async send(input:RosinaRequest,signal?:AbortSignal):Promise<RosinaResponse>{
  const generation=getGeneration(),controller=new AbortController()
  let timedOut=false
  const changed=()=>getGeneration()!==generation
  const cancelled=()=>signal?.aborted||changed()
  const cancel=()=>controller.abort()
  if(cancelled())throw new RosinaCancelled()
  signal?.addEventListener('abort',cancel,{once:true})
  let rejectAbort:(reason:unknown)=>void=()=>{}
  const aborted=new Promise<never>((_,reject)=>{rejectAbort=reject})
  const onAbort=()=>rejectAbort(new RosinaCancelled())
  controller.signal.addEventListener('abort',onAbort,{once:true})
  const timer=setTimeout(()=>{timedOut=true;controller.abort()},timeoutMs)
  try {
   const work=(async()=>{
    const token=await getAccessToken()
    if(cancelled()||controller.signal.aborted)throw new RosinaCancelled()
    if(!token)return {reply:'Please sign in again',actions:[],notice:'sign-in' as const}
    onProgress?.('sending')
    const pending=request('/api/rosina',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({message:input.message,currentRoute:input.currentRoute,history:input.history.slice(-40).map(item=>({role:item.role,content:item.content.slice(0,4000)}))})})
    onProgress?.('waiting')
    const response=await pending
    if(!cancelled())onProgress?.('reading')
    if(response.status===401)return {reply:'Please sign in again',actions:[],notice:'sign-in' as const}
    if(response.status===429)return {reply:'Give me a moment',actions:[],notice:'rate-limit' as const}
    if(!response.ok)return {reply:LIVE_FALLBACK,actions:[]}
    const body:unknown=await response.json()
    if(!body||typeof body!=='object'||!('reply' in body)||typeof body.reply!=='string'||!('actions' in body)||!Array.isArray(body.actions))return {reply:LIVE_FALLBACK,actions:[]}
    return {reply:body.reply,actions:body.actions}
   })()
   const result=await Promise.race([work,aborted])
   if(cancelled()||controller.signal.aborted)throw new RosinaCancelled()
   return result
  }catch(error){
   if(cancelled())throw new RosinaCancelled()
   if(!timedOut&&controller.signal.aborted)throw new RosinaCancelled()
   // No raw errors, response bodies, credentials or mock content escape the live boundary.
   return {reply:LIVE_FALLBACK,actions:[]}
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);controller.signal.removeEventListener('abort',onAbort)}
 }}
}
