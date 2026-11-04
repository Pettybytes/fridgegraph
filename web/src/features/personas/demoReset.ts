import {personas} from './auth'
import type {PersonaId} from './auth'
export const RESET_COMPLETE='Demo reset.'
export const RESET_COOLDOWN='Just reset. Try again in a moment.'
export const RESET_FORBIDDEN='Reset is available to parents, guardians and the Demo guide.'
export const RESET_FAILED="Couldn't reset just now; nothing was changed."
export const RESET_UNCERTAIN="Couldn't confirm the reset. Your perspective is still open. Check the latest demo data before trying again."
export type DemoResetReceipt={runId:string;status:'committed';personaId:PersonaId;session:{accessToken:string;expiresAt:number}|null}
export class DemoResetError extends Error{
 readonly kind:'failed'|'cooldown'|'readonly'|'forbidden'|'session'|'uncertain';readonly retryAfterMs:number
 constructor(kind:DemoResetError['kind'],retryAfterMs=0){super(kind==='cooldown'?RESET_COOLDOWN:kind==='readonly'?'Reset is not available for this perspective':kind==='forbidden'?RESET_FORBIDDEN:kind==='uncertain'?RESET_UNCERTAIN:RESET_FAILED);this.kind=kind;this.retryAfterMs=retryAfterMs}
}
function committed(body:Record<string,unknown>,runId:string,personaId?:PersonaId):DemoResetReceipt|null{
 if(body.runId!==runId||body.status!=='committed'||!personas.some(p=>p.id===body.personaId)||(personaId&&body.personaId!==personaId))return null
 if(body.session===null)return {runId,status:'committed',personaId:body.personaId as PersonaId,session:null}
 const session=body.session as Record<string,unknown>|undefined
 if(!session||typeof session.access_token!=='string'||!session.access_token||typeof session.token_type!=='string'||session.token_type.toLowerCase()!=='bearer'||typeof session.expires_in!=='number'||!Number.isFinite(session.expires_in)||session.expires_in<=0||typeof session.expires_at!=='number'||!Number.isFinite(session.expires_at)||session.expires_at*1000<=Date.now())return null
 return {runId,status:'committed',personaId:body.personaId as PersonaId,session:{accessToken:session.access_token,expiresAt:session.expires_at}}
}
// A lost response is recovered by reading this run. The mutation is never replayed.
export function createDemoReset(request:typeof fetch=fetch,timeoutMs=2000,recoveryMs=4000){
 return async(accessToken?:string,signal?:AbortSignal,personaId?:PersonaId):Promise<DemoResetReceipt>=>{
  if(!accessToken)throw new DemoResetError('session')
  const runId=crypto.randomUUID()
  const cancelled=()=>{if(signal?.aborted)throw new DOMException('Cancelled','AbortError')}
  async function call(url:string,method:'POST'|'GET',limit:number){
   cancelled()
   const controller=new AbortController(),cancel=()=>controller.abort()
   let timer:ReturnType<typeof setTimeout>|undefined
   const aborted=new Promise<never>((_,reject)=>{controller.signal.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')),{once:true})})
   signal?.addEventListener('abort',cancel,{once:true});timer=setTimeout(cancel,limit)
   try{
    return await Promise.race([(async()=>{
     const response=await request(url,{method,cache:'no-store',signal:controller.signal,headers:{Authorization:`Bearer ${accessToken}`,...(method==='POST'?{'Content-Type':'application/json'}:{})},...(method==='POST'?{body:JSON.stringify({runId})}:{})})
     let body:Record<string,unknown>={};try{const value=await response.json();if(value&&typeof value==='object')body=value}catch{}
     return {response,body}
    })(),aborted])
   }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel)}
  }
  try{
   const {response,body}=await call('/api/demo/reset','POST',timeoutMs)
   if(response.status===429)throw new DemoResetError('cooldown',typeof body.retryAfterMs==='number'&&Number.isFinite(body.retryAfterMs)?Math.max(0,body.retryAfterMs):30000)
   if(response.status===401)throw new DemoResetError('session')
   if(response.status===403&&body.error==='RESET_NOT_ALLOWED')throw new DemoResetError('forbidden')
   if(response.status===403&&body.error==='DEMO_GUIDE_READ_ONLY')throw new DemoResetError('readonly')
   if(response.status===403&&['LOOPBACK_ONLY','DEMO_SESSION_REQUIRED'].includes(String(body.error)))throw new DemoResetError('failed')
   if(!response.ok&&body.error==='RESET_FAILED')throw new DemoResetError('failed')
   const result=response.ok&&body.ok===true?committed(body,runId,personaId):null
   if(result){cancelled();return result}
  }catch(error){cancelled();if(error instanceof DemoResetError)throw error}
  const deadline=Date.now()+recoveryMs
  while(Date.now()<deadline){
   cancelled()
   try{
    const {response,body}=await call(`/api/demo/reset/${runId}`,'GET',Math.min(timeoutMs,deadline-Date.now()))
    const result=response.ok?committed(body,runId,personaId):null
    if(result){cancelled();return result}
    if(body.runId===runId&&body.status==='failed')throw new DemoResetError('failed')
    if(response.ok&&(body.runId!==runId||body.status!=='running'))throw new DemoResetError('uncertain')
   }catch(error){cancelled();if(error instanceof DemoResetError)throw error}
   if(Date.now()<deadline)await new Promise<void>((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);reject(new DOMException('Cancelled','AbortError'))},timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve()},Math.min(250,deadline-Date.now()))
    signal?.addEventListener('abort',abort,{once:true})
   })
  }
  cancelled();throw new DemoResetError('uncertain')
 }
}
