/**
 * Rewrites the `at`/`closedAt` timestamps in a JobTimeline/Attempts tool result to the family's
 * own local time (America/Detroit) BEFORE the result ever reaches the model — a deterministic
 * server-side transform, not a hope that the model converts a raw UTC string correctly on its
 * own. A no-op on anything without those keys (PickupCandidates' response is untouched).
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

const TIMESTAMP_KEYS = new Set(['at', 'closedAt']);

export function toFamilyLocalTime(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return FORMAT.format(date);
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
