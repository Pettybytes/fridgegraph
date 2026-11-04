/** Isolated managed-voice tools. Bound sessions and caller-scoped reads are supplied by the host.
 * There is deliberately no mutation/Confirm dependency here. */
import { randomUUID } from 'node:crypto';
import { catalog } from './catalog';
import { buildActionProposal, museProposalAuthor, type RosinaActionProposal } from './actionContract';
import type { BridgeSession } from './retellBridge';

export type ManagedBinding = { session: BridgeSession; expiresAt: number; callId?: string };
export type ManagedDraft = { model: string; summary: string; args: unknown };
export function createManagedTool(deps: {
  resolve(token: string): ManagedBinding | null;
  facts(binding: ManagedBinding): Promise<string | null>;
  write(input: { message: string; facts: string; session: BridgeSession }): Promise<ManagedDraft>;
}) {
  // Scope receipts to the exact bind, never just parent + child. In-flight retries share work.
  const receipts = new WeakMap<ManagedBinding, Map<string, { message: string; result: Promise<unknown> }>>();
  const proposals = new WeakMap<ManagedBinding, RosinaActionProposal[]>();
  return {
    pendingForBinding(bound: ManagedBinding) {
      return bound.expiresAt > Date.now() ? proposals.get(bound) ?? [] : [];
    },
    pending(token: string) {
      const bound = deps.resolve(token);
      return bound && bound.expiresAt > Date.now() ? proposals.get(bound) ?? [] : null;
    },
    async handle(token: string, payload: unknown): Promise<{ status: number; body: unknown }> {
      const bound = deps.resolve(token);
      if (!bound || bound.expiresAt <= Date.now()) return { status: 401, body: { error: 'SESSION_EXPIRED' } };
      const p = payload as { name?: string; call?: { call_id?: string }; args?: { childId?: string; requestId?: string; message?: string } } | null;
      if (!p || typeof p.call?.call_id !== 'string' || !p.call.call_id || !p.args || p.args.childId !== bound.session.childId || !bound.session.childIds.includes(p.args.childId)) return { status: 403, body: { error: 'CHILD_NOT_AUTHORIZED' } };
      if (bound.callId && bound.callId !== p.call.call_id) return { status: 403, body: { error: 'CALL_MISMATCH' } };
      bound.callId = p.call.call_id;
      if (p.name === 'read_schedule') {
        const facts = await deps.facts(bound);
        return { status: facts ? 200 : 502, body: facts ? { facts, attribution: { answer: 'retell-model' }, executed: false } : { error: 'FACTS_UNAVAILABLE' } };
      }
      if (p.name !== 'prepare_calendar' || typeof p.args.message !== 'string' || !p.args.message.trim() || p.args.message.length > 4000 || typeof p.args.requestId !== 'string' || !p.args.requestId || p.args.requestId.length > 128) return { status: 400, body: { error: 'INVALID_TOOL' } };
      const { message, requestId } = p.args;
      let turns = receipts.get(bound);
      if (!turns) { turns = new Map(); receipts.set(bound, turns); }
      const prior = turns.get(requestId);
      if (prior && prior.message !== message) return { status: 409, body: { error: 'REQUEST_MISMATCH' } };
      if (!prior && turns.size >= 20) return { status: 429, body: { error: 'CALL_LIMIT' } };
      const work = prior?.result ?? (async () => {
        const facts = await deps.facts(bound);
        if (!facts) throw Error('FACTS_UNAVAILABLE');
        const draft = await deps.write({ message, facts, session: bound.session });
        // This is the provider response model, not a label supplied by Retell or model text.
        if (draft.model !== 'muse-spark-1.3') throw Error('AUTHOR_UNVERIFIED');
        const args = catalog['calendar-change'].argsSchema.parse(draft.args);
        if (!args || args.childId !== bound.session.childId || args.operation !== 'create') throw Error('INVALID_PROPOSAL');
        if (bound.expiresAt <= Date.now()) throw Error('SESSION_EXPIRED');
        const built = buildActionProposal({ channel: 'voice', actorPersonId: bound.session.personId,
          authorizedChildIds: bound.session.childIds, childId: args.childId, intent: 'calendar.create',
          sourceFacts: [facts, `Parent request: ${message}`], proposedChange: { summary: draft.summary, args },
          affectedPeople: [args.childName], idempotencyKey: randomUUID() }, museProposalAuthor());
        if (!built.ok) throw Error('INVALID_PROPOSAL');
        const pending = proposals.get(bound) ?? [];
        pending.push(built.proposal); proposals.set(bound, pending);
        return { proposal: built.proposal, executed: false, requiresConfirmation: true };
      })();
      if (!prior) turns.set(requestId, { message, result: work });
      try { return { status: 200, body: await work }; }
      catch { return { status: 502, body: { error: 'PROPOSAL_UNAVAILABLE', executed: false } }; }
    },
  };
}
