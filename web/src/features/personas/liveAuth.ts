import {personas} from './auth'
import type {AuthAdapter,AuthSession,PersonaId,Persona} from './auth'
export const BUSY='Busy, try again in a moment'
export class PerspectiveError extends Error {
 readonly terminal:boolean;readonly retryAfterMs:number
 constructor(terminal=false,retryAfterMs=0){super(terminal?'Not set up in this demo yet':BUSY);this.terminal=terminal;this.retryAfterMs=retryAfterMs}
}
export function retryDelay(value:string|null,now=Date.now()){
 if(!value)return 0
 const seconds=Number(value)
 return Number.isFinite(seconds)?Math.max(0,seconds*1000):Math.max(0,(Date.parse(value)||now)-now)
}
export function createLiveAuthAdapter(request:typeof fetch=fetch):AuthAdapter {
 let notBefore=0
 async function choose(id:PersonaId,signal?:AbortSignal):Promise<Omit<AuthSession,'generation'>>{
  try{
   if(Date.now()<notBefore)throw new PerspectiveError(false,notBefore-Date.now())
   const response=await request('/api/demo/login',{method:'POST',signal,cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({personaId:id})})
   if(response.status===429){const delay=Math.max(1000,retryDelay(response.headers.get('Retry-After')));notBefore=Date.now()+delay;throw new PerspectiveError(false,delay)}
   if(!response.ok)throw new PerspectiveError()
   const body=await response.json()
   if(body.status==='UNAVAILABLE' && body.personaId===id && ['UNKNOWN_PERSONA','NO_SEEDED_IDENTITY'].includes(body.reason))throw new PerspectiveError(true)
   const p=body.persona,t=body.session,s=body.scope,m=body.marks,expected=personas.find(p=>p.id===id)
   // No substitute identity and no response/session object spread into browser state.
   if(body.status!=='READY'||body.personaId!==id||p?.id!==id||p?.personId!==body.personId||body.personId!==expected?.personId||!s||p.childId!==s.childId||p.villageId!==s.villageId||typeof t?.access_token!=='string'||!t.access_token||t.token_type?.toLowerCase()!=='bearer'||!Number.isFinite(t.expires_at)||!Number.isFinite(t.expires_in)||m?.demo!==true||typeof m.demoGuide!=='boolean'||!Array.isArray(p.grants)||!p.grants.every((g:unknown)=>typeof g==='string')||typeof p.parent!=='boolean')throw new PerspectiveError()
   for(const v of [p.personId,p.name,p.role,p.childId,p.childName,p.villageId,s.childName,s.parentName])if(typeof v!=='string'||!v)throw new PerspectiveError()
   const persona:Persona={id,personId:p.personId,name:p.name,role:p.role,childId:p.childId,childName:p.childName,villageId:p.villageId,grants:[...p.grants],parent:p.parent,...(p.guardian===true?{guardian:true}:{}),...(['calendar','village'].includes(p.initialRoute)?{initialRoute:p.initialRoute}:{})}
   return {persona,scope:{childId:s.childId,childName:s.childName,parentName:s.parentName,villageId:s.villageId},accessToken:t.access_token,expiresAt:t.expires_at,marks:{demo:m.demo,demoGuide:m.demoGuide}}
  }catch(error){if(signal?.aborted)throw new DOMException('Cancelled','AbortError');throw error instanceof PerspectiveError?error:new PerspectiveError()}
 }
 return {mode:'live',signInAsPersona:choose,
  async unavailablePersonas(signal){
   try{
    const response=await request('/api/demo/health',{signal,cache:'no-store'})
    if(!response.ok)return []
    const health=await response.json();if(!Array.isArray(health.personas))return []
    const missing:PersonaId[]=[]
    for(const row of health.personas){
     if(row.ready!==false||!personas.some(p=>p.id===row.personaId))continue
     try{await choose(row.personaId,signal)}catch(error){if(error instanceof PerspectiveError&&error.terminal)missing.push(row.personaId)}
    }
    return missing
   }catch{return []}
  },
  async resetDemo(){throw new PerspectiveError()},async createDemoFamily(){throw new PerspectiveError()},
 }
}
