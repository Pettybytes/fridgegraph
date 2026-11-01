# Village map — backend contract (proposal for #76)

Written 2026-11-01 against verified `origin/main` `8fbd230`. **Nothing below is implemented yet.**
This is the agreement I need from Codex (web) and Claude Code (front end / photo wiring) before the
migrations allocate 0056+.

## What the backend will provide

| call | shape | gated by |
|---|---|---|
| `villageMap(childId)` | `GeoJSON.FeatureCollection` + `places[]` with `{id, kind, label, coordinates?, eventIds[], lastSeenAt?}` | caller must see the child |
| `routeEstimate({fromPlaceId, toPlaceId})` | `{distanceMeters, durationSeconds, source:'openrouteservice', cached:boolean, disclaimer:'Estimated — not live traffic'}` | caller must see both places |
| `rideCostEstimate({fromPlaceId, toPlaceId})` | `{distanceMiles, costUsd, rateUsdPerMile, basis:'road_distance', disclaimer}` | same |
| `placeCreate / placeUpdate / placeDelete` | curated `kind` + `label`; coordinates supplied only with `address.read` | `address.read` for coordinates |

**Id-based only.** The client never sends coordinates on the route or cost calls — it sends place
ids, and the server resolves coordinates from its own rows. That keeps the proxy from becoming an
arbitrary geocoder or an open routing service for the browser.

## `address.read` — the gating rule

Seed: **Kendra yes**, **Andre yes**, **Loretta per policy**, **Priya no**. The rows I seed will be
reported explicitly in the PR (who got what, from which policy) rather than asserted in prose.

Without `address.read`:

- coordinates are **omitted** from the payload, not rounded — a rounded coordinate near a school is
  still a location, and "blurred but present" invites the client to treat it as data;
- the place still appears with `kind` + `label` + `eventIds`, because "there is a pickup at the
  sports field" is the map's whole point and reveals no address;
- `routeEstimate` / `rideCostEstimate` still work — they take ids, and the distance is a property of
  the places, not of the caller's right to see them.

**Question for Codex:** does `MapCanvas` render fine with `coordinates` absent (label-only pins), or
do you need a coarse district centroid? I can supply `district` as a neutral fallback if you need
something to place — tell me which and I'll add it to the contract.

## ORS proxy

- server-side only; the key never reaches the browser and is never returned;
- one route per (from,to) pair, cached by a stable key of the two place ids **and the coordinates
  they resolved to**, so a place moving invalidates its own cache entry;
- per-caller rate limit, on top of the endpoint's own;
- **fail closed**: no key, non-200, or an empty route → an explicit `ROUTE_UNAVAILABLE` result. No
  straight-line fallback, no silent estimate, nothing that looks like a measurement when it isn't;
- geometry arrives as an **encoded polyline** and is decoded server-side into GeoJSON before the
  client sees it — the front end never gets an encoded string it must decode itself.

## Ride cost

Derived from the **same stored road distance** used elsewhere — one number, one basis, so the map,
the estimate and the ledger cannot disagree. The rate is configuration, not a constant buried in the
resolver, and the disclaimer travels with the number.

**Question for Claude Code:** is there an existing stored estimate I must reuse rather than adding a
second one? If so, name the table/field and I will read it instead of writing a parallel value.

## Calendar linkage

A place may be attached to a calendar event (drop-off, pickup, practice). The linkage is
`place_id` on the event relation, resolved to the same `places[]` row — the map never invents a
venue from an event title.

### Implemented shape (2026-11-01, migration 0061 — STAGED, NOT APPLIED)

`events.place_id` → `recorded_places(id)`, nullable, FK. NULL means **not linked**; the free-text
`location` column is never parsed and a venue is never inferred from a title. A trigger
(`events_place_guard`) rejects a link to another household's place at write time (`42501`), so a
bad link cannot be created and then quietly filtered.

Read accessor — called through the authorized surface with the **caller's own bearer**:

```
event_day_places(p_child text, p_day date) → (
  event_id text, title text, start_at timestamp,
  state text,            -- 'unlinked' | 'withheld' | 'linked'
  place_id text,         -- populated only when state='linked'
  place_label text       -- populated only when state='linked'
)
```

- **Authority:** `is_parent_of(p_child)` or `has_scope(p_child,'schedule.read')`. No schedule
  authority → zero rows, not an error, so an unrelated caller learns nothing.
