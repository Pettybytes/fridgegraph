/**
 * Minimal in-memory fixed-window rate limiter, keyed by the caller's resolved person id (never
 * the raw token). One process, no shared store — restarting the service resets every counter.
 * Good enough for a single-instance demo service; not a distributed rate limiter.
 */
export type RateLimiter = { allow(key: string): boolean };

export function createRateLimiter(limitPerWindow: number, windowMs = 60_000): RateLimiter {
  const windowStart = new Map<string, number>();
  const count = new Map<string, number>();

  return {
    allow(key: string): boolean {
      const now = Date.now();
      if (windowStart.size > 5000) {
        windowStart.clear();
        count.clear();
      }
      const start = windowStart.get(key);
      if (start === undefined || now - start >= windowMs) {
        windowStart.set(key, now);
        count.set(key, 1);
        return true;
      }
      const next = (count.get(key) ?? 0) + 1;
      count.set(key, next);
      return next <= limitPerWindow;
    },
  };
}
