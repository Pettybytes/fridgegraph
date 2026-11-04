/**
 * Pickup outreach send orchestration — the ONE path from an authorized pickup attempt to a
 * provider handoff. Nothing else may call the provider.
 *
 * This is the "glue" the dispatcher runs. It is deliberately transport- and database-agnostic:
 *  - pure policy decisions come from ./policy (refusalFor, normalizePhone, segmentsFor, …);
 *  - the authoritative atomic claim+reserve / handoff / accept live in SQL (migration 0087),
 *    reached through the injected `OutreachStore`;
 *  - the provider call goes through the injected `GhlTransport`, so a capturing mock can prove
 *    the EXACT outbound request (recipient, body, auth scheme) without sending anything.
 *
 * Direct-to-GHL by design: n8n and its HMAC hop are OFF the critical path (see makeGhlTransport).
 * The kill switch, caps, send window, suppression and the test-responder roster are all checked
 * BEFORE any handoff; the final kill-switch/window read happens at the handoff boundary.
 *
 * Contract: docs/contracts/pickup-sms-dispatch.v1.md (v1.1) §1, §3, §4, §5, §8.
 */
import {
  refusalFor,
  tryNormalizePhone,
  segmentsFor,
  suppressionKey,
  detroitDate,
  outboundKindAllowed,
  type Refusal,
  type MessageKind,
  type PhoneRegion,
} from './policy'

/**
 * The approved test-responder roster, by PERSONA id (safe to commit — these are fictional persona
 * ids, never phone numbers). A recipient qualifies only if their persona is here AND their GHL
 * contact carries the `fg-test-responder` tag (passed in as `isTestResponder`, read from GHL at
 * runtime). A new job version never widens this set (v1.1 §5).
 *   p_gma   = Loretta Brooks   p_tasha = Tasha Ellison   p_bryan = Bryan Brooks
 */
export const TEST_RESPONDER_ROSTER = ['p_gma', 'p_tasha', 'p_bryan'] as const
export type TestResponderPersona = (typeof TEST_RESPONDER_ROSTER)[number]

export function isTestResponderPersona(personaId: string): personaId is TestResponderPersona {
  return (TEST_RESPONDER_ROSTER as readonly string[]).includes(personaId)
}

/** Only the fictional showcase parent may initiate outreach to the test roster (v1.1 §5, blocker #5). */
export const SHOWCASE_PARENT_PERSONA = 'p_showcase_parent'

export type SendRefusal =
  | Refusal // policy refusals: KILL_SWITCH, SUPPRESSED, WINDOW, LIMIT_*, EMPTY_BODY, DEFERRED_KIND
  | 'NOT_TEST_RESPONDER' // recipient persona not on the roster, or missing the fg-test-responder tag
  | 'SENDER_NOT_AUTHORIZED' // caller is not the showcase parent
  | 'BAD_PHONE' // recipient phone did not reach canonical E.164
  | 'CLAIM_REFUSED' // the authoritative SQL claim+reserve refused (lost race or cap at the DB)

export type Recipient = {
  personaId: string
  /** The recipient's phone as stored in GHL. Never logged; normalized through policy. */
  phone: string
  region?: PhoneRegion
  /** True iff the GHL contact carries the `fg-test-responder` tag (read from GHL at runtime). */
  isTestResponder: boolean
  /** The GHL contact id the provider addresses. */
  contactId: string
}

export type SendRequest = {
  sender: { personaId: string }
  recipient: Recipient
  attemptId: string
  candidateId: string
  jobVersion: number
  runId: string
  body: string
  kind?: MessageKind
  at?: Date
  workerId?: string
  leaseSeconds?: number
}

/** The exact outbound the transport is asked to send — this is what the mock captures. */
export type OutboundMessage = {
  channel: 'SMS'
  contactId: string
  to: string // canonical E.164
  body: string
  segments: number
}

export type ProviderResult =
  | { ok: true; providerMessageId: string }
  /** Any response that does not unambiguously prove acceptance → UNKNOWN, never a resend (v1.1 §1.2). */
  | { ok: false; uncertain: boolean; detail: string }

export interface GhlTransport {
  /** The auth scheme this transport uses, surfaced for the capture proof. */
  readonly authScheme: string
  send(message: OutboundMessage): Promise<ProviderResult>
}

/**
 * The database side (migration 0087), injected so the orchestration can run against the live
 * service-role client in production and against a disposable Postgres container in the rehearsal.
 */
export interface OutreachStore {
  isSuppressed(suppressionKeyHex: string): Promise<boolean>
  counters(input: { recipientKey: string; runId: string; day: string }): Promise<{
    RUN: number
    RECIPIENT: number
    DAY: number
    runCostMicros: number
  }>
  ensureDispatch(input: {
    dispatchId: string
    runId: string
    attemptId: string
    candidateId: string
    jobVersion: number
  }): Promise<void>
  dispatchId(input: { attemptId: string; candidateId: string; jobVersion: number; kind: MessageKind }): Promise<string>
  claimAndReserve(input: {
    dispatchId: string
    owner: string
    leaseSeconds: number
    recipientKey: string
    segments: number
    day: string
  }): Promise<{ ok: true; token: string } | { ok: false; reason: string }>
  markHandoff(input: { dispatchId: string; token: string }): Promise<boolean>
  markAccepted(input: { dispatchId: string; token: string; providerMessageId: string }): Promise<void>
  markUnknown(input: { dispatchId: string; token: string; detail: string }): Promise<void>
}

export type SendOutcome =
  | { sent: true; dispatchId: string; outbound: OutboundMessage; providerMessageId: string }
  | { sent: false; refusal: SendRefusal; dispatchId: string | null; outbound: OutboundMessage | null }

