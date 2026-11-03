/**
 * Pickup outreach policy — pure decisions, no transport, no I/O.
 *
 * Implements docs/contracts/pickup-sms-dispatch.v1.md (v1.1) §1, §3, §4.
 * Everything here is deterministic and unit-tested; the atomic claim/reserve
 * itself belongs in SQL (0087 is storage only, the function is the next increment).
 */
import { createHmac } from 'node:crypto'

/** Operator-set caps, in SMS segments. Raising these is a contract change, not config. */
export const CAPS = { RUN: 50, RECIPIENT: 15, DAY: 150 } as const
export type CapKind = keyof typeof CAPS

/** Sending window in America/Detroit. Evaluated at handoff, inclusive start, exclusive end. */
export const SEND_WINDOW = { startHour: 8, endHour: 20 } as const

export type Refusal = 'LIMIT_RUN' | 'LIMIT_RECIPIENT' | 'LIMIT_DAY' | 'SUPPRESSED' | 'WINDOW' | 'KILL_SWITCH'

const DETROIT = 'America/Detroit'

/** Normalize to E.164. Returns null when the input cannot be a phone number. */
export function normalizeE164(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, '')
  const withPlus = digits.startsWith('+') ? digits : `+${digits}`
  // E.164: '+' then 8..15 digits, first digit 1-9.
  if (!/^\+[1-9]\d{7,14}$/.test(withPlus)) return null
  return withPlus
}

/**
 * Suppression lookup key: HMAC-SHA256 of the E.164 number under a server-side key.
 * The raw number is never stored in the suppression table.
 */
export function suppressionKey(e164: string, serverKey: string): string {
  if (!serverKey) throw new Error('SUPPRESSION_KEY_REQUIRED')
  return createHmac('sha256', serverKey).update(e164).digest('hex')
}

/** America/Detroit calendar date (YYYY-MM-DD) for an instant — the DAY cap window. */
export function detroitDate(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {timeZone: DETROIT, year: 'numeric', month: '2-digit', day: '2-digit'}).format(at)
}

/** Hour (0-23) in America/Detroit. */
export function detroitHour(at: Date): number {
  return Number(new Intl.DateTimeFormat('en-US', {timeZone: DETROIT, hour: '2-digit', hourCycle: 'h23'}).format(at))
}

export function isWithinSendWindow(at: Date): boolean {
  const hour = detroitHour(at)
  return hour >= SEND_WINDOW.startHour && hour < SEND_WINDOW.endHour
}

/**
 * Segment count. GSM-7 messages fit 160 chars per segment; anything outside the
 * GSM-7 set falls to UCS-2 at 70 chars per segment. Deliberately conservative:
 * over-counting costs allowance, under-counting oversends.
 */
export function segmentsFor(text: string): number {
  // eslint-disable-next-line no-control-regex
  const gsm7 = /^[\x00-\x7F]*$/.test(text) && !/[{}[\]~|^\\]/.test(text)
  const per = gsm7 ? 160 : 70
  return Math.max(1, Math.ceil(text.length / per))
}

export type SendInput = {
  at: Date
  segments: number
  used: {RUN: number; RECIPIENT: number; DAY: number}
  suppressed: boolean
  killSwitchOn: boolean
}

/**
 * The single decision point before handoff. Returns the first refusal, or null when
 * the send may proceed. Order matters: kill switch, suppression, window, then caps.
 * Reserved allowance is assumed already counted in `used`.
 */
export function refusalFor(input: SendInput): Refusal | null {
  if (input.killSwitchOn) return 'KILL_SWITCH'
  if (input.suppressed) return 'SUPPRESSED'
  if (!isWithinSendWindow(input.at)) return 'WINDOW'
  if (input.used.RUN + input.segments > CAPS.RUN) return 'LIMIT_RUN'
  if (input.used.RECIPIENT + input.segments > CAPS.RECIPIENT) return 'LIMIT_RECIPIENT'
  if (input.used.DAY + input.segments > CAPS.DAY) return 'LIMIT_DAY'
  return null
}

export type DispatchState = 'PENDING' | 'CLAIMED' | 'ACCEPTED' | 'UNKNOWN' | 'FAILED_FINAL' | 'SUPPRESSED' | 'RESPONDED'

/**
 * Whether a dispatch may be (re)sent. Only PENDING and an expired CLAIM may proceed.
 * UNKNOWN is never resent — that is the duplicate-send defect this guards.
 * Allowance is never a reason to send: this function never looks at remaining allowance.
 *
 * `hasProviderMessageId` exists because an expired CLAIM is only safe to retry when the
 * handoff never happened. A claim that already has a provider message id means the message
 * may have gone out: it must be reconciled, never resent — exactly like UNKNOWN.
 */
export function maySend(
  state: DispatchState,
  claimExpiresAt: Date | null,
  now: Date,
  hasProviderMessageId = false,
): boolean {
  if (hasProviderMessageId) return false
  if (state === 'PENDING') return true
  if (state === 'CLAIMED' && claimExpiresAt !== null && claimExpiresAt.getTime() <= now.getTime()) return true
  return false
}

/** States that require reconciliation (read the provider) rather than a resend. */
export function mustReconcile(state: DispatchState): boolean {
  return state === 'UNKNOWN'
}

/** Reservations are retained for these terminal outcomes — the message may have been sent. */
export function retainsReservation(state: DispatchState): boolean {
  return state === 'ACCEPTED' || state === 'UNKNOWN' || state === 'RESPONDED'
}
