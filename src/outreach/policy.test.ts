import {test} from 'node:test'
import assert from 'node:assert/strict'
import {
  CAPS, SEND_WINDOW, RUN_COST_CAP_MICROS, SEGMENT_PRICE_MICROS,
  normalizePhone, tryNormalizePhone, suppressionKey, suppressionKeyFor,
  detroitDate, detroitHour, isWithinSendWindow,
  analyzeSegments, segmentsFor, SEGMENT_LIMITS,
  refusalFor, runCostMicros,
  maySend, mustReconcile, retainsReservation, reservationIsReusedOnReclaim,
  outboundKindAllowed,
} from './policy'

const at = (iso: string) => new Date(iso)
const used = (run: number, recipient: number, day: number) => ({ RUN: run, RECIPIENT: recipient, DAY: day })
const clear = (iso = '2026-11-03T15:00:00-05:00') => ({
  at: at(iso), segments: 1, used: used(0, 0, 0), runCostMicros: 0, suppressed: false, killSwitchOn: false,
})

// ────────────────────────────────────────────────────────────────── caps ──

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

test('Detroit date/hour survive a UTC instant', () => {
  // 2026-11-04T03:00Z is 22:00 on Nov 3 in Detroit (EDT, -04:00 during DST).
  assert.equal(detroitDate(at('2026-11-04T03:00:00Z')), '2026-11-03')
  assert.equal(detroitHour(at('2026-11-04T03:00:00Z')), 22)
})

// ──────────────────────────────────────────────────────── phone identity ──

test('explicit E.164 is accepted with or without separators', () => {
  assert.equal(normalizePhone('+14155550123'), '+14155550123')
  assert.equal(normalizePhone('+1 (415) 555-0123'), '+14155550123')
  assert.equal(normalizePhone('  +1 415 555 0123  '), '+14155550123')
  assert.equal(normalizePhone('+442079460958'), '+442079460958')
})

test('US local numbers need the region stated explicitly', () => {
  assert.equal(normalizePhone('(415) 555-0123', { region: 'US' }), '+14155550123')
  assert.equal(normalizePhone('415-555-0123', { region: 'US' }), '+14155550123')
  assert.equal(normalizePhone('14155550123', { region: 'US' }), '+14155550123')
})

test('a national number with no region is refused, never guessed', () => {
  const r = tryNormalizePhone('(415) 555-0123')
  assert.deepEqual(r, { ok: false, code: 'REGION_REQUIRED' })
})

test('ambiguous and malformed input is refused', () => {
  assert.deepEqual(tryNormalizePhone('0044 20 7946 0958', { region: 'US' }), { ok: false, code: 'AMBIGUOUS' })
  assert.deepEqual(tryNormalizePhone('415-555-0123 x12', { region: 'US' }), { ok: false, code: 'INVALID' })
  assert.deepEqual(tryNormalizePhone('415-555-012', { region: 'US' }), { ok: false, code: 'INVALID' })
  assert.deepEqual(tryNormalizePhone('+0123456789'), { ok: false, code: 'INVALID' })
  assert.deepEqual(tryNormalizePhone('+1415'), { ok: false, code: 'INVALID' })
  assert.deepEqual(tryNormalizePhone(''), { ok: false, code: 'INVALID' })
  assert.deepEqual(tryNormalizePhone('415+5550123', { region: 'US' }), { ok: false, code: 'INVALID' })
})

test('equivalent allowed formats produce the SAME suppression HMAC', () => {
  const key = 'test-key'
  const a = suppressionKeyFor('+1 (415) 555-0123', key)
  const b = suppressionKeyFor('415-555-0123', key, { region: 'US' })
  const c = suppressionKeyFor('14155550123', key, { region: 'US' })
  const d = suppressionKeyFor('+14155550123', key)
  assert.equal(a, b)
  assert.equal(b, c)
  assert.equal(c, d)
  // A different number must not collide, and the key must be a hex digest.
  assert.notEqual(a, suppressionKeyFor('+14155550124', key))
  assert.match(a, /^[0-9a-f]{64}$/)
})

test('suppressionKey refuses a non-canonical number', () => {
  assert.throws(() => suppressionKey('(415) 555-0123', 'k'), /canonical E\.164/)
  assert.throws(() => suppressionKey('+14155550123', ''), /SUPPRESSION_KEY_REQUIRED/)
})

// ────────────────────────────────────────────────────── segment counting ──

