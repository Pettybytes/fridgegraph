/**
 * FAMILY LENS — one coarse, batched GraphQL read per session (playbook items 3 and 7), run AS
 * THE CALLER against the router with their own bearer, so routine questions ("how's my night
 * looking", "who has Nora tomorrow", "any pickups open?") need ZERO tool round trips: the
 * answer is already in the prompt.
 *
 * Authorization is unchanged: every field is resolved under the caller's own RLS, the query
 * only includes per-child fields the caller's OWN MyChildren scopes plausibly allow (mirroring
 * REQUIRED_SCOPE_BY_TOOL), and per-field errors are dropped while the rest of the data is kept
 * (a refused field never fails the lens). The lens text is pushed into the turn's grounded
 * tool-result text, so the output guard treats its names exactly like any other authorized
 * read this turn.
 *
 * The lens is a snapshot cached per bearer hash (short TTL): a stale-by-seconds view for speed,
 * with live tools still available for anything it lacks.
 */
import { SCOPE, type ChildAccess } from './childAccess';
import { detroitToday } from './localTime';

export type FamilyLens = { text: string; builtAtMs: number };

const alias = (id: string) => id.replace(/[^a-zA-Z0-9_]/g, '_');

function plusDays(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The batched query. Parent-ish scope detection: pickup.request marks a parent/guardian-grade
 * grant in today's seeds; CheckInStatus and coordinationJobs are additionally parent-gated by
 * the backend itself, so including them for a non-parent just yields a dropped per-field error. */
export function lensQuery(children: ChildAccess[], today: string): string {
  const horizon = plusDays(today, 7);
  const tomorrow = plusDays(today, 1);
  const parts: string[] = [];
  for (const child of children) {
    const a = alias(child.id);
    if (child.scopes.has(SCOPE.schedule)) {
      parts.push(`${a}_events: childEvents(childId: "${child.id}", from: "${today}", to: "${horizon}", includeCancelled: false) { title start end location status }`);
      parts.push(`${a}_careToday: effectiveScheduleFor(childId: "${child.id}", date: "${today}") { parent { id displayName } source }`);
      parts.push(`${a}_careTomorrow: effectiveScheduleFor(childId: "${child.id}", date: "${tomorrow}") { parent { id displayName } source }`);
    }
    if (child.scopes.has(SCOPE.careplan)) {
      parts.push(`${a}_careFacts: careFacts(childId: "${child.id}") { key value confidence source { ref } }`);
    }
    if (child.scopes.has(SCOPE.pickupRequest)) {
      parts.push(`${a}_pickups: coordinationJobs(childId: "${child.id}") { id type status }`);
      parts.push(`${a}_checkIn: checkInStatus(childId: "${child.id}") { recorded label dueAt }`);
    }
  }
  if (!parts.length) return '';
  return `query RosinaFamilyLens {\n  ${parts.join('\n  ')}\n}`;
}

/**
 * Build the lens with the caller's own bearer. Never throws: any failure returns null and the
 * turn proceeds on live tools alone. Field errors are dropped; partial data still serves.
 */
export async function buildFamilyLens(
  graphqlUrl: string,
  bearer: string,
  children: ChildAccess[],
  request: typeof fetch = fetch,
  today: string = detroitToday(),
): Promise<FamilyLens | null> {
  const query = lensQuery(children, today);
  if (!query || !graphqlUrl) return null;
  const started = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    let res: Response;
    try {
      res = await request(graphqlUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
        body: JSON.stringify({ query, operationName: 'RosinaFamilyLens' }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: Record<string, unknown> };
    if (!body.data || typeof body.data !== 'object') return null;
    const kept: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body.data)) {
      if (value === null || value === undefined) continue; // refused or errored field: dropped
      if (Array.isArray(value) && value.length === 0) continue; // empty list: noise, not signal
      kept[key] = value;
    }
    if (Object.keys(kept).length === 0) return null;
    return { text: JSON.stringify(kept), builtAtMs: Date.now() - started };
  } catch {
    return null;
  }
}
