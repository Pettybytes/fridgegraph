import { reasonLabel } from './types'
import type { ReasonCode } from './types'
export function pickupStatusLabel(status: string): string {
  return ({ pending: 'Pickup requested', discovering: 'Checking with caregivers', awaiting_approval: 'Waiting for parent approval', confirmed: 'Pickup marked confirmed', failed: 'Pickup coordination ended' } as Record<string, string>)[status] ?? 'Pickup status unavailable'
}
const firstNameOf = (full: string) => full.trim().split(/\s+/)[0] || full.trim()

/**
 * Plain parent language for a recorded pickup event. Each line says exactly what the
 * record establishes — no more. The distinctions are deliberate (per the recording
 * review): a recorded decline, a timed-out attempt and a still-pending attempt are
 * NOT the same; "free time recorded" is not "available" or "willing"; "no vehicle on
 * record" is not "no car". Mapping anchors on the stable reason code plus whether a
 * reply was actually recorded, so it holds for live records, not just the fixtures.
 * Anything unrecognised falls through to a conservative generic cleanup.
 */
export function recordedSummary(summary: string): string {
  const dash = summary.indexOf(' — ')
  const name = dash > 0 ? summary.slice(0, dash).trim() : ''
  const first = name ? firstNameOf(name) : ''
  const body = dash > 0 ? summary.slice(dash + 3) : summary
  const replied = /Entry point: WEBHOOK_CALLBACK|A reply was recorded/i.test(body)

  if (name) {
    const declined = body.match(/declined:\s*([A-Za-z_]+)/i)
    if (declined) return `${first} declined (${declined[1].toLowerCase().replace(/_/g, ' ')})` // a recorded decline, with its reason
    if (/no reply within|never accepted/i.test(body)) return `${first}: no reply in time` // a recorded timeout
    if (/\bAPPROVAL_PENDING\b|Awaiting parent approval/i.test(body)) return replied ? `${first} can pick up, waiting for your OK` : `${first}: waiting for your OK` // acceptance only when a reply was recorded
    if (/\bAVAILABLE_NO_TRANSPORT\b|Available, no transport/i.test(body)) return `${first} has free time recorded, no vehicle on record`
    if (/NO_VERIFIED_CONTACT_METHOD/i.test(body)) return `${first}: no way to reach them on record`
    if (/\bUNREACHABLE\b/i.test(body)) return `${first}: couldn’t be reached`
    if (/\bUNAUTHORIZED\b/i.test(body)) return `${first}: not authorized for this`
    if (/\bPENDING\b|Waiting for reply/i.test(body)) return `${first}: no reply yet` // attempt still open
    if (/\bUNAVAILABLE\b/i.test(body)) return `${first}: can’t help this time`
  }

  const approved = summary.match(/Confirmed:\s*([A-Za-z]+)[^]*?approved\s+([A-Za-z]+)/i)
  if (approved) return `${approved[1]} approved ${approved[2]} for pickup`
  if (/candidates asked in parallel/i.test(summary)) {
    const n = (summary.match(/^(\d+)/) || [])[1]
    return n ? `Asked ${n} people to help with pickup` : 'Asked several people to help with pickup'
  }
  if (/Pickup job created/i.test(summary)) {
    const who = summary.match(/created for ([A-Za-z]+)/i)
    return who ? `Pickup requested for ${who[1]}` : 'Pickup requested'
  }
  if (/^SIMULATED/i.test(summary)) {
    const who = summary.match(/—\s*([A-Za-z]+)’?'?s proposed route/i)
    return who ? `Simulated route preview (${who[1]}), not a live location` : 'Simulated route preview, not a live location'
  }

  // Conservative fallback for anything not matched above.
  let copy = summary
  for (const code of ['AVAILABLE_NO_TRANSPORT', 'APPROVAL_PENDING', 'NO_VERIFIED_CONTACT_METHOD', 'UNAUTHORIZED', 'UNREACHABLE', 'UNAVAILABLE', 'OVER_POLICY', 'RECOMMENDED', 'PENDING'] as ReasonCode[]) copy = copy.replaceAll(code, reasonLabel(code))
  return copy.replaceAll('(CALL)', '(phone call)').replaceAll('(SMS)', '(text message)').replaceAll('(requestPickup)', '').replaceAll('requestPickup', 'pickup request').replaceAll('approvePickup', 'parent approval').replaceAll('decision: APPROVED', 'approved by the parent').replaceAll('Entry point: WEBHOOK_CALLBACK.', 'A reply was recorded.').replaceAll('No entry point — never accepted.', 'No reply was recorded.').replaceAll('RECOMMENDED', 'Recommended').replace(/\bconf_[a-z0-9_]+\.?/g, '').trim()
}
export function contactChannelLabel(channel: string): string {
  return ({ CALL: 'Phone call', SMS: 'Text message', EMAIL: 'Email', '—': '—' } as Record<string, string>)[channel] ?? 'Unknown'
}