test('GSM-7 single/multipart boundaries at 160 and 161', () => {
  assert.equal(analyzeSegments('a'.repeat(160)).segments, 1)
  const over = analyzeSegments('a'.repeat(161))
  assert.equal(over.segments, 2)
  assert.equal(over.encoding, 'GSM7')
  assert.equal(over.multipart, true)
  assert.equal(over.perSegment, SEGMENT_LIMITS.GSM7.multipart)
})

test('GSM-7 multipart boundaries at 306 and 307', () => {
  assert.equal(segmentsFor('a'.repeat(306)), 2) // exactly 2 × 153
  assert.equal(segmentsFor('a'.repeat(307)), 3)
})

test('Unicode boundaries at 70 and 71', () => {
  const emDash = '—' // not in the GSM-7 set
  const s = analyzeSegments(emDash.repeat(70))
  assert.equal(s.encoding, 'UCS2')
  assert.equal(s.segments, 1)
  assert.equal(analyzeSegments(emDash.repeat(71)).segments, 2)
})

test('Unicode multipart boundaries at 134 and 135', () => {
  const emDash = '—'
  assert.equal(segmentsFor(emDash.repeat(134)), 2) // exactly 2 × 67
  assert.equal(segmentsFor(emDash.repeat(135)), 3)
})

test('GSM-7 extension characters cost two septets', () => {
  const euro = analyzeSegments('€')
  assert.equal(euro.encoding, 'GSM7')
  assert.equal(euro.units, 2)
  // 80 × € = 160 septets → one segment; 81 × € = 162 → two.
  assert.equal(segmentsFor('€'.repeat(80)), 1)
  assert.equal(segmentsFor('€'.repeat(81)), 2)
  // Braces are extension characters too, so 81 of them cross the boundary.
  assert.equal(segmentsFor('{'.repeat(80)), 1)
  assert.equal(segmentsFor('{'.repeat(81)), 2)
})

test('a single emoji is two UCS-2 units and does NOT fit the GSM-7 budget', () => {
  const one = analyzeSegments('😀')
  assert.equal(one.encoding, 'UCS2')
  assert.equal(one.units, 2)
  assert.equal(one.segments, 1)
  // 35 emoji = 70 units → one segment; 36 = 72 → two.
  assert.equal(segmentsFor('😀'.repeat(35)), 1)
  assert.equal(segmentsFor('😀'.repeat(36)), 2)
})

test('a typographic quote forces UCS-2 even in otherwise-ASCII text', () => {
  const s = analyzeSegments('Hi — there')
  assert.equal(s.encoding, 'UCS2')
})

test('an empty or whitespace-only body is refused', () => {
  assert.throws(() => analyzeSegments(''), /EMPTY_BODY/)
  assert.throws(() => analyzeSegments('   \n\t '), /EMPTY_BODY/)
  assert.equal(refusalFor({ ...clear(), body: '' }), 'EMPTY_BODY')
  assert.equal(refusalFor({ ...clear(), body: '  ' }), 'EMPTY_BODY')
})

// ─────────────────────────────────────────────────────────────── decisions ──

test('first refusal wins in contract order', () => {
  assert.equal(refusalFor({ ...clear(), killSwitchOn: true, suppressed: true }), 'KILL_SWITCH')
  assert.equal(refusalFor({ ...clear(), suppressed: true }), 'SUPPRESSED')
  assert.equal(refusalFor({ ...clear('2026-11-03T22:00:00-05:00') }), 'WINDOW')
  assert.equal(refusalFor(clear()), null)
})

test('counters are BEFORE the candidate, and the policy adds its own segments', () => {
  // 49 used + 1 = 50 → allowed; 50 used + 1 = 51 → refused.
  assert.equal(refusalFor({ ...clear(), segments: 1, used: used(49, 0, 0) }), null)
  assert.equal(refusalFor({ ...clear(), segments: 1, used: used(50, 0, 0) }), 'LIMIT_RUN')
  // The candidate's own size counts: 48 + 3 > 50.
  assert.equal(refusalFor({ ...clear(), segments: 3, used: used(48, 0, 0) }), 'LIMIT_RUN')
  assert.equal(refusalFor({ ...clear(), segments: 1, used: used(0, 15, 0) }), 'LIMIT_RECIPIENT')
  assert.equal(refusalFor({ ...clear(), segments: 1, used: used(0, 0, 150) }), 'LIMIT_DAY')
})

