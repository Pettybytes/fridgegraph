/**
 * Short-TTL caches that remove the fixed per-turn MCP round trips Bryan measured as dead
 * time before Rosina's first token (2026-11-03 latency order: "cache the caller's context").
 *
 * Safety posture, explicitly:
 * - Every REAL read still runs with the caller's own bearer against RLS; nothing here grants
 *   or extends access. The MyChildren cache only delays the PROMPT's view of a scope change
 *   (grant/revoke) by at most TTL seconds; the backend enforces the live truth on every call.
 * - Keys are a SHA-256 of the exact bearer, so one caller's context can never serve another's,
 *   and no token material sits in memory in recoverable form.
 * - Only SUCCESSFUL results are cached; failures stay fail-closed and uncached.
 */
import { createHash } from 'node:crypto';

export type TtlCache<T> = {
  get(key: string): T | null;
  set(key: string, value: T): void;
};

export function createTtlCache<T>(ttlMs: number, maxEntries = 500): TtlCache<T> {
  const entries = new Map<string, { at: number; value: T }>();
  return {
    get(key) {
      const hit = entries.get(key);
      if (!hit) return null;
      if (Date.now() - hit.at > ttlMs) { entries.delete(key); return null; }
      return hit.value;
    },
    set(key, value) {
      if (entries.size >= maxEntries) {
        // Drop the oldest entry; insertion order is enough at this size.
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
      }
      entries.set(key, { at: Date.now(), value });
    },
  };
}

export function bearerKey(bearer: string): string {
  return createHash('sha256').update(bearer).digest('hex');
}
