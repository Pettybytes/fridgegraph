/**
 * Collapses duplicate concurrent/rapid-repeat invite submissions into ONE real request — a
 * double-click, a network retry, or two browser tabs firing the same request must not generate
 * (and charge) twice. Keyed on (caller, child, normalized request text); in-memory, process-wide,
 * ephemeral (matches the existing rate limiter/budget's own in-memory posture for this slice).
 *
 * Two mechanisms:
 *   - IN-FLIGHT: a second call with the same key while the first is still running gets the SAME
 *     promise (same eventual result, success or failure) — never a second model/image call.
 *   - RECENT: once a call SUCCEEDS, its result is served to the same key for a short window, so a
 *     retry fired just after a success (e.g. a client that didn't see the first response) doesn't
 *     re-generate. A FAILURE is never cached here — an explicit retry after a failure must be free
 *     to actually retry.
 */
import { createHash } from 'node:crypto';

export interface InviteDedup {
  /** `cacheable` decides whether a RESOLVED result is worth serving to a later retry within the
   *  window — a handled failure (e.g. the pipeline resolves to an error shape rather than
   *  rejecting, as the invite endpoint does for a clean 502) must say `false`, or a retry after
   *  failure would be served the same failure instead of actually retrying. Defaults to true
   *  (every resolved result is cacheable) when omitted. A THROWN/rejected fn() is never cached
   *  regardless — only resolved results reach `cacheable` at all. */
  run<T>(key: string, fn: () => Promise<T>, cacheable?: (result: T) => boolean): Promise<T>;
}

export function dedupKey(personId: string, childId: string, request: string): string {
  const normalized = request.trim().toLowerCase().replace(/\s+/g, ' ');
  return `${personId}:${childId}:${createHash('sha256').update(normalized).digest('hex')}`;
}

export function createInviteDedup(windowMs = 15_000, now: () => number = Date.now): InviteDedup {
  const inflight = new Map<string, Promise<unknown>>();
  const recent = new Map<string, { result: unknown; at: number }>();

  return {
    async run<T>(key: string, fn: () => Promise<T>, cacheable: (result: T) => boolean = () => true): Promise<T> {
      const already = inflight.get(key);
      if (already) return already as Promise<T>;

      const cached = recent.get(key);
      if (cached && now() - cached.at < windowMs) return cached.result as T;

      const p = fn()
        .then((result) => { if (cacheable(result)) recent.set(key, { result, at: now() }); return result; })
        .finally(() => inflight.delete(key));
      inflight.set(key, p);
      return p;
    },
  };
}
