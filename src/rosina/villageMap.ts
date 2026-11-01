/**
 * Rosina's side of the village map (Bentley owns the backend: people/places by authorization
 * with homes gated by `address.read`, places-by-day from the calendar, an OpenRouteService
 * routing proxy with Drive/Walk/Bike, and a ride-share estimate on road distance vs the
 * household cap). This module is PURE: it shapes those (mocked-until-landed) backend responses
 * into Rosina's answers, and it never computes a distance, ETA or cost itself — it relays the
 * proxy's numbers EXACTLY, so what Rosina says always matches what the map shows.
 *
 * Invariants:
 *  - Route numbers are always "estimated, not live traffic".
 *  - "Closest" is computed only from the authorized home/area/event places the backend returned,
 *    never live location — and the answer says so.
 *  - A ride figure is the stored road-distance estimate with its basis and its comparison to the
 *    household cap — never a provider quote.
 *  - Authorization refusals are uniform: a place/person not shared with the caller yields the
 *    same "not shared with you" answer whether or not it exists (no existence oracle), exactly
 *    as the map behaves for a limited persona.
 *  - A route can be turned into a pickup PROPOSAL for the parent to approve; Rosina prepares,
 *    parents decide. Rosina never assigns, approves or contacts anyone.
 */

export type TravelMode = 'DRIVE' | 'WALK' | 'BIKE';
export type PlaceKind = 'HOME' | 'AREA' | 'EVENT';

/** A refusal the backend returns (or Rosina infers) — reasons collapse to one answer. */
export type MapRefusal = { refused: true; reason: 'NOT_SHARED' | 'UNAUTHORIZED' | 'NO_ROUTE' };
const isRefusal = (x: unknown): x is MapRefusal => typeof x === 'object' && x !== null && (x as { refused?: unknown }).refused === true;

/** OpenRouteService proxy result — relayed verbatim. */
export type RouteEstimate = {
  fromPlaceId: string; fromName: string;
  toPlaceId: string; toName: string;
  mode: TravelMode;
  distanceMeters: number;
  etaSeconds: number;
};

export type NearestEntry = {
  personId: string; personName: string;
  fromPlaceId: string; fromName: string; fromKind: PlaceKind;
  distanceMeters: number; etaSeconds: number;
};
/** People ranked by road distance to a place, from AUTHORIZED places only. */
export type NearestResult = { toPlaceId: string; toName: string; mode: TravelMode; ranked: NearestEntry[] };

export type RideEstimate = {
  fromPlaceId: string; toPlaceId: string;
  roadDistanceMeters: number;
  estimateUsd: number;
  capUsd: number;
  withinCap: boolean;
  basis: string; // e.g. "road distance × $/mile, stored estimate"
};

/**
 * Where an item's place came from — the backend's three states, never collapsed:
 *  'linked'    the event→place linkage is readable, so placeId/placeName are present
 *  'withheld'  a linkage exists but this caller may not read it (the event still renders)
 *  'unlinked'  the event has no place at all
 * None of the three grants coordinates: geometry stays behind 0058's own authorization.
 */
export type DayPlaceState = 'linked' | 'withheld' | 'unlinked';

export type DayPlan = {
  date: string;
  items: {
    eventId: string; title: string; placeId: string | null; placeName: string | null;
    placeState: DayPlaceState; at: string;
  }[];
};

/** The map-focus action attached to every route/place answer. `id` is the place or route to
 * focus; `mode` is the travel mode when it's a route. Shape to confirm with Codex's map. */
export type ShowOnMapAction = { id: 'show-on-map'; args: { id: string; mode?: TravelMode } };
export function showOnMap(id: string, mode?: TravelMode): ShowOnMapAction {
  return mode ? { id: 'show-on-map', args: { id, mode } } : { id: 'show-on-map', args: { id } };
}

/** Every Rosina answer here: human reply, an optional map-focus action, and the EXACT numbers
 * it relayed (so a test can assert they equal the proxy's response byte-for-byte). */
export type MapAnswer<Numbers> = { reply: string; action?: ShowOnMapAction; numbers: Numbers };
const REFUSAL_REPLY = "That isn't shared with you, so I can't show it.";
function refused<N>(): MapAnswer<N> { return { reply: REFUSAL_REPLY, numbers: null as unknown as N }; }

const modeWord: Record<TravelMode, string> = { DRIVE: 'car', WALK: 'walking', BIKE: 'bike' };
const miles = (m: number) => Math.round((m / 1609.344) * 10) / 10;
const mins = (s: number) => Math.round(s / 60);

