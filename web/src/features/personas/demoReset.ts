export const RESET_COMPLETE='Demo reset. Choose a perspective.'
export const RESET_COOLDOWN='Just reset. Try again in a moment.'
export const RESET_FAILED="Couldn't reset just now; nothing was changed."
// Bryan approved distinct wording: losing the response cannot prove that a reset rolled back.
export const RESET_UNCERTAIN="Couldn't confirm the reset. Choose a perspective again."
export class DemoResetError extends Error{
 readonly kind:'failed'|'cooldown'|'readonly'|'session'|'uncertain';readonly retryAfterMs:number
 constructor(kind:DemoResetError['kind'],retryAfterMs=0){super(kind==='cooldown'?RESET_COOLDOWN:kind==='readonly'?'Demo guide is read-only':kind==='uncertain'?RESET_UNCERTAIN:RESET_FAILED);this.kind=kind;this.retryAfterMs=retryAfterMs}
}
// Mutating, shared operation: one request, current caller bearer, no renewal or retry path.
export function createDemoReset(request:typeof fetch=fetch,timeoutMs=60000){
 return async(accessToken?:string,signal?:AbortSignal):Promise<void>=>{
  if(!accessToken)throw new DemoResetError('session')
  const controller=new AbortController();let rejectAbort!:(error:unknown)=>void
  const aborted=new Promise<never>((_,reject)=>{rejectAbort=reject})
  const cancel=()=>controller.abort(),onAbort=()=>rejectAbort(new DOMException('Cancelled','AbortError'))
  controller.signal.addEventListener('abort',onAbort,{once:true});signal?.addEventListener('abort',cancel,{once:true})
  const timer=setTimeout(cancel,timeoutMs)
  try{
   if(signal?.aborted)throw new DOMException('Cancelled','AbortError')
   const work=(async()=>{
    const response=await request('/api/demo/reset',{method:'POST',cache:'no-store',signal:controller.signal,headers:{Authorization:`Bearer ${accessToken}`}})
    let body:Record<string,unknown>|null=null;try{body=await response.json()}catch{}
    if(response.status===429)throw new DemoResetError('cooldown',typeof body?.retryAfterMs==='number'&&Number.isFinite(body.retryAfterMs)?Math.max(0,body.retryAfterMs):30000)
    if(response.status===401)throw new DemoResetError('session')
    if(response.status===403&&body?.error==='DEMO_GUIDE_READ_ONLY')throw new DemoResetError('readonly')
    if(response.status===403&&['LOOPBACK_ONLY','DEMO_SESSION_REQUIRED'].includes(String(body?.error)))throw new DemoResetError('failed')
    if(!response.ok&&body?.error==='RESET_FAILED')throw new DemoResetError('failed')
    if(!response.ok||body?.ok!==true)throw new DemoResetError('uncertain')
   })()
   await Promise.race([work,aborted])
   if(signal?.aborted)throw new DOMException('Cancelled','AbortError')
  }catch(error){
   if(signal?.aborted)throw new DOMException('Cancelled','AbortError')
   throw error instanceof DemoResetError?error:new DemoResetError('uncertain')
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);controller.signal.removeEventListener('abort',onAbort)}
 }
}
