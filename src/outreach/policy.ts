/**
 * Pickup outreach policy — pure decisions, no transport, no I/O.
 *
 * Implements docs/contracts/pickup-sms-dispatch.v1.md (v1.1) §1, §3, §4, §6, §7, §8.
 * The atomic claim/reserve itself lives in SQL (0087). This module is the *advisory*
 * pre-check that must agree with the database; the database is authoritative and a
 * disagreement between the two is a defect, never a licence to send.
 *
 * Four invariants this file exists to make impossible to get wrong:
 *
 *  1. A handoff that started is never sendable again — not on lease expiry, not on
 *     restart, not when the provider id was never persisted. `hasProviderMessageId=false`
 *     is NOT evidence that no handoff occurred; only the persisted handoff marker is.
 *  2. Every phone number reaches one canonical E.164 through one function, so the roster,
 *     inbound replies and the suppression lookup can never disagree about who someone is.
 *  3. Segment counts are real GSM-7/UCS-2 counts with multipart overhead, not a character
 *     count divided by 160.
 *  4. Follow-up message kinds do not exist yet. The identity carries the kind so a later
 *     increment cannot reuse a REQUEST reservation for a nudge.
 */
import { createHmac } from 'node:crypto'

/** Operator-set caps, in SMS segments. Raising these is a contract change, not config. */
export const CAPS = { RUN: 50, RECIPIENT: 15, DAY: 150 } as const
export type CapKind = keyof typeof CAPS

/** Per-segment price used only by the run-level dollar backstop (operator constant). */
export const SEGMENT_PRICE_MICROS = 7_900 // $0.0079
/** Hard run backstop: no run may reserve more than $1.00 of segments. */
export const RUN_COST_CAP_MICROS = 1_000_000

/** Sending window in America/Detroit. Evaluated at handoff, inclusive start, exclusive end. */
export const SEND_WINDOW = { startHour: 8, endHour: 20 } as const

export type Refusal =
  | 'LIMIT_RUN'
  | 'LIMIT_RECIPIENT'
  | 'LIMIT_DAY'
  | 'LIMIT_COST_RUN'
  | 'SUPPRESSED'
  | 'WINDOW'
  | 'KILL_SWITCH'
  | 'EMPTY_BODY'
  | 'DEFERRED_KIND'

const DETROIT = 'America/Detroit'

// ─────────────────────────────────────────────────────────── phone identity ──

export type PhoneRegion = 'US'
export type PhoneRefusal = 'INVALID' | 'AMBIGUOUS' | 'REGION_REQUIRED'

export class PhoneIdentityError extends Error {
  readonly code: PhoneRefusal
  constructor(code: PhoneRefusal, message: string) {
    super(message)
    this.name = 'PhoneIdentityError'
    this.code = code
  }
}

const E164 = /^\+[1-9]\d{7,14}$/

/**
 * THE canonical phone path. Roster rows, inbound messages and suppression all call this.
 *
 * Accepted:
 *   - explicit international E.164: `+14155550123`, with separators allowed and stripped;
 *   - US local, ONLY when the caller states the region: `(415) 555-0123`, `415-555-0123`,
 *     `1 415 555 0123`, `+1 415 555 0123`.
 *
 * Refused (never guessed):
 *   - `00...` international prefix (ambiguous with a local leading zero);
 *   - letters/extensions (`415-555-0123 x12`), which a naive digit-strip turns into a
 *     different number;
 *   - 7, 9 or 12+ national digits without a region;
 *   - anything that does not fit E.164 after normalisation.
 */
