# Village Map UI — mock port, live wire contract pending

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

Kendra/Andre have explicit mock home access; Priya/Loretta get bounded event/coarse records and
no homes. Limited route reads refuse. Unavailable mock perspectives refuse rather than substitute
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
