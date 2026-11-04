import type {RosinaAdapter,RosinaRequest,RosinaResponse} from './adapter'
import {parseSchoolReportProposal} from './schoolReport'
import {parseAddVillagerProposal} from '@/features/add-villager/addVillager'
export const LIVE_FALLBACK="I couldn't check that just now. Please try again in a moment."
export class RosinaCancelled extends Error { constructor(){super('Rosina request cancelled');this.name='AbortError'} }
export type RosinaProgress='sending'|'waiting'|'reading'
type Options={
 onProgress?:(phase:RosinaProgress)=>void
 /** Streaming callbacks. Token text is PROVISIONAL: the resolved RosinaResponse is authoritative
  * and the panel swaps it in at the end (identical text in the normal case). */
 onToken?:(text:string,turnId?:number)=>void
 onStatus?:(label:string,turnId?:number)=>void
 onReplace?:(turnId?:number)=>void
 /** A server-validated action proposal streamed mid-turn, so the confirmation card can render a
  * full model round before the closing text. Provisional like tokens: the resolved response's
  * actions stay authoritative, and a `replace` event discards what was streamed. */
 onAction?:(action:{id:string;args:Record<string,unknown>},turnId?:number)=>void
 getGeneration?:()=>number|null
 request?:typeof fetch
 timeoutMs?:number
}
function parseFinal(body:unknown):RosinaResponse|null{
 if(!body||typeof body!=='object'||!('reply' in body)||typeof body.reply!=='string'||!('actions' in body)||!Array.isArray(body.actions))return null
 return {reply:body.reply,actions:body.actions,schoolReportProposal:'schoolReportProposal'in body?parseSchoolReportProposal(body.schoolReportProposal):null,addVillagerProposal:'addVillagerProposal'in body?parseAddVillagerProposal(body.addVillagerProposal):null}
}
// Token and generation getters read the CURRENT in-memory session, never a captured bearer.
export function createLiveRosinaAdapter(getAccessToken:()=>string|null|undefined|Promise<string|null|undefined>,{getGeneration=()=>0,request=fetch,timeoutMs=35000,onProgress,onToken,onStatus,onReplace,onAction}:Options={}):RosinaAdapter {
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
  // For a streaming reply this acts as an INACTIVITY window (reset on every received chunk),
  // so an actively-talking Rosina is never cut off at the old total budget.
  let timer=setTimeout(()=>{timedOut=true;controller.abort()},timeoutMs)
  const resetTimer=()=>{clearTimeout(timer);timer=setTimeout(()=>{timedOut=true;controller.abort()},timeoutMs)}
  try {
   const work=(async():Promise<RosinaResponse>=>{
    const token=await getAccessToken()
    if(cancelled()||controller.signal.aborted)throw new RosinaCancelled()
    if(!token)return {reply:'Please sign in again',actions:[],notice:'sign-in' as const}
    onProgress?.('sending')
    const pending=request('/api/rosina',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json',Accept:'text/event-stream, application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({message:input.message,currentRoute:input.currentRoute,history:input.history.slice(-40).map(item=>({role:item.role,content:item.content.slice(0,4000)}))})})
    onProgress?.('waiting')
    const response=await pending
    if(!cancelled())onProgress?.('reading')
    if(response.status===401)return {reply:'Please sign in again',actions:[],notice:'sign-in' as const}
    if(response.status===429)return {reply:'Give me a moment',actions:[],notice:'rate-limit' as const}
    if(!response.ok)return {reply:LIVE_FALLBACK,actions:[]}
    const contentType=response.headers.get('content-type')??''
    if(contentType.includes('text/event-stream')&&response.body){
     const reader=response.body.getReader(),decoder=new TextDecoder()
     let buffer='',eventType='',final:RosinaResponse|null=null
     // The `final` event IS the reply. Resolve on it immediately: an edge or tunnel that holds
     // the connection open after the server ends must never hold the UI's busy state hostage
     // (Wonder's gate measured 20s+ of blocked Send waiting for stream close).
     readLoop: for(;;){
      const {done,value}=await reader.read()
      if(done)break
      resetTimer()
      buffer+=decoder.decode(value,{stream:true})
      for(;;){
       const nl=buffer.indexOf('\n')
       if(nl===-1)break
       const line=buffer.slice(0,nl).replace(/\r$/,'')
       buffer=buffer.slice(nl+1)
       if(line.startsWith('event:')){eventType=line.slice(6).trim();continue}
       if(!line.startsWith('data:'))continue
       let payload:unknown
       try{payload=JSON.parse(line.slice(5).trim())}catch{continue}
       if(cancelled()||controller.signal.aborted)continue
       if(eventType==='token'&&payload&&typeof payload==='object'&&typeof (payload as {text?:unknown}).text==='string')onToken?.((payload as {text:string}).text,input.turnId)
       else if(eventType==='status'&&payload&&typeof payload==='object'&&typeof (payload as {label?:unknown}).label==='string')onStatus?.((payload as {label:string}).label,input.turnId)
       else if(eventType==='replace')onReplace?.(input.turnId)
       else if(eventType==='action'&&payload&&typeof payload==='object'){const action=(payload as {action?:unknown}).action;if(action&&typeof action==='object'&&typeof (action as {id?:unknown}).id==='string')onAction?.(action as {id:string;args:Record<string,unknown>},input.turnId)}
       else if(eventType==='final'){final=parseFinal(payload);break readLoop}
      }
     }
     reader.cancel().catch(()=>{})
     return final??{reply:LIVE_FALLBACK,actions:[]}
    }
    const body:unknown=await response.json()
    return parseFinal(body)??{reply:LIVE_FALLBACK,actions:[]}
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
