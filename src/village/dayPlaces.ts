/**
 * The event day read — the ONE place a day's events become a DayPlan.
 *
 * `event_day_places(p_child, p_day)` (migration 0061, STAGED — not applied to the live database)
 * authorizes on the caller's own claims: `is_parent_of(p_child)` or `has_scope(p_child,'schedule.read')`.
 * Nothing here re-implements that check. The bearer that reaches the accessor is the caller's, and the
 * database — not this module — decides which rows exist.
 *
 * Three states, never collapsed:
 *   'linked'    the event-to-place linkage is readable → placeId + placeName are returned
 *   'withheld'  a linkage exists but this caller may not read it → both stay NULL, the event renders
 *   'unlinked'  the event has no place at all → both stay NULL
 *
 * NONE of the three grants coordinates. The accessor has no coordinate fields; positions stay behind
 * `place_route_geometry_for` (0058) and its own parent/`address.read` gate. This module adds no
 * geometry, and never parses `events.location` or infers a venue from a title.
 *
 * A lookup failure is NOT an empty day. The accessor returns zero rows both for "nothing scheduled"
 * and for "no schedule authority" (deliberately — an unrelated caller learns nothing), so an empty
 * list is a real answer. A failed RPC, a malformed row or an unknown state is reported as
 * `LOOKUP_FAILED` and must never render as "nothing is on the calendar".
 */
import type { Ctx } from '../authz';
import { dbFor } from '../db';
import type { DayPlan, DayPlaceState } from '../rosina/villageMap';

/** Exactly the accessor's columns. No coordinates exist here, on purpose. */
export type DayPlaceRow = {
  event_id: string;
  title: string;
  start_at: string;
  state: DayPlaceState;
  place_id: string | null;
  place_label: string | null;
};

/**
 * The transport seam. A stub in tests; in production the RPC below. It takes the bearer explicitly
 * so "the caller's own token" is a checked property, not a comment.
 */
export type DayTransport = (args: { token: string; childId: string; day: string }) => Promise<{
  data: unknown;
  error: { code?: string; message?: string } | null;
}>;

export type DayRead = { ok: true; plan: DayPlan } | { ok: false; reason: 'LOOKUP_FAILED' };

export const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const isDay = (value: string): boolean => DAY_PATTERN.test(value);

const STATES: ReadonlySet<string> = new Set(['linked', 'withheld', 'unlinked']);

/**
 * RPC transport over the caller's OWN RLS-scoped client (src/db.ts). It refuses a token that is not
 * the context's token: a per-request client built from one identity must never answer another's read.
 */
export function dbDayTransport(ctx: Ctx): DayTransport {
  return async ({ token, childId, day }) => {
    if (!token || ctx.token !== token) throw new Error('DAY_TRANSPORT_TOKEN_MISMATCH');
    // The argument names are the accessor's: p_child / p_day. `p_day` is a date, sent as YYYY-MM-DD.
    const { data, error } = await dbFor(ctx).rpc('event_day_places', { p_child: childId, p_day: day });
    return { data, error: (error as { code?: string; message?: string } | null) ?? null };
  };
}

/**
 * Rows → DayPlan. Strict by design: a row this module cannot map is a contract defect, and the whole
 * day fails closed rather than dropping an event or inventing a place.
 */
export function toDayPlan(data: unknown, date: string): DayPlan {
  if (!Array.isArray(data)) throw new Error('DAY_ROWS_NOT_AN_ARRAY');

  const items = data.map((raw) => {
    const row = raw as Partial<DayPlaceRow> | null;
    if (!row || typeof row !== 'object') throw new Error('DAY_ROW_NOT_AN_OBJECT');

    const state = String(row.state);
    if (!STATES.has(state)) throw new Error('DAY_STATE_UNKNOWN');

    if (typeof row.event_id !== 'string' || row.event_id === '') throw new Error('DAY_EVENT_ID_MISSING');
    const at = typeof row.start_at === 'string' ? row.start_at : '';
    if (at === '') throw new Error('DAY_START_MISSING');
    const title = typeof row.title === 'string' ? row.title : '';

    const base = { eventId: row.event_id, title, at };

    if (state === 'linked') {
      // A half-link is not a place: both halves are required, and neither is inferred.
      if (typeof row.place_id !== 'string' || row.place_id === '') throw new Error('DAY_LINK_INCOMPLETE');
      if (typeof row.place_label !== 'string') throw new Error('DAY_LINK_INCOMPLETE');
      return { ...base, placeId: row.place_id, placeName: row.place_label, placeState: 'linked' as const };
    }

    // 'withheld' and 'unlinked' never echo an id or a label, even if a row carries one. A withheld
    // link must not become an oracle; an unlinked event must not acquire a place it never had.
    return { ...base, placeId: null, placeName: null, placeState: state as 'withheld' | 'unlinked' };
  });

  return { date, items };
}

/** Read one child's day. Authorization is the accessor's; this only refuses to run unauthenticated. */
export async function readDayPlan(
  transport: DayTransport,
  args: { token: string; childId: string; day: string },
): Promise<DayRead> {
  if (!args.token || !args.childId || !isDay(args.day)) return { ok: false, reason: 'LOOKUP_FAILED' };

  try {
    const { data, error } = await transport(args);
    if (error) return { ok: false, reason: 'LOOKUP_FAILED' };
    return { ok: true, plan: toDayPlan(data, args.day) };
  } catch (e) {
    // Never surface a driver/transport message: a failure is one opaque state.
    console.error('[village:day] read failed:', e instanceof Error ? e.message : 'unknown');
    return { ok: false, reason: 'LOOKUP_FAILED' };
  }
}