export type SendDeps = {
  store: OutreachStore
  transport: GhlTransport
  /** Server-side HMAC key for the suppression lookup. Never logged, never committed. */
  suppressionServerKey: string
  /** Runtime-readable, default-OFF kill switch, read at the handoff boundary (v1.1 §4.1). */
  readKillSwitch: () => boolean | Promise<boolean>
}

/**
 * Run the full send decision and, only if every gate passes, hand off to the provider exactly once.
 *
 * Order of refusals (fail closed, never send on doubt):
 *   sender authorized → recipient on roster+tagged → phone canonical → body/kind/kill/suppress/
 *   window/caps (policy) → authoritative SQL claim+reserve → handoff marker → provider → accept.
 */
export async function runSend(req: SendRequest, deps: SendDeps): Promise<SendOutcome> {
  const at = req.at ?? new Date()
  const kind: MessageKind = req.kind ?? 'REQUEST'
  const refuse = (refusal: SendRefusal, dispatchId: string | null = null): SendOutcome =>
    ({ sent: false, refusal, dispatchId, outbound: null })

  // 1. Only the showcase parent may initiate test-roster outreach (blocker #5).
  if (req.sender.personaId !== SHOWCASE_PARENT_PERSONA) return refuse('SENDER_NOT_AUTHORIZED')

  // 2. The recipient must be on the roster AND carry the fg-test-responder tag. A new job version
  //    never widens this (v1.1 §5).
  if (!isTestResponderPersona(req.recipient.personaId) || !req.recipient.isTestResponder) {
    return refuse('NOT_TEST_RESPONDER')
  }

  // 3. Canonical E.164 — the one phone path the roster, replies and suppression all share.
  const phone = tryNormalizePhone(req.recipient.phone, { region: req.recipient.region })
  if (!phone.ok) return refuse('BAD_PHONE')
  const to = phone.e164

  // 4. Follow-up kinds do not exist yet (v1.1); refuse before reserving anything.
  if (!outboundKindAllowed(kind)) return refuse('DEFERRED_KIND')

  // 5. Real segment count; an empty body is a bug, not a one-segment send.
  let segments: number
  try {
    segments = segmentsFor(req.body)
  } catch {
    return refuse('EMPTY_BODY')
  }

  // 6. Suppression is keyed by a server-side HMAC of the canonical number; the raw number is never
  //    stored or compared (v1.1 §3).
  const recipientKey = suppressionKey(to, deps.suppressionServerKey)
  if (await deps.store.isSuppressed(recipientKey)) return refuse('SUPPRESSED')

  // 7. The policy pre-check: kill switch (read fresh at the boundary), window, and caps against the
  //    counters already reserved for this run/recipient/day. The SQL reservation is authoritative;
  //    this is the early, honest refusal that must agree with it.
  const day = detroitDate(at)
  const used = await deps.store.counters({ recipientKey, runId: req.runId, day })
  const killSwitchOn = await deps.readKillSwitch()
  const policyRefusal = refusalFor({
    at,
    segments,
    used: { RUN: used.RUN, RECIPIENT: used.RECIPIENT, DAY: used.DAY },
    runCostMicros: used.runCostMicros,
    suppressed: false, // already checked above with the real key
    killSwitchOn,
    kind,
    body: req.body,
  })
  if (policyRefusal) return refuse(policyRefusal)

  // 8. Authoritative atomic claim + reserve (0087). Zero rows / a cap at the DB means another worker
  //    owns it or the allowance is spent — stop, do not send (v1.1 §1.1).
  const dispatchId = await deps.store.dispatchId({ attemptId: req.attemptId, candidateId: req.candidateId, jobVersion: req.jobVersion, kind })
  await deps.store.ensureDispatch({ dispatchId, runId: req.runId, attemptId: req.attemptId, candidateId: req.candidateId, jobVersion: req.jobVersion })
  const owner = req.workerId ?? `worker-${process.pid}`
  const claim = await deps.store.claimAndReserve({
    dispatchId,
    owner,
    leaseSeconds: req.leaseSeconds ?? 60,
    recipientKey,
    segments,
    day,
  })
  if (!claim.ok) {
    // A DB cap maps to the specific limit refusal when the reason says so; otherwise a lost race.
    const r = claim.reason
    const mapped: SendRefusal =
      r === 'LIMIT_RUN' || r === 'LIMIT_RECIPIENT' || r === 'LIMIT_DAY' || r === 'LIMIT_COST_RUN'
        ? (r as Refusal)
        : 'CLAIM_REFUSED'
    return refuse(mapped, dispatchId)
  }

  // 9. Persist the handoff marker BEFORE the provider call. If this returns false the reservation
  //    exists but the fence rejected us — do not send.
  const handoff = await deps.store.markHandoff({ dispatchId, token: claim.token })
  const outbound: OutboundMessage = { channel: 'SMS', contactId: req.recipient.contactId, to, body: req.body, segments }
  if (!handoff) return { sent: false, refusal: 'CLAIM_REFUSED', dispatchId, outbound: null }

  // 10. The ONE provider handoff. Anything that does not prove acceptance becomes UNKNOWN and is
  //     never resent (v1.1 §1.2).
  const result = await deps.transport.send(outbound)
  if (!result.ok) {
    await deps.store.markUnknown({ dispatchId, token: claim.token, detail: result.detail })
    return { sent: false, refusal: 'CLAIM_REFUSED', dispatchId, outbound }
  }
  await deps.store.markAccepted({ dispatchId, token: claim.token, providerMessageId: result.providerMessageId })
  return { sent: true, dispatchId, outbound, providerMessageId: result.providerMessageId }
}
