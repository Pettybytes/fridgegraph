/**
 * Per-CHILD daily generation budget, backed by the real persistent ledger (0085, STAGED — not
 * applied by this PR) instead of the process-wide in-memory GenerationBudget (inviteBudget.ts).
 * Reached the SAME way every other Invites dependency reaches data: through the router, AS THE
 * CALLER (the caller's own bearer forwarded, never a service key) — Rosina holds no DB
 * credential of its own. Money-adjacent (AGENTS.md §1.6): built on explicit instruction, staged
 * only, awaiting human review before any apply.
 */

export type InviteLedgerReservation = { allowed: boolean; generationId: string | null; remainingUsd: number };

export interface InviteLedgerBudget {
  /** Called BEFORE the image model, only when source === 'MUSE_IMAGE' — FIXTURE spends nothing
   *  and never touches the ledger at all. */
  reserve(input: { childId: string; costUsd: number; source: 'MUSE_IMAGE'; promptHash: string; bearer: string }): Promise<InviteLedgerReservation>;
  /** Called AFTER the image call resolves, only for a reservation reserve() actually made. */
  settle(input: { generationId: string; status: 'SUCCEEDED' | 'FAILED'; model: string | null; outputSha256: string | null; bearer: string }): Promise<boolean>;
}

const RESERVE_MUTATION = 'mutation ReserveInviteBudget($c: ID!, $cost: Float!, $src: String!, $hash: String!) { reserveInviteBudget(childId: $c, costUsd: $cost, source: $src, promptHash: $hash) { allowed generationId remainingUsd } }';
const SETTLE_MUTATION = 'mutation SettleInviteBudget($g: ID!, $s: String!, $m: String, $h: String) { settleInviteBudget(generationId: $g, status: $s, model: $m, outputSha256: $h) }';

export function buildInviteLedgerBudget(cfg: { graphqlUrl: string; fetchFn?: typeof fetch }): InviteLedgerBudget {
  const doFetch = cfg.fetchFn ?? fetch;
  return {
    async reserve({ childId, costUsd, source, promptHash, bearer }) {
      const res = await doFetch(cfg.graphqlUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
        body: JSON.stringify({ query: RESERVE_MUTATION, variables: { c: childId, cost: costUsd, src: source, hash: promptHash } }),
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
    async settle({ generationId, status, model, outputSha256, bearer }) {
      try {
        const res = await doFetch(cfg.graphqlUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
          body: JSON.stringify({ query: SETTLE_MUTATION, variables: { g: generationId, s: status, m: model, h: outputSha256 } }),
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

/** Modeled on DALL-E 3's published Standard 1024x1024 price — the closest real, currently
 *  published comparable, since Muse Image has no price list of its own (src/rosina/inviteImage.ts
 *  requests the same 1024x1024 size). Source: OpenAI's published API pricing, $0.04/image,
 *  observed 2026-11-03. Revisit if Muse Image ever publishes its own figure. */
export const INVITE_GENERATION_COST_USD = 0.04;
