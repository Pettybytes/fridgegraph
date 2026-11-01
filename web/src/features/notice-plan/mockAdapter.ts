import {sampleText,isEarlyDismissalSample} from './samples'
import {NoticeFailure,type NoticeAdapter,type NoticeProposal} from './types'
// No model, network, records or confirm method. Only Claude's exact published sample
// gets a scripted conflict; arbitrary input never inherits its schedule facts.
export function createMockNoticeAdapter(childName:string):NoticeAdapter{
 let version=0
 return {mode:'mock',async prepare(request,signal){
  await Promise.resolve()
  if(signal.aborted)throw new DOMException('Aborted','AbortError')
  if('resume' in request)throw new NoticeFailure('INVALID_PROPOSAL')
  const sample=request.notice.kind==='text'?request.notice.text.trim()===sampleText.trim():await isEarlyDismissalSample(request.notice.kind,request.notice.dataBase64)
  if(signal.aborted)throw new DOMException('Aborted','AbortError')
  if(sample&&request.childId!=='p_nora')throw new NoticeFailure('UNAUTHORIZED')
  if(sample){
   const now=new Date(),quote='Students will be released at 12:30 PM instead of the usual 3:00 PM.'
   const text=request.notice.kind==='text'?request.notice.text:sampleText
   return {proposalId:'mock-early-dismissal',version:++version,childId:request.childId,scenario:{referenceDate:'2026-10-26',timezone:'America/Detroit'},source:{processingSource:request.notice.kind==='pdf'?'pdf:rasterized':request.notice.kind,modelId:'mock-no-model'},createdAt:now.toISOString(),expiresAt:new Date(now.getTime()+15*60*1000).toISOString(),signature:'mock-only',changes:[{what:'Early dismissal on October 26 at 12:30 PM',source:request.notice.kind==='text'?{type:'verified_quote',quote,startOffset:text.indexOf(quote),endOffset:text.indexOf(quote)+quote.length}:{type:'transcription',text:quote,ref:request.notice.kind==='pdf'?'pdf:p1':'image'},whyItMatters:"Mock schedule: Nora’s recorded pickup is at 3:00 PM. Dismissal is 2 hours 30 minutes earlier, and the notice says there is no afternoon aftercare.",whoAffected:'Nora and her pickup caregivers',unknown:['Who can cover the earlier pickup has not been checked.'],onConfirm:{available:false,note:'Pickup confirmation is not connected yet. No request will be created.'}}],clarification:null} satisfies NoticeProposal
  }
  if(request.notice.kind!=='text')throw new NoticeFailure('UNAVAILABLE')
  const now=new Date(),quote=request.notice.text
  return {proposalId:'mock-local-notice',version:++version,childId:request.childId,scenario:{referenceDate:now.toLocaleDateString('en-CA',{timeZone:'America/Detroit'}),timezone:'America/Detroit'},source:{processingSource:'text',modelId:'mock-no-model'},createdAt:now.toISOString(),expiresAt:new Date(now.getTime()+15*60*1000).toISOString(),signature:'mock-only',changes:[{what:'Notice text ready for review',source:{type:'verified_quote',quote,startOffset:0,endOffset:quote.length},whyItMatters:'No schedule comparison has been made in this mock.',whoAffected:childName,unknown:['The notice has not been interpreted. Conflicts and proposed actions are not available yet.'],onConfirm:{available:false,note:'Noted, no action available.'}}],clarification:null} satisfies NoticeProposal
 }}
}
export function noticeErrorMessage(error:unknown){
 if(!(error instanceof NoticeFailure))return 'Couldn’t review this notice just now.'
 const messages:Record<NoticeFailure['code'],string>={
  UNAUTHENTICATED:'Your session ended. Choose a perspective again.',
  UNAUTHORIZED:'This notice isn’t shared with you.',
  INVALID_PROPOSAL:'This proposal can’t be used. Review the notice again.',
  PROPOSAL_EXPIRED:'This proposal expired. Review the notice again.',
  PROPOSAL_STALE:'The schedule changed. Review the notice again.',
  NO_ACTION_AVAILABLE:'Noted, no action available.',
  UNSUPPORTED_MEDIA_TYPE:'Use a PNG, JPEG, WebP or PDF file, or paste plain text.',
  PAYLOAD_TOO_LARGE:'Use a file up to 8 MB or paste up to 20,000 characters.',
  PDF_NOT_SUPPORTED:'PDF review isn’t available yet. Paste the notice text instead.',
  RATE_LIMITED:'Give it a moment before reviewing another notice.',
  UNAVAILABLE:'This mock can hold the file, but image and PDF review aren’t connected yet.',
 }
 return messages[error.code]
}
