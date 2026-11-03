import { createHmac } from 'node:crypto';

/**
 * Per-CHILD daily generation budget, backed by the real persistent ledger (0085, STAGED — not
 * applied by this PR) instead of the process-wide in-memory GenerationBudget (inviteBudget.ts).
 * Reached the SAME way every other Invites dependency reaches data: through the router, AS THE
 * CALLER (the caller's own bearer forwarded, never a service key) — Rosina holds no DB
 * credential of its own. Money-adjacent (AGENTS.md §1.6): built on explicit instruction, staged
 * only, awaiting human review before any apply.
 *
 * Cost and settlement are decided SERVER-SIDE ONLY (0085's own RPCs) — neither function here
 * sends a dollar figure. `reserve` sends only (childId, source, promptHash); the server charges
 * its own fixed per-generation constant. `settle` sends only FACTS this process actually
 * observed (which of the three closed outcomes occurred, and whether this was a cache hit); the
 * server alone computes the resulting charge.
 *
 * SETTLEMENT IS TRUSTED SERVER WORK, not a caller-reported fact. Removing the cost argument and
 * closing `status` to an enum stops a caller from naming its own PRICE, but does nothing to stop
 * the reservation's own legitimate owner from calling settleInviteBudget directly (GraphQL or the
 * raw RPC) and simply lying about the outcome — claiming FAILED or cached:true to falsely release
 * a real, billed generation. `status`/`cached` are genuinely knowable only by whoever made the
 * real provider call — THIS process, Rosina's own backend — which is the only thing holding
 * `settlementSecret`. Every settle() call includes an hmac-sha256 PROOF over the exact settlement
 * facts, keyed with that secret; 0085's `invite_budget_settle` verifies the same hmac (keyed with
 * the matching `app.invite_settlement_hmac_secret` database setting) and refuses — fails CLOSED —
 * on any mismatch or unconfigured secret, identically to an unowned reservation. `settlementSecret`
 * must never reach a browser or any client; it is read once from `INVITE_SETTLEMENT_HMAC_SECRET`
 * at server startup (src/rosina/server.ts), the same handling as the live image provider's own key.
 */

export type InviteLedgerReservation = { allowed: boolean; generationId: string | null; remainingUsd: number };
export type InviteGenerationOutcome = 'SUCCEEDED' | 'FAILED' | 'UNCERTAIN';

/** Canonical settlement message both this process and 0085's SQL hmac over — must stay
 *  byte-for-byte identical on both sides, including `cached`'s literal 'true'/'false' rendering
 *  and empty string (not null) for an absent model/outputSha256. */
function settlementMessage(input: { generationId: string; status: InviteGenerationOutcome; cached: boolean; model: string | null; outputSha256: string | null }): string {
  return [input.generationId, input.status, input.cached ? 'true' : 'false', input.model ?? '', input.outputSha256 ?? ''].join('|');
}

export interface InviteLedgerBudget {
  /** Called BEFORE the image model, only when source === 'MUSE_IMAGE' — FIXTURE spends nothing
   *  and never touches the ledger at all. No cost argument: the server charges its own fixed
   *  per-generation price. */
  reserve(input: { childId: string; source: 'MUSE_IMAGE'; promptHash: string; bearer: string }): Promise<InviteLedgerReservation>;
  /** Called AFTER the image call resolves, only for a reservation reserve() actually made.
   *  `cached` is a fact this process observed (the image client's own cache, keyed by prompt
   *  hash), never a price — the server decides the actual charge from (status, cached). */
  settle(input: { generationId: string; status: InviteGenerationOutcome; model: string | null; outputSha256: string | null; cached: boolean; bearer: string }): Promise<boolean>;
}

const RESERVE_MUTATION = 'mutation ReserveInviteBudget($c: ID!, $src: String!, $hash: String!) { reserveInviteBudget(childId: $c, source: $src, promptHash: $hash) { allowed generationId remainingUsd } }';
const SETTLE_MUTATION = 'mutation SettleInviteBudget($g: ID!, $s: InviteGenerationOutcome!, $m: String, $h: String, $cached: Boolean!, $proof: String!) { settleInviteBudget(generationId: $g, status: $s, model: $m, outputSha256: $h, cached: $cached, proof: $proof) }';

export function buildInviteLedgerBudget(cfg: { graphqlUrl: string; settlementSecret: string; fetchFn?: typeof fetch }): InviteLedgerBudget {
  const doFetch = cfg.fetchFn ?? fetch;
  const hmac = (message: string) => createHmac('sha256', cfg.settlementSecret).update(message).digest('hex');
  return {
    async reserve({ childId, source, promptHash, bearer }) {
      const res = await doFetch(cfg.graphqlUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
        body: JSON.stringify({ query: RESERVE_MUTATION, variables: { c: childId, src: source, hash: promptHash } }),
      });
      if (!res.ok) throw new Error(`INVITE_BUDGET_HTTP_${res.status}`);
      const json = (await res.json()) as {
        data?: { reserveInviteBudget?: { allowed: boolean; generationId: string | null; remainingUsd: number } };
        errors?: { extensions?: { code?: string } }[];
      };
      if (json.errors?.length) throw new Error(json.errors[0]?.extensions?.code ?? 'INVITE_BUDGET_ERROR');
      const r = json.data?.reserveInviteBudget;
      if (!r) throw new Error('INVITE_BUDGET_EMPTY');
      return { allowed: r.allowed, generationId: r.generationId, remainingUsd: r.remainingUsd };
    },
    async settle({ generationId, status, model, outputSha256, cached, bearer }) {
      try {
        const proof = hmac(settlementMessage({ generationId, status, cached, model, outputSha256 }));
        const res = await doFetch(cfg.graphqlUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
          body: JSON.stringify({ query: SETTLE_MUTATION, variables: { g: generationId, s: status, m: model, h: outputSha256, cached, proof } }),
        });
        if (!res.ok) return false;
        const json = (await res.json()) as { data?: { settleInviteBudget?: boolean }; errors?: unknown[] };
        if (json.errors?.length) return false;
        return Boolean(json.data?.settleInviteBudget);
      } catch {
        // Settle failure never blocks the response the parent already has — the reservation just
        // stays PENDING and ages out of today's active window tomorrow. Logged by the caller.
        return false;
      }
    },
  };
}

/** Muse Image's real, published per-generated-image price — $0.01, per Meta's docs. The SQL
 *  constant in 0085's `invite_budget_reserve` is authoritative (it is the one that actually
 *  charges); this export is for tests and documentation only, kept in sync by hand. Not a
 *  fictional provider, not modeled on a third-party comparable — this is Muse Image's own
 *  figure. */
export const INVITE_GENERATION_COST_USD = 0.01;
