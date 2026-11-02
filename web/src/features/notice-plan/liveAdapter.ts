import {NoticeFailure,type NoticeAdapter,type NoticeConfirmResult,type NoticeErrorCode,type NoticeProposal} from './types'

// This transport is selected only after the merged endpoint is verified served.
// Every request reads the current in-memory persona bearer; no token is cached here.
type Bearer=()=>string|undefined|null
type Send=typeof fetch
const errors=new Set<NoticeErrorCode>([
 'UNAUTHENTICATED','UNAUTHORIZED','INVALID_PROPOSAL','PROPOSAL_EXPIRED','PROPOSAL_STALE',
 'NO_ACTION_AVAILABLE','UNSUPPORTED_MEDIA_TYPE','PAYLOAD_TOO_LARGE','PDF_NOT_SUPPORTED',
 'RATE_LIMITED','UNAVAILABLE','INVALID_REQUEST','EXTRACTION_FAILED','PICKUP_FAILED',
])
const object=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value)
const string=(value:unknown):value is string=>typeof value==='string'&&value.length>0
const pickupParams=(value:unknown):boolean=>object(value)&&string(value.asOf)&&['morning','afternoon','evening'].includes(String(value.window))

function proposalFrom(value:unknown):NoticeProposal{
 if(!object(value)||!string(value.proposalId)||typeof value.version!=='number'||!string(value.childId)||!object(value.scenario)||!string(value.scenario.referenceDate)||value.scenario.timezone!=='America/Detroit'||!object(value.source)||!['text','image','pdf:rasterized'].includes(String(value.source.processingSource))||!string(value.source.modelId)||!string(value.createdAt)||!string(value.expiresAt)||!string(value.signature)||!object(value.claims)||!Array.isArray(value.changes))throw new NoticeFailure('UNAVAILABLE')
 const claims=value.claims
 if(claims.proposalId!==value.proposalId||claims.version!==value.version||claims.childId!==value.childId||claims.scenarioDate!==value.scenario.referenceDate||claims.expiresAt!==value.expiresAt||!string(claims.callerId)||!string(claims.scenarioDate)||!string(claims.scheduleFingerprint)||!string(claims.expiresAt)||!['requestPickup','none'].includes(String(claims.action))||(claims.action==='requestPickup'&&!pickupParams(claims.params))||(claims.action==='none'&&claims.params!==null))throw new NoticeFailure('UNAVAILABLE')
 for(const change of value.changes){
  if(!object(change)||!string(change.what)||!object(change.source)||!string(change.whyItMatters)||!string(change.whoAffected)||!Array.isArray(change.unknown)||!change.unknown.every(string)||!object(change.onConfirm))throw new NoticeFailure('UNAVAILABLE')
  const source=change.source,action=change.onConfirm
  if(source.type==='verified_quote'){
   if(!string(source.quote)||typeof source.startOffset!=='number'||typeof source.endOffset!=='number')throw new NoticeFailure('UNAVAILABLE')
  }else if(source.type==='transcription'){
   if(!string(source.text)||!['image','pdf:p1'].includes(String(source.ref)))throw new NoticeFailure('UNAVAILABLE')
  }else throw new NoticeFailure('UNAVAILABLE')
  if(action.action==='requestPickup'){
   if(!pickupParams(action.params))throw new NoticeFailure('UNAVAILABLE')
  }else if(action.available!==false||!string(action.note))throw new NoticeFailure('UNAVAILABLE')
 }
 if(value.clarification!==null&&(!object(value.clarification)||!string(value.clarification.question)))throw new NoticeFailure('UNAVAILABLE')
 return value as NoticeProposal
}

function resultFrom(value:unknown):NoticeConfirmResult{
 if(!object(value)||!object(value.job)||!string(value.job.id)||!string(value.job.status))throw new NoticeFailure('UNAVAILABLE')
 return {job:{id:value.job.id,status:value.job.status}}
}

export function createLiveNoticeAdapter(getAccessToken:Bearer,send:Send=fetch):NoticeAdapter{
 async function post(path:string,body:unknown,signal:AbortSignal):Promise<unknown>{
  const token=getAccessToken()
  if(!token)throw new NoticeFailure('UNAUTHENTICATED')
  let response:Response
  try{response=await send(path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body),signal,cache:'no-store'})}
  catch(error){if(signal.aborted)throw error;throw new NoticeFailure('UNAVAILABLE')}
  let payload:unknown
  try{payload=await response.json()}catch{throw new NoticeFailure('UNAVAILABLE')}
  if(!response.ok){
   const code=object(payload)&&typeof payload.error==='string'&&errors.has(payload.error as NoticeErrorCode)?payload.error as NoticeErrorCode:'UNAVAILABLE'
   throw new NoticeFailure(code)
  }
  return payload
 }
 return {
  mode:'live',
  async prepare(request,signal){return proposalFrom(await post('/api/rosina/notice-plan',request,signal))},
  async confirm(proposal,signal){
   // Merged noticeEndpoint.ts accepts the exact signed claims and signature,
   // not the flat fields in the old §5 example. Do not alter signed params.
   return resultFrom(await post('/api/rosina/notice-plan/confirm',{claims:proposal.claims,signature:proposal.signature},signal))
  },
 }
}
