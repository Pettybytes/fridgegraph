import { expect, it } from 'vitest'
import { contactChannelLabel, pickupStatusLabel, recordedSummary } from './displayCopy'
it('says exactly what each record establishes, in plain parent language', () => {
  // Recorded free time is not "available"/"willing"; "no vehicle on record" not "no car".
  expect(recordedSummary('Loretta Brooks — AVAILABLE_NO_TRANSPORT. Entry point: WEBHOOK_CALLBACK. No paid ride explored: a driver is available.')).toBe('Loretta has free time recorded — no vehicle on record')
  // Acceptance + pending approval only when a reply was actually recorded.
  expect(recordedSummary('Tasha Ellison — APPROVAL_PENDING. Entry point: WEBHOOK_CALLBACK. Parent approval required; no travel cost attached to a driver.')).toBe('Tasha can pick up — waiting for your OK')
  // A recorded decline, with its reason.
  expect(recordedSummary('Bryan Brooks — UNAVAILABLE (declined: BUSY). Entry point: WEBHOOK_CALLBACK.')).toBe('Bryan declined (busy)')
  // A timed-out attempt is not a decline and not still-pending.
  expect(recordedSummary('Monique Davis — UNAVAILABLE (no reply within 60s). No entry point — never accepted.')).toBe('Monique — no reply in time')
  // A still-open attempt with no reply yet.
  expect(recordedSummary('Priya Nair — PENDING. No entry point.')).toBe('Priya — no reply yet')
  expect(pickupStatusLabel('awaiting_approval')).toBe('Waiting for parent approval')
  // A status cannot substitute for the separately recorded Confirmation evidence.
  expect(pickupStatusLabel('confirmed')).toBe('Pickup marked confirmed')
  expect(pickupStatusLabel('future_internal_status')).toBe('Pickup status unavailable')
  expect(contactChannelLabel('SMS')).toBe('Text message')
})