- **Labels:** returned to any schedule reader. `address.read` is **not** required for a label — lacking
  it must not hide a label the caller is otherwise entitled to see (Priya keeps her label-only view).
- **No coordinates.** The reader has no coordinate fields at all; positions stay behind
  `place_route_geometry_for` (0058). A schedule reader gets the card, never a position.
- **Three states** so "no place", "a place you may not read" and "a place you may read" are never
  confused.

Remaining for this section: exposing the accessor through the graph/API surface named above,
populating `DayPlan.placeId/placeName` from it, and verified event-id → place-id seed mappings.

## Explicitly out of scope for this PR

- no route recording, no live traffic, no ETA promises;
- no reverse geocoding of free text (that would turn the endpoint into a geocoder);
- no change to the tracked geographic fixtures — read-only while the front end is being edited.

## Open questions blocking implementation

1. `coordinates`-absent rendering vs `district` centroid (Codex).
2. The existing stored ride estimate: table/field, or am I the first (Claude Code).
3. Whether `villageMap` should return **all** places for a child or only those with an upcoming
   linked event — I lean to all, with `eventIds` telling the client what is upcoming.

---

# SETTLED — 2026-11-01, all four questions answered

The proposal above stands as written except where this section overrides it. These are decisions, not
options; implementation follows them.

## 1. Withheld coordinates: authorized labels/cards only

A caller without `address.read` gets **no map pin, no district centroid, no approximate location, no
route, and no coordinate-derived camera positioning.** There is no "blurred but present" path.

What such a caller *does* get:

- the person appears **at their current event's place** when they have one and that place is public —
  public places carry coordinates, so this is not a leak;
- otherwise they appear in the **People list only**, with their **area label**;
- every authorized place still appears as a label/card with `eventIds`.

`district` is therefore **not needed** and will not be added. Codex: plan for label-only rendering;
there is nothing to position.

## 2. Inclusion rule: ALL authorized places

`villageMap(childId)` returns **every place the caller is authorized to see for that child**, with
`eventIds` marking linked events. **"Upcoming" is a filter the client may apply, never the backend's
inclusion rule.**

## 3. The stored ride estimate exists — confirmed read-only, then reused

Verified against the database catalog, not assumed:

| object | fact |
|---|---|
| `candidate_evaluations.estimated_ride_cost_usd` | `numeric` |
| `candidate_evaluations.distance_miles` | `numeric` |
| `candidate_evaluations.cost_basis` | `text` |
| `candidate_evaluations.cost_calculated_at` | `timestamptz` |
| `_rank_and_advance` | writes all four; body references `haversine` |
| also present | `estimate_ride_cost_usd`, `_evaluate_candidates`, `pickup_candidates_for` |

**There will be no parallel store.** The existing path is extended so that when a routed **road**
distance is available it is used, and `cost_basis` records which one applied (`road` vs
`haversine`). The haversine fallback is kept, never removed, and every written row states its basis.
**The 0020 approval rule is unchanged** — this changes the number's provenance, never the cap
decision.

## 4. Authorization, in the backend

- **Both** requested place ids are checked against the selected child **and** the caller before any
  geometry, distance, duration or cost is returned.
- **Cache hits are authorized identically.** A cached route is never served to a caller who could
  not have requested it — the cache key is not a capability.
- Coordinates are **omitted before anything leaves the server**, not filtered by the client.

## Remaining scope for this branch

0056+ places with gated coordinates and the `address.read` seed (exact grant rows reported from the
database), calendar linkage, the id-based ORS proxy (server-side polyline decode, cache, per-caller
rate limit, fail closed `ROUTE_UNAVAILABLE`, `Estimated — not live traffic`), road-distance ride cost
through the existing `candidate_evaluations` path, and the proof suite (per-persona grants, Priya
refused, guide read-only, cache-hit authorization, key never exposed, ride cost on road distance with
the cap decision matching the displayed estimate, reset restores everything).

---

## OPEN DEFECT in the 0056 draft — found before it was committed

The draft `0056_village_places_coordinates.sql` is **not committed and must not be applied as written.**

**The gate does not tie the place to the child's household.** `place_geometry_for(p_child, p_place)`
derives `may_see` from the caller's relationship to `p_child` only, and never checks that `p_place`
belongs to `p_child`'s household. Measured with real claims, rolled back:

| caller | `current_person()` | place in Nora's household | place in **Malik's** household |
|---|---|---|---|
| `p_priya` (has grants on `p_nora`) | `p_priya` | `Lincoln Elementary School`, lat masked | **`Maple Grove Park` — served**, lat masked |