export function normalizePhone(raw: string, opts: { region?: PhoneRegion } = {}): string {
  if (typeof raw !== 'string') throw new PhoneIdentityError('INVALID', 'phone must be a string')
  const value = raw.trim()
  if (!value) throw new PhoneIdentityError('INVALID', 'phone is empty')
  // Extensions and words are refused rather than silently folded into the digits.
  if (/[A-Za-z]/.test(value)) throw new PhoneIdentityError('INVALID', 'letters or an extension are not allowed')
  if (/[^\d+\-().\s\u00a0]/.test(value)) throw new PhoneIdentityError('INVALID', 'unsupported character in phone')

  const compact = value.replace(/[\s\u00a0().-]/g, '')
  if (!compact) throw new PhoneIdentityError('INVALID', 'phone is empty')
  if ((compact.match(/\+/g) ?? []).length > 1) throw new PhoneIdentityError('INVALID', 'more than one plus sign')
  if (compact.includes('+') && !compact.startsWith('+')) throw new PhoneIdentityError('INVALID', 'plus sign must lead')

  if (compact.startsWith('+')) {
    if (E164.test(compact)) return compact
    throw new PhoneIdentityError('INVALID', 'not a valid E.164 number')
  }

  if (compact.startsWith('00')) {
    throw new PhoneIdentityError('AMBIGUOUS', 'a leading 00 is ambiguous; send E.164 with a + country code')
  }

  const digits = compact
  if (!/^\d+$/.test(digits)) throw new PhoneIdentityError('INVALID', 'phone must be digits after normalisation')

  if (opts.region === 'US') {
    if (digits.length === 10) {
      const candidate = `+1${digits}`
      if (E164.test(candidate)) return candidate
    }
    if (digits.length === 11 && digits.startsWith('1')) {
      const candidate = `+${digits}`
      if (E164.test(candidate)) return candidate
    }
    throw new PhoneIdentityError('INVALID', 'not a valid US number; send E.164 with a + country code')
  }

  // No region stated and no international prefix: the number is ambiguous, and guessing is
  // exactly how two "different" people become one suppression key.
  throw new PhoneIdentityError('REGION_REQUIRED', 'state the region or send E.164 with a + country code')
}

export type PhoneResult = { ok: true; e164: string } | { ok: false; code: PhoneRefusal }

/** Non-throwing form for boundary code paths that must record rather than crash. */
export function tryNormalizePhone(raw: string, opts: { region?: PhoneRegion } = {}): PhoneResult {
  try {
    return { ok: true, e164: normalizePhone(raw, opts) }
  } catch (error) {
    if (error instanceof PhoneIdentityError) return { ok: false, code: error.code }
    throw error
  }
}

/**
 * Suppression lookup key: HMAC-SHA256 of the canonical E.164 under a server-side key.
 * The raw number is never stored. Equivalent allowed formats produce the same key because
 * this function refuses anything that is not already canonical.
 */
export function suppressionKey(e164: string, serverKey: string): string {
  if (!serverKey) throw new Error('SUPPRESSION_KEY_REQUIRED')
  if (!E164.test(e164)) throw new PhoneIdentityError('INVALID', 'suppressionKey requires canonical E.164')
  return createHmac('sha256', serverKey).update(e164).digest('hex')
}

/** Convenience: normalise then key. One call site, one canonicalisation. */
export function suppressionKeyFor(raw: string, serverKey: string, opts: { region?: PhoneRegion } = {}): string {
  return suppressionKey(normalizePhone(raw, opts), serverKey)
}

// ───────────────────────────────────────────────────────────── send window ──

/** America/Detroit calendar date (YYYY-MM-DD) for an instant — the DAY cap window. */
export function detroitDate(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: DETROIT, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
}

/** Hour (0-23) in America/Detroit. */
export function detroitHour(at: Date): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: DETROIT, hour: '2-digit', hourCycle: 'h23' }).format(at))
}

export function isWithinSendWindow(at: Date): boolean {
  const hour = detroitHour(at)
  return hour >= SEND_WINDOW.startHour && hour < SEND_WINDOW.endHour
}

// ────────────────────────────────────────────────────── segment counting ──

/**
 * GSM 03.38 basic character set. A character outside this set forces the whole message to
 * UCS-2 — including a single "typographic" quote. The escape character itself is not a
 * character; it only introduces the extension set below.
 */
const GSM7_BASIC = new Set(
  (
    '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ' +
    'ÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
    '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿' +
    'abcdefghijklmnopqrstuvwxyzäöñüà'
  ).split(''),
)

/** GSM 03.38 extension set: two septets each (a leading escape plus the character). */
const GSM7_EXTENSION = new Set(['^', '{', '}', '\\', '[', ']', '~', '|', '€', '\f'])

export const SEGMENT_LIMITS = {
  GSM7: { single: 160, multipart: 153 },
  UCS2: { single: 70, multipart: 67 },
} as const

