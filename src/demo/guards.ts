/**
 * HTTP guards for the demo routes that MUTATE state.
 *
 * These live outside `server.ts` so their ORDER is a unit-testable property. Order matters and is the
 * whole point: a demo guide (read-only) must be refused even though it is a valid demo session, and an
 * unauthenticated caller must learn nothing about whether a session would otherwise be allowed.
 *
 * Cleanup itself stays in `src/demo/reset.ts` (and migration 0081 for Add-a-Villager provenance). This
 * module decides WHO may call the route; it never decides WHAT is deleted.
 */

export const LOOPBACK_ADDRESSES: ReadonlySet<string> = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** The demo login binds loopback only. A request from anywhere else is refused before auth is consulted. */
export function isLoopback(address: string): boolean {
  return LOOPBACK_ADDRESSES.has(address);
}

export type GuardIdentity = {
  ok: boolean;
  demo?: boolean;
  demoGuide?: boolean;
  personId?: string;
};

export type Refusal = { status: number; body: Record<string, unknown> };

/**
 * Identity refusals in a fixed order:
 *   401 not authenticated → 403 not a demo session → 403 demo guide (read-only).
 * The guide check is last on purpose but must still win over any mutation: a guide is a demo session,
 * so without this branch it would pass the first two checks.
 */
export function identityRefusal(identity: GuardIdentity): Refusal | null {
  if (!identity.ok) return { status: 401, body: { error: 'UNAUTHENTICATED' } };
  if (!identity.demo) return { status: 403, body: { error: 'DEMO_SESSION_REQUIRED' } };
  if (identity.demoGuide) return { status: 403, body: { error: 'DEMO_GUIDE_READ_ONLY' } };
  return null;
}

/** One call per person per cooldown. `retryAfterMs` is what a caller needs to behave, not a bare 429. */
export function cooldownRefusal(
  now: number,
  last: number,
  cooldownMs: number,
  error: string,
): Refusal | null {
  const remaining = cooldownMs - (now - last);
  if (remaining <= 0) return null;
  return { status: 429, body: { error, retryAfterMs: remaining } };
}

/** Bodies are never cacheable: a cached reset response is a lie about the state that follows it. */
export const NO_STORE = 'no-store';

/**
 * One reset per identity AT A TIME.
 *
 * The cooldown is time-based and does not stop two requests that arrive inside the same millisecond —
 * both pass the cooldown check before either records itself, and two concurrent `resetDemo()` calls then
 * interleave inside the database. The advisory lock in `resetDemo` serialises them, but the second one
 * still runs a full restore against a state the first has already restored.
 */
export class InFlightLocks {
  private readonly active = new Set<string>();

  tryAcquire(key: string): boolean {
    if (this.active.has(key)) return false;
    this.active.add(key);
    return true;
  }

  release(key: string): void {
    this.active.delete(key);
  }

  has(key: string): boolean {
    return this.active.has(key);
  }

  get size(): number {
    return this.active.size;
  }
}

export const RESET_IN_FLIGHT: Refusal = { status: 409, body: { error: 'RESET_IN_FLIGHT' } };

/**
 * Sliding-window limiter, keyed by whatever the caller passes (a resolved client IP, not a persona).
 * A persona-keyed limit does nothing against a caller that can mint several personas.
 */
export function windowRefusal(
  now: number,
  hits: readonly number[],
  windowMs: number,
  max: number,
  error: string,
): Refusal | null {
  const recent = hits.filter((t) => now - t < windowMs);
  if (recent.length < max) return null;
  const retryAfterMs = Math.max(1, windowMs - (now - recent[0]));
  return { status: 429, body: { error, retryAfterMs } };
}
