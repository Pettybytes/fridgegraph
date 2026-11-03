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
 */

export type InviteLedgerReservation = { allowed: boolean; generationId: string | null; remainingUsd: number };
export type InviteGenerationOutcome = 'SUCCEEDED' | 'FAILED' | 'UNCERTAIN';

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
const SETTLE_MUTATION = 'mutation SettleInviteBudget($g: ID!, $s: InviteGenerationOutcome!, $m: String, $h: String, $cached: Boolean!) { settleInviteBudget(generationId: $g, status: $s, model: $m, outputSha256: $h, cached: $cached) }';

export function buildInviteLedgerBudget(cfg: { graphqlUrl: string; fetchFn?: typeof fetch }): InviteLedgerBudget {
  const doFetch = cfg.fetchFn ?? fetch;
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
        const res = await doFetch(cfg.graphqlUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
          body: JSON.stringify({ query: SETTLE_MUTATION, variables: { g: generationId, s: status, m: model, h: outputSha256, cached } }),
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