So a caller with any grant on the child is served **another family's place row**. Because coordinates
are masked for anyone without `address.read`, the leak is the label today — but the same defect would
hand out that family's **coordinates** to an `address.read` holder. This is the cross-family class
already fixed for alerts in 0053 (a place from another family must answer exactly like one that does
not exist), and the fix belongs in `place_geometry_for`: resolve the place's household, and require it
to be one of the child's households — refusing with the same answer as a missing place.

**Second finding — my harness was wrong, not the product.** `p_kendra` resolved `current_person()` to
**null** in this run, so her result was `none`, not "coordinates withheld". `data/identity-map.json`
appears to lack a subject for her (Priya resolved fine). Consequence: **the parent/`address.read`
coordinate path is UNPROVEN** — it has never been demonstrated, and it must not be described as
working until a harness that actually resolves every persona shows coordinates returned for Kendra
and Andre and absent for Loretta without `address.read`.

### RESOLVED — same day, with evidence

The defect above was fixed **before** 0056 was committed. `place_geometry_for` now requires the place's
household to be one of the **child's** households, so a place from another family answers exactly like
one that does not exist.

The harness bug was mine, not the product's: the identity map uses person ids (`p_mom`, `p_dad`,
`p_gma`, `p_priya`, …) and **"Kendra" is persona `p_mom`** — `p_kendra` never existed. With correct
subjects, `ops/0056-dry-run.mjs` (rolled back) gives **5/5**:

| caller | own-family place | another family's place |
|---|---|---|
| `p_mom` (Kendra, parent) | `Lincoln Elementary School`, **lat 42.331400** | **no row** |
| `p_priya` (grants, no `address.read`) | `Lincoln Elementary School`, **lat null** | **no row** |
| `p_dana` (unrelated) | **no row** | not asked |

So the coordinate path is now demonstrably open to a parent and closed to a grant-holder, which is the
shape the settled decision asked for. The migration is dry-run clean but **still unapplied** — applying
it belongs to a reserved window.

---

# IMPLEMENTED — 2026-11-01 (piece 1 of 5)

Migration **0058** is forward-only: 0056 and 0057 are applied and the live database is ahead of
`main`, so they are never edited again.

## `POST /api/village/route` (served on 4008)

```jsonc
// request — PLACE IDS only, never coordinates
{ "childId": "p_nora", "fromPlaceId": "rp_…", "toPlaceId": "rp_…" }

// 200
{ "distanceMeters": 14420, "durationSeconds": 1277,
  "geometry": { "type": "LineString", "coordinates": [[-83.134, 42.289], …] },
  "source": "openrouteservice", "cached": false, "disclaimer": "Estimated — not live traffic" }
```

| status | error | meaning |
|---|---|---|
| 401 | `UNAUTHENTICATED` | no/!valid bearer |
| 429 | `RATE_LIMITED` | per-caller routing limit |
| 400 | `INVALID_REQUEST` | missing id |
| **404** | `NOT_FOUND` | place missing **or** not this child's — same answer, no oracle |
| **403** | `COORDINATES_WITHHELD` | caller may see the place, not locate it |
| **409** | `GEOMETRY_UNAVAILABLE` | caller may locate it, but no coordinates recorded |
| **503** | `ROUTE_UNAVAILABLE` | no key / non-200 / empty route — **never** a straight-line fallback |

**Authorization runs before the cache is read.** The cache key is the two place ids *and* the
coordinates they resolved to, so moving a place invalidates its own entry, and a caller who cannot
route is never served someone else's cached route. Geometry is an encoded polyline decoded
**server-side** into GeoJSON. The ORS key is server-side only — never logged, never returned.

## Still to build (pieces 2–5)

2. **Road-distance ride cost** through `_rank_and_advance` / `candidate_evaluations`, `cost_basis`
   recording `road` vs `haversine`, `ROUTE_UNAVAILABLE` never presented as a road result, 0020 cap
   path untouched, one stored number everywhere.
3. **Calendar linkage** — "where people are EXPECTED, by day", schedule-derived only, worded as
   scheduled, never presence or availability.
4. **Proof suite through the served endpoints**, with a role/person preflight that aborts on a null
   `current_person()` or an owner connection instead of recording meaningless results — the exact
   failure mode that bit me twice in this branch.
5. Final contract/PR pass and the HANDOFF note.
