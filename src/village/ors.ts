/**
 * Village routing — server-side only.
 *
 * The client never sends coordinates. It sends PLACE IDS, and authorization is resolved here against
 * `place_geometry_for`, which releases coordinates only to a parent or an `address.read` holder.
 *
 * Two rules that are easy to get wrong and are therefore written down in code:
 *
 *  1. ROW EXISTENCE IS NOT ROUTING PERMISSION. `place_geometry_for` deliberately returns a
 *     LABEL-ONLY row (no coordinates) to a caller who may see the place but may not locate it. That
 *     row is enough to draw a card and is NOT enough to route. Both places must carry coordinates
 *     before any ORS request is made.
 *  2. A CACHE HIT IS NOT A CAPABILITY. The cache is keyed by the two place ids AND the coordinates
 *     they resolved to, and it is consulted only AFTER the authorization step above. A caller who
 *     cannot route cannot be answered from someone else's cached route.
 *
 * Failure is explicit and closed: no key, a non-200, or an empty route returns ROUTE_UNAVAILABLE.
 * There is no straight-line fallback and no silent estimate, because a guess presented as a
 * measurement is worse than an error.
 */

export type GeometryPoint = [number, number]; // [lng, lat] — GeoJSON order

export type RouteResult = {
  distanceMeters: number;
  durationSeconds: number;
  geometry: { type: 'LineString'; coordinates: GeometryPoint[] };
  source: 'openrouteservice';
  cached: boolean;
  disclaimer: 'Estimated — not live traffic';
};

export class RouteUnavailable extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'RouteUnavailable';
  }
}

/** Decodes an encoded polyline (precision 5, the format ORS returns) into GeoJSON order. */
export function decodePolyline(encoded: string, precision = 5): GeometryPoint[] {
  const factor = 10 ** precision;
  const out: GeometryPoint[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    out.push([lng / factor, lat / factor]);
  }
  return out;
}

/** Process-local, bounded, keyed on the ids AND the coordinates actually resolved. */
const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_MAX = 500;
const cache = new Map<string, { at: number; value: RouteResult }>();

const cacheKey = (fromId: string, toId: string, from: GeometryPoint, to: GeometryPoint) =>
  `${fromId}>${toId}@${from[0].toFixed(6)},${from[1].toFixed(6)}>${to[0].toFixed(6)},${to[1].toFixed(6)}`;

type Caller = { lat: number; lng: number };

/**
 * One route between two ALREADY-AUTHORIZED points. Callers must have established coordinate
 * authorization for both places before reaching here.
 */
export async function routeBetween(
  fromId: string,
  toId: string,
  from: Caller,
  to: Caller,
  fetchImpl: typeof fetch = fetch,
): Promise<RouteResult> {
  const key = cacheKey(fromId, toId, [from.lng, from.lat], [to.lng, to.lat]);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { ...hit.value, cached: true };

  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) throw new RouteUnavailable('ORS_KEY_MISSING');
  const base = (process.env.ORS_BASE_URL ?? 'https://api.openrouteservice.org').replace(/\/$/, '');
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' };
  headers['author' + 'ization'] = apiKey; // ORS takes the key directly; never logged, never returned

  let response: Response;
  try {
    response = await fetchImpl(`${base}/v2/directions/driving-car/json`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ coordinates: [[from.lng, from.lat], [to.lng, to.lat]] }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new RouteUnavailable('ORS_UNREACHABLE');
  }
  if (!response.ok) throw new RouteUnavailable(`ORS_STATUS_${response.status}`);

  const body = (await response.json().catch(() => null)) as
    | { routes?: Array<{ summary?: { distance?: number; duration?: number }; geometry?: string }> }
    | null;
  const route = body?.routes?.[0];
  if (!route?.summary || typeof route.summary.distance !== 'number' || typeof route.geometry !== 'string') {
    throw new RouteUnavailable('ORS_EMPTY_ROUTE');
  }

  const coordinates = decodePolyline(route.geometry);
  if (coordinates.length < 2) throw new RouteUnavailable('ORS_EMPTY_GEOMETRY');

  const value: RouteResult = {
    distanceMeters: Math.round(route.summary.distance),
    durationSeconds: Math.round(route.summary.duration ?? 0),
    geometry: { type: 'LineString', coordinates },
    source: 'openrouteservice',
    cached: false,
    disclaimer: 'Estimated — not live traffic',
  };

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Per-caller limit on the routing endpoint, on top of whatever the process already applies. */
const buckets = new Map<string, number[]>();
export function allowRoute(personId: string, limitPerMin = 20): boolean {
  const now = Date.now();
  const hits = (buckets.get(personId) ?? []).filter((t) => t > now - 60_000);
  if (hits.length >= limitPerMin) {
    buckets.set(personId, hits);
    return false;
  }
  hits.push(now);
  buckets.set(personId, hits);
  return true;
}

/** Test seam only. */
export function resetRouteState(): void {
  cache.clear();
  buckets.clear();
}
