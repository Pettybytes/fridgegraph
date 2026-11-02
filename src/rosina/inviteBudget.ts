/**
 * Invite throttling: a per-caller fixed-window rate limiter (returns retryAfterMs so the 429 can tell
 * the client when to retry) and a process-wide generation budget. The budget is a single counter for
 * the whole process — NOT keyed by caller or session — so a new login cannot reset it. Both are
 * in-memory (ephemeral slice, no DB).
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

export interface GenerationBudget {
  tryConsume(): boolean;
  /** Give a consumed unit back when nothing was actually generated (e.g. a pre-generation guard
   *  refused). Never goes below zero. */
  refund(): void;
  remaining(): number;
}

/** Process-wide total generations. One counter, no per-caller/per-session key — a fresh login shares
 *  the same counter and cannot reset it. */
export function createGenerationBudget(max: number): GenerationBudget {
  let used = 0;
  return {
    tryConsume(): boolean {
      if (used >= max) return false;
      used += 1;
      return true;
    },
    refund(): void {
      if (used > 0) used -= 1;
    },
    remaining(): number {
      return Math.max(0, max - used);
    },
  };
}