export type SegmentInfo = {
  encoding: 'GSM7' | 'UCS2'
  /** Encoded units: septets for GSM-7, UTF-16 code units for UCS-2. */
  units: number
  segments: number
  multipart: boolean
  perSegment: number
}

/**
 * Real segment counting.
 *
 * GSM-7: a basic char costs 1 septet, an extension char costs 2. A message fits one segment
 * at ≤160 septets; above that each concatenated segment carries a 6-byte UDH, leaving 153.
 * UCS-2: BMP char = 1 unit, emoji/astral = 2 (surrogate pair); 70 per single segment, 67 for
 * each part of a concatenated message.
 *
 * Empty or whitespace-only bodies are refused: an empty outbound body is always a bug, and
 * counting it as one segment would let it consume allowance while sending nothing.
 */
export function analyzeSegments(text: string): SegmentInfo {
  if (typeof text !== 'string') throw new Error('EMPTY_BODY')
  if (!text.trim()) throw new Error('EMPTY_BODY')

  let gsmUnits = 0
  let isGsm7 = true
  for (const char of text) {
    if (GSM7_EXTENSION.has(char)) {
      gsmUnits += 2
      continue
    }
    if (GSM7_BASIC.has(char)) {
      gsmUnits += 1
      continue
    }
    isGsm7 = false
    break
  }

  if (isGsm7) {
    const multipart = gsmUnits > SEGMENT_LIMITS.GSM7.single
    const perSegment = multipart ? SEGMENT_LIMITS.GSM7.multipart : SEGMENT_LIMITS.GSM7.single
    return {
      encoding: 'GSM7',
      units: gsmUnits,
      segments: multipart ? Math.ceil(gsmUnits / perSegment) : 1,
      multipart,
      perSegment,
    }
  }

  // UTF-16 code units is exactly what UCS-2 counts per 3GPP for SMS length purposes, and it
  // charges 2 for an astral character (emoji), which is what the network actually bills.
  const units = text.length
  const multipart = units > SEGMENT_LIMITS.UCS2.single
  const perSegment = multipart ? SEGMENT_LIMITS.UCS2.multipart : SEGMENT_LIMITS.UCS2.single
  return {
    encoding: 'UCS2',
    units,
    segments: multipart ? Math.ceil(units / perSegment) : 1,
    multipart,
    perSegment,
  }
}

/** Convenience wrapper. Throws `EMPTY_BODY` for an empty/whitespace-only body. */
export function segmentsFor(text: string): number {
  return analyzeSegments(text).segments
}

// ──────────────────────────────────────────────────────── message identity ──

/**
 * One permitted outbound message = one durable identity = one reservation.
 *
 * Only `REQUEST` exists in this increment. `IDENTITY_PROMPT` and `NUDGE` are declared so the
 * identity column is durable from the start, and are refused here on purpose: shipping them
 * without their own identity and reservation would let a follow-up reuse a request's
 * allowance. Follow-ups are DEFERRED for the first proof.
 */
export const MESSAGE_KINDS = ['REQUEST', 'IDENTITY_PROMPT', 'NUDGE'] as const
export type MessageKind = (typeof MESSAGE_KINDS)[number]

export function outboundKindAllowed(kind: MessageKind): boolean {
  return kind === 'REQUEST'
}

// ─────────────────────────────────────────────────────────────── decisions ──

export type DispatchState =
  | 'PENDING'
  | 'CLAIMED'
  | 'HANDOFF_STARTED'
  | 'ACCEPTED'
  | 'UNKNOWN'
  | 'FAILED_FINAL'
  | 'SUPPRESSED'
  | 'RESPONDED'

/**
 * Counters passed to `refusalFor` are **before** this candidate: they describe what is already
 * reserved/consumed for the RUN, RECIPIENT and DAY scopes, excluding `segments`. The policy
 * adds `segments` itself. The database reservation is the authority; this is the early check.
 */
export type SendInput = {
  at: Date
  segments: number
  used: { RUN: number; RECIPIENT: number; DAY: number }
  /** Run-level dollars already reserved, in micros. */
  runCostMicros: number
  suppressed: boolean
  killSwitchOn: boolean
  kind?: MessageKind
  body?: string
}

