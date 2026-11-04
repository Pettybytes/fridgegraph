import { createHash } from 'node:crypto';

/**
 * One shared Rosina action contract for voice (Retell Custom-LLM bridge),
 * typed chat and the future messaging adapter (feat/rosina-retell).
 *
 * Every channel produces the same proposal shape. A proposal is NOT a
 * write: the FridgeGraph backend owns identity, authorization, parent
 * confirmation, mutation, persistence and audit, and is the only place
 * a recordId can come from. Until the parent confirms in the app and
 * the backend returns a record, result.recordId stays null and the
 * spoken status must stay "proposed"/"requested" - never "saved",
 * "booked" or "arranged".
 */

export type RosinaChannel = 'voice' | 'typed' | 'messaging';

/** The only model allowed to author a substantive proposal: the real provider model id. */
export const PROPOSAL_AUTHOR_MODEL_ID = 'muse-spark-1.3';

/**
 * Trusted server-side authorship token. It is created only beside the real
 * Muse writer wiring and is never parsed from a request payload or from
 * model output, so an action produced by a fast/voice model cannot be
 * stamped as Claude-authored after the fact.
 */
export type ProposalAuthor = { readonly modelId: typeof PROPOSAL_AUTHOR_MODEL_ID };
export function museProposalAuthor(): ProposalAuthor {
  return Object.freeze({ modelId: PROPOSAL_AUTHOR_MODEL_ID });
}

export type ActionResultStatus = 'proposed' | 'requested' | 'confirmed' | 'saved' | 'refused';

export interface RosinaActionProposal {
  contractVersion: 1;
  channel: RosinaChannel;
  actorPersonId: string;
  childId: string;
  intent: string;
  sourceFacts: string[];
  proposedChange: { summary: string; args: Record<string, unknown> };
  affectedPeople: string[];
  confirmation: { required: true; channel: 'fridgegraph-app'; status: 'awaiting-parent' };
  /** Substantive proposals are authored by Muse Spark only (Bryan 12:58 hybrid ruling); the real model id. */
  authoredBy: typeof PROPOSAL_AUTHOR_MODEL_ID;
  idempotencyKey: string;
  result: { recordId: string | null; status: ActionResultStatus };
}

export interface BuildProposalInput {
  channel: RosinaChannel;
  actorPersonId: string;
  authorizedChildIds: string[];
  childId: string;
  intent: string;
  sourceFacts: string[];
  proposedChange: { summary: string; args?: Record<string, unknown> };
  affectedPeople: string[];
  idempotencyKey?: string;
}

export type BuildProposalResult =
  | { ok: true; proposal: RosinaActionProposal }
  | { ok: false; reason: 'child-not-authorized' | 'missing-source-facts' | 'missing-change' | 'author-not-authorized'; reply: string };

export function deriveIdempotencyKey(parts: readonly (string | number)[]): string {
  return createHash('sha256').update(parts.join('')).digest('hex').slice(0, 32);
}

export function buildActionProposal(input: BuildProposalInput, author?: ProposalAuthor): BuildProposalResult {
  // Authorship is asserted by the trusted server-side writer token, never by
  // caller-supplied data: missing or non-Muse authorship is rejected.
  if (!author || author.modelId !== PROPOSAL_AUTHOR_MODEL_ID) {
    return { ok: false, reason: 'author-not-authorized', reply: 'Only Muse can author a change proposal; I can gather the details for one.' };
  }
  if (!input.authorizedChildIds.includes(input.childId)) {
    return { ok: false, reason: 'child-not-authorized', reply: 'I can only help with children shared with you.' };
  }
  if (!input.sourceFacts.length || input.sourceFacts.some((f) => !f.trim())) {
    return { ok: false, reason: 'missing-source-facts', reply: 'I do not have recorded facts to ground that change yet.' };
  }
  if (!input.proposedChange.summary.trim()) {
    return { ok: false, reason: 'missing-change', reply: 'I could not state the exact change to propose.' };
  }
  const idempotencyKey = input.idempotencyKey ?? deriveIdempotencyKey([
    input.actorPersonId, input.childId, input.intent, input.proposedChange.summary,
    JSON.stringify(input.proposedChange.args ?? {}),
  ]);
  return {
    ok: true,
    proposal: {
      contractVersion: 1,
      channel: input.channel,
      actorPersonId: input.actorPersonId,
      childId: input.childId,
      intent: input.intent,
      sourceFacts: [...input.sourceFacts],
      proposedChange: { summary: input.proposedChange.summary, args: input.proposedChange.args ?? {} },
      affectedPeople: [...input.affectedPeople],
      confirmation: { required: true, channel: 'fridgegraph-app', status: 'awaiting-parent' },
      authoredBy: author.modelId,
      idempotencyKey,
      result: { recordId: null, status: input.intent.startsWith('pickup') ? 'requested' : 'proposed' },
    },
  };
}

/** The only status wording a channel may speak before a backend record exists. */
export function spokenStatus(p: RosinaActionProposal): string {
  if (p.result.recordId) return `saved as record ${p.result.recordId}`;
  return p.result.status === 'requested'
    ? 'requested - no one is assigned yet; a parent confirms first and someone must accept'
    : 'proposed - nothing is recorded until a parent confirms in the FridgeGraph app';
}
