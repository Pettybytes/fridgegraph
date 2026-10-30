/**
 * One reused Supabase session per persona.
 *
 * WHY: the demo is one shared sandbox with no visitor accounts. Minting a session per pick is slow
 * and it burns the same per-persona throttle that a room full of visitors would; so the server keeps
 * ONE session per persona in memory and hands every visitor of that persona the same short-lived
 * access token. Judging never involves signing in.
 *
 * CONCURRENCY: mint and refresh are single-flight per persona. Thirty simultaneous picks of one
 * persona share ONE operation; the rest await it. Without that, a burst would mint thirty sessions
 * (and Supabase rotates refresh tokens, so concurrent refreshes would invalidate each other).
 *
 * RENEWAL: a request that arrives inside RENEWAL_SAFETY_WINDOW_MS (the last five minutes before
 * expiry) refreshes the cached session once and returns the NEW, real `expires_at` from Supabase. A
 * request outside the window returns the cached token untouched — no mint, no refresh. The endpoint
 * always reports the session's actual expiry; nothing here invents a later one.
 *
 * NOT A GUARANTEE: caching reduces minting and throttle exposure, but a restart, a dropped cache or a
 * rejected refresh can still require a mint. That is why MINT_* stays a retryable response.
 *
 * STATE: process memory only. Never written to disk, never logged. A restart or dropCache() clears it.
 */
import type { DemoPersona } from './personas';
import { mintSession, refreshCachedSession, type MintedSession } from './session';

/** The last five minutes before expiry: renew here instead of handing out a dying token. */
export const RENEWAL_SAFETY_WINDOW_MS = 5 * 60 * 1000;

type Entry = { personId: string; session: MintedSession };

export type PersonaSessionSource = 'cache' | 'renewed' | 'minted';

export type PersonaSessionStats = {
  mints: number;
  refreshes: number;
  refreshFallbacks: number;
  cacheHits: number;
  inflightJoins: number;
};

const zeroStats = (): PersonaSessionStats => ({
  mints: 0,
  refreshes: 0,
  refreshFallbacks: 0,
  cacheHits: 0,
  inflightJoins: 0,
});

const cache = new Map<string, Entry>();
const mintInFlight = new Map<string, Promise<Entry>>();
const refreshInFlight = new Map<string, Promise<Entry>>();
let stats = zeroStats();
let clock: () => number = () => Date.now();

function bump(key: keyof PersonaSessionStats): void {
  stats[key] += 1;
}

function assertNotProduction(hook: string): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${hook} is unavailable in production`);
  }
}

async function mintEntry(persona: DemoPersona): Promise<Entry> {
  bump('mints');
  const session = await mintSession(persona);
  const entry: Entry = { personId: persona.personId, session };
  cache.set(persona.id, entry);
  return entry;
}

/** Single-flight mint: a second caller inside the same operation awaits the first, never re-mints. */
function mintOnce(persona: DemoPersona): Promise<Entry> {
  const inFlight = mintInFlight.get(persona.id);
  if (inFlight) {
    bump('inflightJoins');
    return inFlight;
  }
  const promise = mintEntry(persona).finally(() => mintInFlight.delete(persona.id));
  mintInFlight.set(persona.id, promise);
  return promise;
}

async function refreshEntry(persona: DemoPersona, entry: Entry): Promise<Entry> {
  bump('refreshes');
  try {
    const session = await refreshCachedSession(persona, entry.session.refresh_token);
    const next: Entry = { personId: persona.personId, session };
    cache.set(persona.id, next);
    return next;
  } catch {
    // A rejected refresh means the cached refresh token is no longer usable (rotated by another
    // process, revoked user, clock skew). Drop the dead entry and mint once rather than serve a
    // token we know is wrong. The failure code stays MINT_* so the client retries.
    cache.delete(persona.id);
    bump('refreshFallbacks');
    return await mintOnce(persona);
  }
}

/** Single-flight refresh: simultaneous renewals share ONE refresh operation. */
function refreshOnce(persona: DemoPersona, entry: Entry): Promise<Entry> {
  const inFlight = refreshInFlight.get(persona.id);
  if (inFlight) {
    bump('inflightJoins');
    return inFlight;
  }
  const promise = refreshEntry(persona, entry).finally(() => refreshInFlight.delete(persona.id));
  refreshInFlight.set(persona.id, promise);
  return promise;
}

/**
 * The cached session for one persona, minted or renewed on demand.
 *
 * The returned session still carries the refresh token: this API is server-internal. Only
 * `publicPersonaSession()` may cross the wire.
 */
export async function getPersonaSession(
  persona: DemoPersona,
): Promise<{ session: MintedSession; source: PersonaSessionSource }> {
  const entry = cache.get(persona.id);
  const now = clock();

  if (entry && entry.personId === persona.personId) {
    const expiresAtMs = entry.session.expires_at * 1000;
    if (expiresAtMs - now > RENEWAL_SAFETY_WINDOW_MS) {
      bump('cacheHits');
      return { session: entry.session, source: 'cache' };
    }
    // Inside the safety window (or already expired): renew exactly once per flight.
    const pending = refreshInFlight.get(persona.id);
    if (pending) {
      bump('inflightJoins');
      return { session: (await pending).session, source: 'renewed' };
    }
    return { session: (await refreshOnce(persona, entry)).session, source: 'renewed' };
  }

  // No cache, or an entry that maps to a different person (never served).
  return { session: (await mintOnce(persona)).session, source: 'minted' };
}

/**
 * What the browser may see: a short-lived access token and its real expiry. The refresh token stays
 * in this process — the browser renews by calling the endpoint again, and never re-picks manually.
 */
export function publicPersonaSession(session: MintedSession): {
  access_token: string;
  token_type: string;
  expires_in: number;
  expires_at: number;
} {
  const nowSeconds = Math.floor(clock() / 1000);
  return {
    access_token: session.access_token,
    token_type: session.token_type || 'bearer',
    expires_in: Math.max(0, session.expires_at - nowSeconds),
    expires_at: session.expires_at,
  };
}

/** Drops every cached session. Called by a restart (implicitly) and by resetDemo. */
export function dropPersonaSessionCache(): void {
  cache.clear();
  mintInFlight.clear();
  refreshInFlight.clear();
  stats = zeroStats();
}

/** Counter snapshot for the proofs. No token ever appears here. */
export function personaSessionStats(): PersonaSessionStats {
  return { ...stats };
}

/** Test-only clock control, so the safety-window path is provable without waiting an hour. */
export function __setPersonaSessionClock(fn: () => number): void {
  assertNotProduction('__setPersonaSessionClock');
  clock = fn;
}

export function __resetPersonaSessionClock(): void {
  assertNotProduction('__resetPersonaSessionClock');
  clock = () => Date.now();
}

/** Test-only: the cached access token for a persona, or undefined. Never the refresh token. */
export function __cachedAccessToken(personaId: string): string | undefined {
  assertNotProduction('__cachedAccessToken');
  return cache.get(personaId)?.session.access_token;
}
