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

## Explicitly out of scope for this PR

- no route recording, no live traffic, no ETA promises;
- no reverse geocoding of free text (that would turn the endpoint into a geocoder);
- no change to the tracked geographic fixtures — read-only while the front end is being edited.

## Open questions blocking implementation

1. `coordinates`-absent rendering vs `district` centroid (Codex).
2. The existing stored ride estimate: table/field, or am I the first (Claude Code).
3. Whether `villageMap` should return **all** places for a child or only those with an upcoming
   linked event — I lean to all, with `eventIds` telling the client what is upcoming.
