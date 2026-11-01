// Stable §§2,4,4b of notice-plan.md, backend contract b0ce3aa.
// No confirmable onConfirm mapping is invented while its envelope shape is unpublished.
export type NoticeInput={kind:'text';text:string}|{kind:'image';mimeType:'image/png'|'image/jpeg'|'image/webp';dataBase64:string}|{kind:'pdf';mimeType:'application/pdf';dataBase64:string}
export type NoticeRequest={childId:string;notice:NoticeInput}|{childId:string;resume:{proposalId:string;version:number;answer:string}}
export type NoticeSource={type:'verified_quote';quote:string;startOffset:number;endOffset:number}|{type:'transcription';text:string;ref:'image'|'pdf:p1'}
export type NoticeChange={what:string;source:NoticeSource;whyItMatters:string;whoAffected:string;unknown:string[];onConfirm:{available:false;note:string}|{available:true;[pendingField:string]:unknown}}
export type NoticeProposal={proposalId:string;version:number;childId:string;scenario:{referenceDate:string;timezone:'America/Detroit'};source:{processingSource:'text'|'image'|'pdf:rasterized';modelId:string};createdAt:string;expiresAt:string;changes:NoticeChange[];clarification:{question:string}|null;signature:string}
export type NoticeErrorCode='UNAUTHENTICATED'|'UNAUTHORIZED'|'INVALID_PROPOSAL'|'PROPOSAL_EXPIRED'|'PROPOSAL_STALE'|'NO_ACTION_AVAILABLE'|'UNSUPPORTED_MEDIA_TYPE'|'PAYLOAD_TOO_LARGE'|'PDF_NOT_SUPPORTED'|'RATE_LIMITED'|'UNAVAILABLE'
export class NoticeFailure extends Error {readonly code:NoticeErrorCode;constructor(code:NoticeErrorCode){super(code);this.code=code}}
export interface NoticeAdapter {readonly mode:'mock';prepare(request:NoticeRequest,signal:AbortSignal):Promise<NoticeProposal>}
