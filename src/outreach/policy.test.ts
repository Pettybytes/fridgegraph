import {test} from 'node:test'
import assert from 'node:assert/strict'
import {
  CAPS, SEND_WINDOW, normalizeE164, suppressionKey, detroitDate, detroitHour, isWithinSendWindow,
  segmentsFor, refusalFor, maySend, mustReconcile, retainsReservation,
} from './policy'

const at = (iso: string) => new Date(iso)
const used = (run: number, recipient: number, day: number) => ({RUN: run, RECIPIENT: recipient, DAY: day})
const clear = (iso = '2026-11-03T15:00:00-05:00') => ({
  at: at(iso), segments: 1, used: used(0, 0, 0), suppressed: false, killSwitchOn: false,
})

test('caps are the operator-set segment limits', () => {
  assert.equal(CAPS.RUN, 50)
  assert.equal(CAPS.RECIPIENT, 15)
  assert.equal(CAPS.DAY, 150)
})

test('send window is 08:00 inclusive to 20:00 exclusive in Detroit', () => {
  assert.equal(SEND_WINDOW.startHour, 8)
  assert.equal(SEND_WINDOW.endHour, 20)
  assert.equal(isWithinSendWindow(at('2026-11-03T08:00:00-05:00')), true)
  assert.equal(isWithinSendWindow(at('2026-11-03T07:59:00-05:00')), false)
  assert.equal(isWithinSendWindow(at('2026-11-03T19:59:00-05:00')), true)
  assert.equal(isWithinSendWindow(at('2026-11-03T20:00:00-05:00')), false)
})

test('Detroit date/hour do not follow the host timezone', () => {
  // 03:30Z on Nov 4 is still Nov 3, 22:30 in Detroit (EST).
  assert.equal(detroitDate(at('2026-11-04T03:30:00Z')), '2026-11-03')
  assert.equal(detroitHour(at('2026-11-04T03:30:00Z')), 22)
})

test('E.164 normalization accepts real shapes and rejects junk', () => {
  assert.equal(normalizeE164('(313) 555-0103'), '+3135550103')
  assert.equal(normalizeE164('+1 313 555 0103'), '+13135550103')
  assert.equal(normalizeE164('3135550103'), '+3135550103')
  assert.equal(normalizeE164('12'), null)
  assert.equal(normalizeE164('abc'), null)
  assert.equal(normalizeE164('+0123456789'), null)
})

test('suppression key is keyed HMAC, not the number', () => {
  const k1 = suppressionKey('+13135550103', 'key-a')
  assert.equal(k1, suppressionKey('+13135550103', 'key-a'))
  assert.notEqual(k1, suppressionKey('+13135550103', 'key-b'))
  assert.equal(k1.includes('13135550103'), false)
  assert.match(k1, /^[a-f0-9]{64}$/)
  assert.throws(() => suppressionKey('+13135550103', ''), /SUPPRESSION_KEY_REQUIRED/)
})

test('segments: GSM-7 160/part, UCS-2 70/part, never zero', () => {
  assert.equal(segmentsFor(''), 1)
  assert.equal(segmentsFor('a'.repeat(160)), 1)
  assert.equal(segmentsFor('a'.repeat(161)), 2)
  assert.equal(segmentsFor('é'.repeat(70)), 1)
  assert.equal(segmentsFor('é'.repeat(71)), 2)
  // Draft copy is deliberately under one segment each.
  assert.equal(segmentsFor('FridgeGraph demo: can you pick up Nora today at 3:00 PM? Reply YES or NO.'), 1)
})

test('refusal order: kill switch, suppression, window, then caps', () => {
  assert.equal(refusalFor({...clear(), killSwitchOn: true, suppressed: true, used: used(999, 999, 999)}), 'KILL_SWITCH')
  assert.equal(refusalFor({...clear(), suppressed: true, used: used(999, 999, 999)}), 'SUPPRESSED')
  assert.equal(refusalFor({...clear('2026-11-03T21:00:00-05:00'), used: used(999, 999, 999)}), 'WINDOW')
})

test('each cap refuses at exactly limit + 1 and allows at the limit', () => {
  assert.equal(refusalFor({...clear(), used: used(49, 0, 0), segments: 1}), null)
  assert.equal(refusalFor({...clear(), used: used(50, 0, 0), segments: 1}), 'LIMIT_RUN')
  assert.equal(refusalFor({...clear(), used: used(0, 14, 0), segments: 1}), null)
  assert.equal(refusalFor({...clear(), used: used(0, 15, 0), segments: 1}), 'LIMIT_RECIPIENT')
  assert.equal(refusalFor({...clear(), used: used(0, 0, 149), segments: 1}), null)
  assert.equal(refusalFor({...clear(), used: used(0, 0, 150), segments: 1}), 'LIMIT_DAY')
})

test('a multipart message consumes its segment count', () => {
  assert.equal(refusalFor({...clear(), used: used(0, 14, 0), segments: 2}), 'LIMIT_RECIPIENT')
})

test('maySend: only pre-handoff claims retry; UNKNOWN and handed-off claims never resend', () => {
  const now = at('2026-11-03T15:00:00-05:00')
  assert.equal(maySend('PENDING', null, now), true)
  assert.equal(maySend('CLAIMED', at('2026-11-03T15:05:00-05:00'), now), false)      // live claim
  assert.equal(maySend('CLAIMED', at('2026-11-03T14:59:00-05:00'), now), true)       // expired, no handoff
  assert.equal(maySend('CLAIMED', at('2026-11-03T14:59:00-05:00'), now, true), false) // expired but handed off
  assert.equal(maySend('UNKNOWN', null, now), false)
  assert.equal(maySend('ACCEPTED', null, now), false)
  assert.equal(maySend('FAILED_FINAL', null, now), false)
  assert.equal(maySend('SUPPRESSED', null, now), false)
  assert.equal(maySend('RESPONDED', null, now), false)
})

test('UNKNOWN requires reconciliation, not a retry', () => {
  assert.equal(mustReconcile('UNKNOWN'), true)
  for (const state of ['PENDING', 'CLAIMED', 'ACCEPTED', 'FAILED_FINAL', 'RESPONDED'] as const) {
    assert.equal(mustReconcile(state), false)
  }
})

test('reservation is retained wherever the message may have gone out', () => {
  assert.equal(retainsReservation('ACCEPTED'), true)
  assert.equal(retainsReservation('UNKNOWN'), true)
  assert.equal(retainsReservation('RESPONDED'), true)
  assert.equal(retainsReservation('FAILED_FINAL'), false)
  assert.equal(retainsReservation('SUPPRESSED'), false)
  assert.equal(retainsReservation('PENDING'), false)
})
