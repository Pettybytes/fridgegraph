# Village Map UI report — PR #81

### Village Map P0 — initial checkpoint

Fresh worktree `fridgegraph-village-map`, branch `feat/web-village-map`, fetched-main base
`238f719fd4e0a4fec522e76a54a9542a32ebba3c` (includes #74 and #69; no dependency on parked #68).
UI: in progress · backend: not delivered · integrated: pending. Existing screens, Orbit and shell
have not been restyled. Explicit requested fixture rename: Recorded Park → Riverside Park in
active offline review fixtures/harnesses; historical evidence unchanged.

Internal mock port, authorization views, read-only route requests, explicit proposal/over-cap
acceptance, session disposal and one-clock replay model are implemented; 8 targeted tests PASS.
MapLibre renderer and provider are prepared but not integrated into the app. No live backend
requests, ORS calls, pricing computation, auth or database changes. Contract notes in
`docs/contracts/village-map-ui.md` distinguish the frontend port from Bentley's pending wire API.

Reference dependency: `~/Desktop/fridgegraph-refs/trek/` is missing. Desktop search found only the
older reference folder; sampled screenshots are earlier family-app references, not TREK. Asked
Bryan for the correct screenshot location. Required reference-driven visual pass and final
browser/capture acceptance remain pending; do not mark ready or call this delivered.

Checkpoint verification: all 320 web tests / 53 files PASS; root typecheck and web typecheck/build
PASS (existing chunk-size warning). This verifies the independent mock/state work, not map UI
integration, reference fidelity or the required browser recordings. No ready PR yet.

### Village Map P0 — integrated mock UI review, 2026-11-01

Base remains `238f719fd4e0a4fec522e76a54a9542a32ebba3c`; branch/worktree
`feat/web-village-map` / `fridgegraph-village-map`. Current-main HANDOFF receipts are retained above,
including Bentley's Part A partial release; no shared stack was used by this map task.

UI: complete on mocks · backend: PR #78 pending · integrated + tested: mock browser PASS, live
PENDING. Overall live workstream is NOT DONE. The three supplied TREK screenshots were inspected
externally; none is committed, and no TREK implementation or assets were copied. Existing shared
tokens and original map composition only; no restyling of Orbit, Today, picker or shell.

Map route, day/People planner, mobile sheet, Rosina selection context, Today/Mission Control
mini-maps and the separately labeled sample-calendar projection share one private controller.
Dragging reads a route only. Stored paid-ride estimate/basis/cap and explicit parent over-limit
confirmation precede a local sample approval. One replay clock drives marker/progress/ETA/scrub;
arrival never asserts pickup completion or writes history. Manual drag stops following; refetch
never re-flies the camera. Session cleanup disposes map state. Reduced motion updates an already
open workflow, stopping its animation.

Latest coordinate decision is implemented: withheld coordinates are authorized labels/cards only,
no centroid/approximate pin/route/camera fallback. Public current-event locations require an explicit
place association. Andre/Tasha are list-only area labels; Loretta's synthetic scenario explicitly
records a public community event. Priya sees bounded records and a route refusal; unsupported mock
personas refuse rather than borrowing another family. All values remain labeled sample. No invented
live wire API. Read settled `VILLAGE-MAP-CONTRACT.md` on backend branch at `3b3cc65`; coordinated on
https://github.com/Pettybytes/fridgegraph/pull/78#issuecomment-6563428562 . Awaiting exact mode,
geometry, person/origin-place, selected-child/refusal and stored evaluation/cap transport fields.
Road/haversine provenance must be retained when the real service lands; no parallel pricing store.

Checks: 328 web tests / 56 files PASS; map-specific 16 / 4 PASS; root typecheck and web typecheck/build
PASS; secret scan 0 findings. Controlled browser PASS: drag/modes/confirmation/mini-map/replay,
selection sync, pan, phone sheet, scrub, Rosina Show on map, Kendra→Priya refusal, dynamic reduced
motion and PhoneFrame. No live backend or real-session proof is claimed. Upstream OpenFreeMap style
warnings and bundle-size warning are documented, not hidden.

Final UI source `6ee70d8`; append-only evidence in `web/evidence/village-map/RECEIPT.md`:
review-desktop/mobile light/dark, phoneframe-verified, Priya refusal, review-cinematic-20s.mp4
(20 seconds; original cinematic-05 retained), interaction-04.webm. Failed/superseded review runs
remain in review-history.md. Backend/live integration remains queued against #78, including real
ORS geometry, authoritative grants and the stored road/haversine cost used by Mission Control.

Final portrait-cluster polish: source `c36796a`, full web suite rerun 328/56 PASS, targeted 16/4 PASS,
build/typecheck and secret scan PASS. Cinematic-06 actions passed in 20,004 ms and interaction-05
passed all assertions, with source committed/frozen throughout. Current artifact index:
`web/evidence/village-map/CURRENT.md`. PR #81 is the reviewable mock slice; #78 remains pending.
Public-event coordinate exception vs 0056's Priya school null was explicitly raised on #78;
withheld means no map point regardless, never an inferred public location.