test('the $1 run backstop is enforced in the same decision', () => {
  assert.equal(RUN_COST_CAP_MICROS, 1_000_000)
  assert.equal(runCostMicros(1), SEGMENT_PRICE_MICROS)
  // 126 segments would be $0.9954 (within), but the segment caps bind first in practice.
  assert.equal(refusalFor({ ...clear(), segments: 1, runCostMicros: 999_000 }), 'LIMIT_COST_RUN')
  assert.equal(refusalFor({ ...clear(), segments: 1, runCostMicros: 990_000 }), null)
})

test('follow-up kinds are deferred, not silently allowed', () => {
  assert.equal(outboundKindAllowed('REQUEST'), true)
  assert.equal(outboundKindAllowed('IDENTITY_PROMPT'), false)
  assert.equal(outboundKindAllowed('NUDGE'), false)
  assert.equal(refusalFor({ ...clear(), kind: 'NUDGE' }), 'DEFERRED_KIND')
  assert.equal(refusalFor({ ...clear(), kind: 'REQUEST' }), null)
})

// ───────────────────────────────────────────────────────────── crash safety ──

const view = (over: Partial<Parameters<typeof maySend>[0]> = {}) => ({
  state: 'PENDING' as const,
  claimExpiresAt: null,
  claimToken: null,
  handoffStartedAt: null,
  providerMessageId: null,
  ...over,
})

test('a persisted handoff marker blocks sending even with NO provider id', () => {
  const v = view({ state: 'CLAIMED', claimExpiresAt: at('2026-11-03T14:00:00Z'), claimToken: 'w1', handoffStartedAt: at('2026-11-03T13:59:00Z') })
  assert.deepEqual(maySend(v, at('2026-11-03T15:00:00Z'), 'w1'), { send: false, reason: 'HANDOFF_STARTED' })
  // Restart with a brand-new worker token changes nothing.
  assert.deepEqual(maySend(v, at('2026-11-03T15:00:00Z'), 'w2'), { send: false, reason: 'HANDOFF_STARTED' })
})

test('a provider message id blocks sending', () => {
  assert.deepEqual(maySend(view({ state: 'ACCEPTED', providerMessageId: 'SM123' }), at('2026-11-03T15:00:00Z'), 'w1'), {
    send: false, reason: 'PROVIDER_ID',
  })
})

test('PENDING may send; a live claim may not be stolen', () => {
  assert.deepEqual(maySend(view(), at('2026-11-03T15:00:00Z'), 'w1'), { send: true })
  const live = view({ state: 'CLAIMED', claimExpiresAt: at('2026-11-03T15:05:00Z'), claimToken: 'w2' })
  assert.deepEqual(maySend(live, at('2026-11-03T15:00:00Z'), 'w1'), { send: false, reason: 'CLAIM_ACTIVE' })
})

test('an expired PRE-HANDOFF claim is reclaimable only by its own fencing token', () => {
  const expired = view({ state: 'CLAIMED', claimExpiresAt: at('2026-11-03T14:00:00Z'), claimToken: 'w1' })
  assert.deepEqual(maySend(expired, at('2026-11-03T15:00:00Z'), 'w1'), { send: true })
  // Another worker took ownership and rotated the token: the old worker must not send.
  assert.deepEqual(maySend(expired, at('2026-11-03T15:00:00Z'), 'w2'), { send: false, reason: 'CLAIMED_BY_OTHER' })
})

test('terminal states never send', () => {
  for (const state of ['UNKNOWN', 'FAILED_FINAL', 'SUPPRESSED', 'RESPONDED', 'HANDOFF_STARTED'] as const) {
    assert.equal(maySend(view({ state }), at('2026-11-03T15:00:00Z'), 'w1').send, false)
  }
})

test('reservations are retained exactly when the message may have been sent', () => {
  assert.equal(retainsReservation('HANDOFF_STARTED'), true)
  assert.equal(retainsReservation('ACCEPTED'), true)
  assert.equal(retainsReservation('UNKNOWN'), true)
  assert.equal(retainsReservation('RESPONDED'), true)
  assert.equal(retainsReservation('PENDING'), false)
  assert.equal(retainsReservation('FAILED_FINAL'), false)
  assert.equal(retainsReservation('SUPPRESSED'), false)
})

test('reconciliation is required for uncertain states, not for clean ones', () => {
  assert.equal(mustReconcile('UNKNOWN'), true)
  assert.equal(mustReconcile('HANDOFF_STARTED'), true)
  assert.equal(mustReconcile('ACCEPTED'), false)
})

test('reclaiming a pre-handoff claim reuses its reservation; post-handoff does not', () => {
  assert.equal(reservationIsReusedOnReclaim(null), true)
  assert.equal(reservationIsReusedOnReclaim(at('2026-11-03T13:00:00Z')), false)
})
