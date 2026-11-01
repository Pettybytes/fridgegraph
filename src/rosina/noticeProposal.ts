/**
 * Notice → Plan, step 4 (the proposal envelope) + the stateless signing that makes confirm safe
 * without a new DB table. Contract: docs/contracts/notice-plan.md §4, §4c, §5.
 *
 * A proposal is REVIEW-ONLY. The only thing that lets a later confirm act is an HMAC signature over
 * the confirmable facts: { proposalId, version, callerId, childId, scenarioDate, action, params,
 * scheduleFingerprint, expiresAt }. The signature is opaque to the client; it cannot move a param
 * without invalidating it. A changed schedule changes `scheduleFingerprint`, so a stale proposal
 * cannot confirm. Nothing here performs I/O or talks to a model.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { NoticeFact } from './noticeFacts';
import type { ConflictResult, PickupWindow, ScheduleEvent } from './noticeConflict';
import { windowForTime } from './noticeConflict';

export type ConfirmAction = { action: 'requestPickup'; params: { asOf: string; window: PickupWindow } };

export type ProposalChange = {
  what: string;
  source: NoticeFact['source'];
  whyItMatters: string;
  whoAffected: string;
  unknown: string[];
  onConfirm: ConfirmAction | { available: false; note: string };
};

/** The fields the signature binds. Kept flat and explicit so signing is unambiguous. */
export type SignedClaims = {
  proposalId: string;
  version: number;
  callerId: string;
  childId: string;
  scenarioDate: string;
  action: 'requestPickup' | 'none';
  params: { asOf: string; window: PickupWindow } | null;
  scheduleFingerprint: string;
  expiresAt: string; // ISO
};

export type ProposalEnvelope = {
  proposalId: string;
  version: number;
  childId: string;
  scenario: { referenceDate: string; timezone: string };
  source: { processingSource: string; modelId: string };
  createdAt: string;
  expiresAt: string;
  changes: ProposalChange[];
  clarification: { question: string } | null;
  /** The exact signed claims the client echoes back verbatim to confirm. Opaque to the client;
   *  at confirm the server overrides `callerId` with the authenticated id, so a different caller
   *  cannot reuse this token. */
  claims: SignedClaims;
  signature: string;
};

/** Deterministic JSON with recursively sorted object keys — the canonical form we sign/hash. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

/** A stable hash of the schedule the conflict was derived from. A material change (different
 *  event ids, or a changed end time) changes the fingerprint and invalidates the proposal. */
export function scheduleFingerprint(events: ScheduleEvent[], effectiveScheduleSource: string): string {
  const norm = events
    .map((e) => ({ id: e.id, start: e.start, end: e.end }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return createHash('sha256').update(canonicalJson({ events: norm, effective: effectiveScheduleSource })).digest('hex');
}

export function signClaims(claims: SignedClaims, key: string): string {
  return createHmac('sha256', key).update(canonicalJson(claims)).digest('hex');
}

export function verifyClaims(claims: SignedClaims, signature: string, key: string): boolean {
  const expected = signClaims(claims, key);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signature, 'hex');
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

export type BuildInput = {
  proposalId: string;
  version: number;
  callerId: string;
  childId: string;
  scenarioDate: string;
  timezone: string;
  processingSource: string;
  modelId: string;
  now: Date;
  ttlMs: number;
  signingKey: string;
  clarification: { question: string } | null;
  // Parallel arrays: one conflict per fact (same index).
  facts: NoticeFact[];
  conflicts: ConflictResult[];
  fingerprint: string;
};

/**
 * Build the signed envelope. For an early-dismissal fact WITH a conflict, the confirmable action is
 * `requestPickup(childId, asOf=scenarioDate, window=windowForTime(noticeTime))`. Every other change
 * — no conflict, or a kind with no verified action (field trip, closure) — is review-only
 * (`available:false`). The signature binds at most ONE confirmable action (the first early-dismissal
 * conflict); other changes remain informational.
 */
export function buildSignedProposal(input: BuildInput): ProposalEnvelope {
  const changes: ProposalChange[] = [];
  let confirm: ConfirmAction | null = null;

  // A plain loop (not forEach) so the compiler tracks the `confirm` assignment across iterations.
  for (let i = 0; i < input.facts.length; i++) {
    const fact = input.facts[i];
    const conflict = input.conflicts[i];
    const dateStr = fact.dates[0] ?? input.scenarioDate;
    let onConfirm: ProposalChange['onConfirm'];

    if (fact.kind === 'early_dismissal' && conflict?.hasConflict && confirm === null) {
      const window = windowForTime(conflict.noticeTime);
      confirm = { action: 'requestPickup', params: { asOf: input.scenarioDate, window } };
      onConfirm = confirm;
    } else if (fact.kind === 'field_trip') {
      onConfirm = { available: false, note: 'Permission slips are review-only here — noted, no action available.' };
    } else {
      onConfirm = { available: false, note: 'noted — no action available' };
    }

    const whatTime = fact.times[0]?.time ? ` at ${fact.times[0].time}` : '';
    changes.push({
      what: `${humanKind(fact.kind)}${whatTime}${dateStr ? ` on ${dateStr}` : ''}`,
      source: fact.source,
      whyItMatters: conflict ? conflict.detail : 'No schedule comparison was available.',
      whoAffected: fact.appliesTo || 'Unspecified',
      unknown: [],
      onConfirm,
    });
  }

  const expiresAt = new Date(input.now.getTime() + input.ttlMs).toISOString();
  const claims: SignedClaims = {
    proposalId: input.proposalId,
    version: input.version,
    callerId: input.callerId,
    childId: input.childId,
    scenarioDate: input.scenarioDate,
    action: confirm ? 'requestPickup' : 'none',
    params: confirm ? confirm.params : null,
    scheduleFingerprint: input.fingerprint,
    expiresAt,
  };

  return {
    proposalId: input.proposalId,
    version: input.version,
    childId: input.childId,
    scenario: { referenceDate: input.scenarioDate, timezone: input.timezone },
    source: { processingSource: input.processingSource, modelId: input.modelId },
    createdAt: input.now.toISOString(),
    expiresAt,
    changes,
    clarification: input.clarification,
    claims,
    signature: signClaims(claims, input.signingKey),
  };
}

function humanKind(kind: NoticeFact['kind']): string {
  switch (kind) {
    case 'early_dismissal': return 'Early dismissal';
    case 'closure': return 'School closure';
    case 'schedule_change': return 'Schedule change';
    case 'field_trip': return 'Field trip / permission slip';
  }
}
