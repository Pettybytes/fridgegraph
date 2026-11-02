# Village map adapter preparation

Base: 376d662274887498a4f357639f29c7dfb6808000.
Branch/worktree: feat/web-map-live-adapter / fridgegraph-map-live.
Backend reference: feat/village-map-backend at 10bc43a,
docs/handoff/VILLAGE-MAP-CONTRACT.md, IMPLEMENTED piece 1.
This is preparation, not a live-integration claim. Runtime still constructs createMockMapAdapter.

## Implemented frontend pieces

- Exact documented POST /api/village/route on the existing 4008 server, through a new
  /api/village Vite proxy. Sends childId/fromPlaceId/toPlaceId only; current session bearer,
  no ORS calls or credentials in the browser, no automatic retry.
- Drive selects driving-car. Walk selects foot-walking; Bike selects cycling-regular.
  The current delivered transport supports driving-car ONLY. Walk/Bike report
  “This travel mode is not supported yet.” and make no HTTP request. Do not add a guessed
  profile property to the request or label a Drive response as Walk.
- Per-profile/session/child/origin/destination in-flight cache entries; no completed browser
  result cache bypassing server authorization. Server cache must also become profile-aware
  when Bentley adds modes. Controlled transport tests exercise all three profiles.
- Pending mode-switch race fixed: cancel/revise the old request and clear its geometry/ETA.
  Late results never appear under the new mode. Disposal aborts and clears private state;
  generation/child guards reject late world and route results.
- IDs and returned names remain unchanged; no name-to-ID fixture matching. Withheld origin/
  destination points produce labels only, no request, pin, centroid or fallback geometry.
- Live/map labels depend on actual world/route provenance. The current runtime stays mock
  and keeps Sample data. A supplied mock world cannot be promoted by the live adapter.
- Read-only preparation: canApprove is false for live worlds, proposals disabled, no
  assignment/approval/contact endpoint invented. Ride estimate is null pending the actual
  stored cost response, never a browser price calculation or sample value.

## Required before wiring and live acceptance

1. Final villageMap transport: HTTP/GraphQL operation, exact FeatureCollection/person
   properties, current-event place ID, address.read representation, event linkage,
   child scope and empty/refusal/upstream contracts. The readWorld callback is an internal
   frontend port using existing MapWorld, NOT a claimed wire format. Without it, adapter
   fails WORLD_READ_UNAVAILABLE. Use Apollo for any delivered GraphQL operations.
2. Proxy mode discriminator and response binding, with driving-car / foot-walking /
   cycling-regular supported explicitly; server cache keyed by profile as well as IDs and
   coordinates. Current #78 implementation hardcodes driving-car.
3. Stored candidate-evaluation cost/basis/cap response and person/job association. Display
   the same persisted amount as Mission Control; no synthetic names, distance or prices.
4. Confirm public-current-event coordinate exception against actual authorized responses;
   absent coordinates always remain absent in the browser.
5. #78 merged and Bentley declares endpoints final; then wire provider to current
   session/selected child, and reserve the shared-stack window for real acceptance.

The named fixture school/riverside IDs remain untouched. Backend seeded rp_* IDs are distinct;
even Riverside Park's similar name is not proof of the same record. The live read must supply
its own label. No backend/schema/auth edits, seeds, resets, service switches or live calls.
