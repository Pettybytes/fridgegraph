import { expect, it } from 'vitest'
import { contactChannelLabel, pickupStatusLabel, recordedSummary } from './displayCopy'
it('keeps recorded facts readable without exposing workflow codes', () => {
  expect(recordedSummary('Loretta Brooks — AVAILABLE_NO_TRANSPORT. Entry point: WEBHOOK_CALLBACK.')).toBe('Loretta Brooks — Available, no transport. A reply was recorded.')
  expect(pickupStatusLabel('awaiting_approval')).toBe('Waiting for parent approval')
  expect(pickupStatusLabel('future_internal_status')).toBe('Pickup status unavailable')
  expect(contactChannelLabel('SMS')).toBe('Text message')
})
