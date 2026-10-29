export const TRAVEL_COST_LABEL = 'Estimated travel cost'
export type Scope = { childId: string; childName: string; parentName: string; villageId: string }
export type ReasonCode = 'PENDING' | 'UNAUTHORIZED' | 'NO_VERIFIED_CONTACT_METHOD' | 'UNREACHABLE' | 'UNAVAILABLE' | 'AVAILABLE_NO_TRANSPORT' | 'OVER_POLICY' | 'RECOMMENDED' | 'APPROVAL_PENDING'
export type Candidate = { id: string; name: string; channel: string; reasonCode: ReasonCode; distanceMiles: number; estimatedRideCostUsd: number; costBasis: string }
export type RecordedEvent = { id: string; at: string; kind: string; summary: string; stage: string; job: { id: string; status: string; version: number } }
export type ChatMessage = { id: string; from: string; kind: string; text: string | null; at: string; relatedJobId: string | null; relatedInformationRequestId: string | null; hasVoiceNote: boolean }
export type MissionControlData = { candidates: Candidate[]; events: RecordedEvent[] }
export type ParentChatData = { messages: ChatMessage[] }
export type VillageNode = {
  person: { id: string; displayName: string }
  household: { id: string } | null
  role: string
}
export type VillageEdge = {
  from: { id: string }
  to: { id: string }
  relationship: { id: string; type: string; status: string }
}
// Client-assembled graph projection; not a server aggregate operation.
export type VillageData = { nodes: VillageNode[]; edges: VillageEdge[] }
export interface FrontendAdapter {
  readonly mode: 'mock' | 'graphql'
  readMissionControl(scope: Scope): Promise<MissionControlData>
  readParentChat(scope: Scope): Promise<ParentChatData>
  readVillage(scope: Scope): Promise<VillageData>
}
export function reasonLabel(reason: ReasonCode): string {
  const labels: Record<ReasonCode, string> = {
    PENDING: 'Waiting for reply', APPROVAL_PENDING: 'Awaiting parent approval',
    RECOMMENDED: 'Recommended', OVER_POLICY: 'Over your travel limit',
    UNAVAILABLE: 'Unavailable', UNAUTHORIZED: 'Not authorized',
    NO_VERIFIED_CONTACT_METHOD: 'No verified contact method', UNREACHABLE: 'Unreachable',
    AVAILABLE_NO_TRANSPORT: 'Available, no transport',
  }
  return labels[reason]
}
