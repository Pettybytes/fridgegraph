/**
 * Rewrites known timestamp fields in a tool result to the family's own local time
 * (America/Detroit) BEFORE the result ever reaches the model — a deterministic server-side
 * transform, not a hope that the model converts a raw UTC string correctly on its own. A no-op
 * on anything without those keys (PickupCandidates' and EffectiveSchedule's responses are
 * untouched; neither has a timestamp field).
 *
 *   at, closedAt       — JobTimeline / Attempts (TASK R-TOOLS-1)
 *   start, end         — ChildEvents / AdultAvailability (TASK R-TOOLS-2)
 */
const ZONE = 'America/Detroit';

const FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE,
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZoneName: 'short',
});

const TIMESTAMP_KEYS = new Set(['at', 'closedAt', 'start', 'end']);

export function toFamilyLocalTime(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return FORMAT.format(date);
}

const DETROIT_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

/**
 * The America/Detroit CALENDAR DATE (YYYY-MM-DD) for an instant — the family's "today", not UTC's.
 * Anything that means a household calendar day (a grant's start date, the `ctx.today` a day-windowed
 * read is evaluated against) must use this: `new Date().toISOString().slice(0,10)` is UTC and rolls
 * over to tomorrow in the Detroit evening (e.g. 22:30 ET is already the next UTC day), which silently
 * dated things a day ahead. Real timestamps (an exact instant) are a different thing and keep ISO/UTC.
 */
export function detroitToday(now: Date = new Date()): string {
  return DETROIT_DAY.format(now); // en-CA formats as YYYY-MM-DD
}

/**
 * Deterministic `validFrom` for an Add-a-Villager proposal (TASK). No/invalid/past date → Detroit
 * today; a today-or-future date the parent actually asked for is preserved. The default is NEVER UTC
 * and NEVER the model's unchecked value, so "add Dana, no start date" at 22:30 ET can't silently
 * start tomorrow. The resolved value is what gets staged, so it stays bound to the proposal/version.
 */
function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`); // round-trip rejects shape-valid-but-unreal (e.g. 2026-13-40)
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function resolveVillagerValidFrom(supplied: string | null | undefined, now: Date = new Date()): string {
  const today = detroitToday(now);
  const s = typeof supplied === 'string' ? supplied.trim() : '';
  if (!isRealDate(s)) return today; // unspecified or malformed → today
  return s < today ? today : s; // a past date can't start a new grant → today; today/future preserved
}

export function localizeTimestamps(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(localizeTimestamps);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = TIMESTAMP_KEYS.has(key) ? toFamilyLocalTime(v) : localizeTimestamps(v);
    }
    return out;
  }
  return value;
}
