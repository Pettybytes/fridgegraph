import { reasonLabel } from './types'
import type { ReasonCode } from './types'
export function pickupStatusLabel(status: string): string {
  return ({ pending: 'Pickup requested', discovering: 'Checking with caregivers', awaiting_approval: 'Waiting for parent approval', confirmed: 'Parent approval recorded', failed: 'Pickup coordination ended' } as Record<string, string>)[status] ?? 'Pickup status unavailable'
}
export function recordedSummary(summary: string): string {
  let copy = summary
  for (const code of ['AVAILABLE_NO_TRANSPORT', 'APPROVAL_PENDING', 'NO_VERIFIED_CONTACT_METHOD', 'UNAUTHORIZED', 'UNREACHABLE', 'UNAVAILABLE', 'OVER_POLICY', 'RECOMMENDED', 'PENDING'] as ReasonCode[]) copy = copy.replaceAll(code, reasonLabel(code))
  return copy.replaceAll('(requestPickup)', '').replaceAll('requestPickup', 'pickup request').replaceAll('approvePickup', 'parent approval').replaceAll('decision: APPROVED', 'approved by the parent').replaceAll('Entry point: WEBHOOK_CALLBACK.', 'A reply was recorded.').replaceAll('No entry point — never accepted.', 'No reply was recorded.').replaceAll('RECOMMENDED', 'Recommended').replace(/\bconf_[a-z0-9_]+\.?/g, '').trim()
}
export function contactChannelLabel(channel: string): string {
  return ({ CALL: 'Phone call', SMS: 'Text message', EMAIL: 'Email', '—': '—' } as Record<string, string>)[channel] ?? 'Unknown'
}
