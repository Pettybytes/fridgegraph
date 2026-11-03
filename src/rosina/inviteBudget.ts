/**
 * Invite throttling: a per-caller fixed-window rate limiter — returns retryAfterMs so the 429 can
 * tell the client when to retry. In-memory (ephemeral), process-wide across callers.
 *
 * The generation BUDGET used to live here too (a single process-wide counter). It is now the
 * real, per-CHILD, persistent ledger in inviteLedgerBudget.ts (0085) — a process-wide in-memory
 * counter is not a "per-family limit" and does not survive a restart. This file keeps only the
 * rate limiter, which is abuse-prevention, not money-adjacent.
 */

export type RateDecision = { allowed: true } | { allowed: false; retryAfterMs: number };

export interface InviteRateLimiter {
  take(key: string): RateDecision;
}

export function createInviteRateLimiter(limitPerWindow: number, windowMs = 60_000, now: () => number = Date.now): InviteRateLimiter {
  const windowStart = new Map<string, number>();
  const count = new Map<string, number>();
  return {
    take(key: string): RateDecision {
      const t = now();
      if (windowStart.size > 5000) {
        windowStart.clear();
        count.clear();
      }
      const start = windowStart.get(key);
      if (start === undefined || t - start >= windowMs) {
        windowStart.set(key, t);
        count.set(key, 1);
        return { allowed: true };
      }
      const next = (count.get(key) ?? 0) + 1;
      count.set(key, next);
      if (next <= limitPerWindow) return { allowed: true };
      return { allowed: false, retryAfterMs: Math.max(0, windowMs - (t - start)) };
    },
  };
}