export function runCostMicros(segments: number): number {
  return segments * SEGMENT_PRICE_MICROS
}

/**
 * The single decision point before handoff. Returns the first refusal, or null when the send
 * may proceed. Order: body, kind, kill switch, suppression, window, then limits.
 */
export function refusalFor(input: SendInput): Refusal | null {
  if (input.body !== undefined) {
    try {
      analyzeSegments(input.body)
    } catch {
      return 'EMPTY_BODY'
    }
  }
  if (input.kind !== undefined && !outboundKindAllowed(input.kind)) return 'DEFERRED_KIND'
  if (input.killSwitchOn) return 'KILL_SWITCH'
  if (input.suppressed) return 'SUPPRESSED'
  if (!isWithinSendWindow(input.at)) return 'WINDOW'
  if (input.used.RUN + input.segments > CAPS.RUN) return 'LIMIT_RUN'
  if (input.used.RECIPIENT + input.segments > CAPS.RECIPIENT) return 'LIMIT_RECIPIENT'
  if (input.used.DAY + input.segments > CAPS.DAY) return 'LIMIT_DAY'
  if (input.runCostMicros + runCostMicros(input.segments) > RUN_COST_CAP_MICROS) return 'LIMIT_COST_RUN'
  return null
}

// ─────────────────────────────────────────────────────────── crash safety ──

export type DispatchView = {
  state: DispatchState
  claimExpiresAt: Date | null
  /** Fencing token of whoever holds the claim. Rotates on every successful claim/reclaim. */
  claimToken: string | null
  /** Persisted BEFORE the provider request. Non-null means a handoff may have reached the provider. */
  handoffStartedAt: Date | null
  providerMessageId: string | null
}

export type SendabilityRefusal =
  | 'HANDOFF_STARTED'
  | 'PROVIDER_ID'
  | 'CLAIMED_BY_OTHER'
  | 'CLAIM_ACTIVE'
  | 'NOT_RETRYABLE'

export type Sendability = { send: true } | { send: false; reason: SendabilityRefusal }

/**
 * May this dispatch be handed to the provider, by `workerToken` right now?
 *
 * The first two rules are absolute and precede state entirely:
 *  - a persisted handoff marker means the provider may already have the message. Expired
 *    lease, process restart, missing provider id — none of them undo that. Reconcile it, or
 *    leave it UNKNOWN.
 *  - a provider message id is proof of handoff.
 *
 * Only then: PENDING may send; an EXPIRED claim may be used again by the worker that holds
 * the matching fencing token (a worker whose token was rotated away by a takeover is refused
 * even though the lease looks expired). A live claim is never stolen.
 */
export function maySend(view: DispatchView, now: Date, workerToken: string): Sendability {
  if (view.handoffStartedAt !== null) return { send: false, reason: 'HANDOFF_STARTED' }
  if (view.providerMessageId !== null) return { send: false, reason: 'PROVIDER_ID' }
  if (view.state === 'PENDING') return { send: true }
  if (view.state === 'CLAIMED') {
    if (view.claimExpiresAt === null || view.claimExpiresAt.getTime() > now.getTime()) {
      return { send: false, reason: 'CLAIM_ACTIVE' }
    }
    if (view.claimToken !== null && view.claimToken !== workerToken) {
      return { send: false, reason: 'CLAIMED_BY_OTHER' }
    }
    return { send: true }
  }
  return { send: false, reason: 'NOT_RETRYABLE' }
}

/** States that require reconciliation (read the provider) rather than a resend. */
export function mustReconcile(state: DispatchState): boolean {
  return state === 'UNKNOWN' || state === 'HANDOFF_STARTED'
}

/** Reservations are retained for these outcomes — the message may have been sent. */
export function retainsReservation(state: DispatchState): boolean {
  return state === 'ACCEPTED' || state === 'UNKNOWN' || state === 'HANDOFF_STARTED' || state === 'RESPONDED'
}

/**
 * A pre-handoff claim that expired was never handed off, so reclaiming it must NOT reserve the
 * same allowance a second time. The reservation is keyed by dispatch identity; this predicate
 * is the rule the SQL implements with an idempotent insert.
 */
export function reservationIsReusedOnReclaim(handoffStartedAt: Date | null): boolean {
  return handoffStartedAt === null
}
