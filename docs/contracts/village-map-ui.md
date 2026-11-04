# Village Map UI

## Fictional showcase locations

The caller-scoped path includes explicit fictional display homes for the seeded showcase roster. The HOME catalog kind is used only for these fictional display records. Nearby avatars may be separated in screen space for dragging; stored coordinates and route geometry are unchanged. Both the child household sandbox marker and the fixed fictional-person roster constrain seeding. Address authorization still gates coordinates. Dragging requests a route and updates only the current map session; reloading restores the seeded display place. Showcase routes are labeled fictional, derive distance and time from their displayed geometry and mode, and never feed ride pricing. Recorded pickup ride estimates remain separate server reads. Reset restores the fictional places and associations.

## Authenticated perspectives

A session with an access token always uses the live village-world reader for the selected child, regardless of `VITE_VILLAGE_MAP_LIVE`. Every request forwards the caller session and retains the server's child, member, place and coordinate authorization. Missing clients and denied reads fail closed. A child switch cannot substitute Nora's synthetic scenario. Each map lifetime owns its request cancellation, so an earlier unmount cannot cancel a replacement map's reads.

The synthetic adapter described below applies only to sessions without an access token. The following original mock-port notes are historical; the live reader and route proxy are now implemented.

Bryan's P0 brief is the behavior contract. `web/src/features/village-map/types.ts` is an internal
frontend port, **not** a proposed GraphQL schema or a claim that an endpoint exists. Bentley owns
the wire contract: authorized people/places, homes behind address.read, calendar day places,
server-side OpenRouteService routes by Drive/Walk/Bike, stored road-distance ride estimate/cap.
No browser ORS request, key, local price calculation or live-position inference is permitted.

The mock represents a clearly labeled synthetic no-driver night. All geographic points and route
results are fictional display fixtures; they are not seeded addresses or measured routes. The
12.40 estimate and 10.00 cap are stored mock values, not a conversion of the older haversine
record into a road estimate. Drivers receive no ride cost. A Walk ETA never changes that separate
stored paid-ride estimate. Live integration must use the exact delivered wire shape and preserve
refusal vs authorized empty vs upstream error. No speculative live endpoint has been added.

Kendra/Andre have explicit mock home access; Priya/Loretta get bounded event records and
list-only area labels, with no homes. Limited route reads refuse. Unavailable mock perspectives refuse rather than substitute
another family. Production authorization remains entirely server-enforced.

Routing only reads. Proposal approval is explicit and sample-only; the over-cap checkbox cannot
be bypassed. One progress clock drives replay position, elapsed time, remaining ETA and arrival.
Replay writes nothing and never claims pickup completion. Manual camera input stops following;
ordinary reads never increment the camera-fit revision. Private state is disposed on session switch.

Map implementation uses react-map-gl/maplibre. Style URLs and API use were verified against
[OpenFreeMap's quick start](https://openfreemap.org/quick_start/), its
[style repository](https://github.com/hyperknot/openfreemap-styles), and the
[vis.gl marker reference](https://visgl.github.io/react-maplibre/docs/api-reference/marker).
OpenFreeMap/OpenStreetMap attribution remains visible. TREK is visual reference only; no TREK
code/styles/assets/icons/name will ship.

## Unfinished at the initial checkpoint

Required TREK reference folder `~/Desktop/fridgegraph-refs/trek/` is absent. Parent reference
folder exists but contains the prior family-app references and portraits. Asked Bryan for the
correct location. Final visual design, route integration, shared calendar days, mobile sheet,
drag/drop browser acceptance and captures remain pending. No visual completion is claimed.

## Settled coordinate policy — PR #78

Aligned with `docs/handoff/VILLAGE-MAP-CONTRACT.md` on `feat/village-map-backend` at
`3b3cc650ae0f2c4ed7260b802338e3ff61e63afe`. Withheld coordinates mean labels/cards only, never a
centroid, approximate pin, route or coordinate-derived camera. Public current-event places can
position a person through their explicit place association; an area label cannot. A fully withheld
world renders the restricted list instead of constructing a map. Mixed views mark restricted locations.
All authorized places are retained, independent of the selected-day filter.

The synthetic fixture explicitly records Loretta at a public community volunteering event. Andre
and Tasha have area labels only and no coordinates. This is a mock story, not a claim about the seed.
The route/cost port remains internal: live mode, geometry, person-to-place linkage, child association,
cap/evaluation linkage and refusal/empty/failure response shapes await the final backend contract.
Coordination: https://github.com/Pettybytes/fridgegraph/pull/78#issuecomment-6563428562 .

## Reference and integration update

The three supplied TREK screenshots were subsequently inspected in the external reference folder.
No reference image, TREK code, asset or stylesheet is included. The map is integrated into the app,
Today and Mission Control previews, an explicitly labeled sample calendar projection and Rosina
context controls. The sample calendar projects the same event IDs/times/place records; live calendar
records are never overwritten. Public OpenFreeMap tiles are real; routing/approval remain sample-only.