/** "How long would it take X to get to Y by car?" */
export function routeAnswer(result: RouteEstimate | MapRefusal): MapAnswer<Pick<RouteEstimate, 'distanceMeters' | 'etaSeconds'>> {
  if (isRefusal(result)) return refused();
  const reply = `About ${mins(result.etaSeconds)} min by ${modeWord[result.mode]} (${miles(result.distanceMeters)} mi) from ${result.fromName} to ${result.toName} — estimated, not live traffic.`;
  return { reply, action: showOnMap(result.toPlaceId, result.mode), numbers: { distanceMeters: result.distanceMeters, etaSeconds: result.etaSeconds } };
}

/** "Who's closest to the school right now?" — authorized places only, never live location. */
export function nearestAnswer(result: NearestResult | MapRefusal): MapAnswer<NearestEntry[]> {
  if (isRefusal(result)) return refused();
  if (result.ranked.length === 0) {
    return { reply: `No one's home, area or event places are shared with you near ${result.toName}, so I can't say who's closest.`, action: showOnMap(result.toPlaceId, result.mode), numbers: [] };
  }
  const top = result.ranked[0];
  const list = result.ranked.slice(0, 3).map((e) => `${e.personName} (${miles(e.distanceMeters)} mi from their ${e.fromKind.toLowerCase()})`).join(', ');
  const reply = `Closest to ${result.toName} is ${top.personName}. ${list}. This is based only on the home, area and event places shared with you — not anyone's live location.`;
  return { reply, action: showOnMap(result.toPlaceId, result.mode), numbers: result.ranked };
}

/** "What would a ride cost?" — the stored road-distance estimate vs the cap, never a quote. */
export function rideAnswer(result: RideEstimate | MapRefusal): MapAnswer<Pick<RideEstimate, 'roadDistanceMeters' | 'estimateUsd' | 'capUsd' | 'withinCap'>> {
  if (isRefusal(result)) return refused();
  const vsCap = result.withinCap ? `under your household cap of $${result.capUsd.toFixed(2)}` : `over your household cap of $${result.capUsd.toFixed(2)}`;
  const reply = `An estimated $${result.estimateUsd.toFixed(2)} — ${result.basis} over ${miles(result.roadDistanceMeters)} mi of road, ${vsCap}. It's an estimate, not a quote from any ride provider.`;
  return { reply, action: showOnMap(result.fromPlaceId, 'DRIVE'), numbers: { roadDistanceMeters: result.roadDistanceMeters, estimateUsd: result.estimateUsd, capUsd: result.capUsd, withinCap: result.withinCap } };
}

/** "Where is everyone on Saturday?" — that day's events and their places. */
export function dayAnswer(result: DayPlan | MapRefusal): MapAnswer<DayPlan['items']> {
  if (isRefusal(result)) return refused();
  if (result.items.length === 0) return { reply: `Nothing is on the shared calendar for ${result.date}.`, numbers: [] };
  const lines = result.items.map((i) => `${i.title}${i.placeName ? ` at ${i.placeName}` : ''}`).join('; ');
  const firstPlace = result.items.find((i) => i.placeId);
  const answer: MapAnswer<DayPlan['items']> = { reply: `On ${result.date}: ${lines}.`, numbers: result.items };
  if (firstPlace?.placeId) answer.action = showOnMap(firstPlace.placeId);
  return answer;
}

/**
 * Turn a route into a pickup PROPOSAL the parent must approve. Rosina only prepares the card;
 * the existing pickup rules (parent-only, explicit confirmation, no write on Rosina's part)
 * still decide. Returns the start-pickup action args when the caller is a parent of the child
 * and the route resolved, or a refusal otherwise — never an assignment or a send.
 */
export function pickupProposalFromRoute(input: {
  route: RouteEstimate | MapRefusal;
  isParentOfChild: boolean;
  childId: string;
  date: string;
  window: 'morning' | 'afternoon' | 'evening';
}): { propose: true; action: { id: 'start-pickup'; args: { childId: string; date: string; window: 'morning' | 'afternoon' | 'evening' } } } | { propose: false; reason: 'NOT_PARENT' | 'NO_ROUTE' } {
  if (isRefusal(input.route)) return { propose: false, reason: 'NO_ROUTE' };
  if (!input.isParentOfChild) return { propose: false, reason: 'NOT_PARENT' };
  return { propose: true, action: { id: 'start-pickup', args: { childId: input.childId, date: input.date, window: input.window } } };
}
