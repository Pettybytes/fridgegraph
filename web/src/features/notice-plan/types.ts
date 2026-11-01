// Notice → Plan contract §§2, 4 and 5; mock transport only until the service is deployed.
export type NoticeInput =
  | { kind: 'text'; text: string }
  | { kind: 'image'; mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; dataBase64: string }
  | { kind: 'pdf'; mimeType: 'application/pdf'; dataBase64: string }
export type NoticeRequest =
  | { childId: string; notice: NoticeInput }
  | { childId: string; resume: { proposalId: string; version: number; answer: string } }
export type NoticeSource =
  | { type: 'verified_quote'; quote: string; startOffset: number; endOffset: number }
  | { type: 'transcription'; text: string; ref: 'image' | 'pdf:p1' }
export type PickupParams = { asOf: string; window: 'morning' | 'afternoon' | 'evening' }
export type NoticeConfirmAction = { action: 'requestPickup'; params: PickupParams }
export type NoticeChange = {
  what: string
  source: NoticeSource
  whyItMatters: string
  whoAffected: string
  unknown: string[]
  onConfirm: NoticeConfirmAction | { available: false; note: string }
}
// Opaque signed claims are echoed verbatim. The browser never computes or edits them.
export type NoticeClaims = {
  proposalId: string
  version: number
  callerId: string
  childId: string
  scenarioDate: string
  action: 'requestPickup' | 'none'
  params: PickupParams | null
  scheduleFingerprint: string
  expiresAt: string
}
export type NoticeProposal = {
  proposalId: string
  version: number
  childId: string
  scenario: { referenceDate: string; timezone: 'America/Detroit' }
  source: { processingSource: 'text' | 'image' | 'pdf:rasterized'; modelId: string }
  createdAt: string
  expiresAt: string
  changes: NoticeChange[]
  clarification: { question: string } | null
  claims: NoticeClaims
  signature: string
}
export type NoticeConfirmResult = { job: { id: string; status: string } }
export type NoticeErrorCode =
  | 'UNAUTHENTICATED' | 'UNAUTHORIZED' | 'INVALID_PROPOSAL' | 'PROPOSAL_EXPIRED'
  | 'PROPOSAL_STALE' | 'NO_ACTION_AVAILABLE' | 'UNSUPPORTED_MEDIA_TYPE'
  | 'PAYLOAD_TOO_LARGE' | 'PDF_NOT_SUPPORTED' | 'RATE_LIMITED' | 'UNAVAILABLE'
export class NoticeFailure extends Error {
  readonly code: NoticeErrorCode
  constructor(code: NoticeErrorCode) { super(code); this.code = code }
}
export interface NoticeAdapter {
  readonly mode: 'mock'
  prepare(request: NoticeRequest, signal: AbortSignal): Promise<NoticeProposal>
  confirm(proposal: NoticeProposal, signal: AbortSignal): Promise<NoticeConfirmResult>
}
