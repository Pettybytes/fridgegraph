/**
 * The routing decision, deliberately separated from Express and from the network.
 *
 * The order here is the contract:
 *   1. a lookup failure is not a refusal and not a 404  → 502
 *   2. "cannot see it" and "does not exist" share an answer → 404
 *   3. "may see it, may not locate it" → 403 (withheld)
 *   4. "may locate it, no coordinates recorded" → 409 (absent)
 *   5. BOTH places must be `granted` AND carry finite coordinates before anything routes.
 *
 * Nothing here reads a cache or calls ORS; the caller only reaches `routeBetween` when this returns
 * `ok`. That is what makes "a withheld second place costs zero cache reads and zero ORS calls" a
 * property of the code rather than a hope.
 */

export type GeometryRow = {
  id?: string | null;
  label?: string | null;
  state?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

export type PlaceLookup =
  | { kind: 'error' }
  | { kind: 'notfound' }
  | { kind: 'row'; row: GeometryRow };

export type RouteDecision =
  | { ok: true; from: { lat: number; lng: number }; to: { lat: number; lng: number } }
  | { ok: false; status: number; body: { error: string; place?: string | null } };

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Both places, in order; the first failing one decides the answer. */
export function decideRoute(from: PlaceLookup, to: PlaceLookup): RouteDecision {
  for (const r of [from, to]) {
    if (r.kind === 'error') return { ok: false, status: 502, body: { error: 'LOOKUP_FAILED' } };
    if (r.kind === 'notfound') return { ok: false, status: 404, body: { error: 'NOT_FOUND' } };
  }

  for (const r of [from, to]) {
    const row = (r as { kind: 'row'; row: GeometryRow }).row;
    if (row.state === 'withheld') {
      return { ok: false, status: 403, body: { error: 'COORDINATES_WITHHELD', place: row.label ?? null } };
    }
    // An authorized place with no recorded geometry is its own outcome: not a refusal, not a route.
    // `state` is the accessor's answer; the coordinate check is the belt-and-braces version of it,
    // so a future accessor that mislabels a row still cannot route without numbers.
    if (row.state === 'absent' || !finite(row.latitude) || !finite(row.longitude)) {
      return { ok: false, status: 409, body: { error: 'GEOMETRY_UNAVAILABLE', place: row.label ?? null } };
    }
    if (row.state !== 'granted') {
      // Unknown state from the accessor: fail closed rather than guess it is routable.
      return { ok: false, status: 409, body: { error: 'GEOMETRY_UNAVAILABLE', place: row.label ?? null } };
    }
  }

  const f = (from as { kind: 'row'; row: GeometryRow }).row;
  const t = (to as { kind: 'row'; row: GeometryRow }).row;
  return {
    ok: true,
    from: { lat: f.latitude as number, lng: f.longitude as number },
    to: { lat: t.latitude as number, lng: t.longitude as number },
  };
}
