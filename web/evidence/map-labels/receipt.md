# Mobile map labels — offline proof

Base: 68e8dc7460b9ab6207d9a65cb1f0907038ec58df (#82 and #84 verified merged).
Branch/worktree: fix/web-map-labels / fridgegraph-map-labels. Local mock-auth UI on 5199.
No live backend calls, resets or shared-stack changes. Public OpenFreeMap tiles only.

Before: initial fit at 390 shows adjacent portrait/count badges crowding the school/park.
Zoom-out was also blocked by the instructional hint (Playwright pointer interception).
Preserved before-light-390.png, before-dark-390.png and before-zoom-* (wheel zoom).
After: clustering uses the full portrait/count footprint. Captions occupy non-overlapping
screen-space slots, with selected records first. Crowded captions remain accessible through
the full-name marker, cluster menu and planner; no authorized records are removed.
The menu remains within the map width and scrolls with 44px targets. The hint no longer
intercepts zoom controls and leaves their column clear.

Playwright CLI: 390×844 and 1440×900, light/dark, mock Kendra, focus mode.
after-selected-* shows the selected-school caption and both portrait clusters.
after-zoom-light-390.png shows further zoom out. Selected cluster opened and Maplewood School
selected by its real menu button. Recenter and Zoom out work. Rendered bounding checks at
390 and 1440: 1 label, 2 portrait clusters, 0 label/portrait or label/label intersections.
Check script included; actual DOM bounding boxes, not approximate text measurements.
Visual review: (1) crowding fixed with footprint clustering; (2) caption collisions fixed with
screen-space slots; (3) blocked zoom fixed by the hint's noninteractive, narrower layout.
Existing shell/right-dock composition is outside this small fix and unchanged.

342 web tests / 60 files PASS; focused map tests 18 / 5 files PASS.
Root typecheck PASS; web typecheck/build PASS. Initial build caught a Map import/global Map
name collision (TS2554/TS7009); corrected to globalThis.Map, then build passed.
Source visual review scan: no regex findings, parsed-element checks not run by that scan.
Rendered visual review launches a separate unauthenticated page: flags shared cream palette plus
picker contrast 4.3:1 and a text-wrap advisory. These are existing frozen picker/tokens,
not the authenticated map. No theme override or global waiver applied. Browser checks above
cover the actual map. Labels use the existing surface/ink tokens.

## Geographic identity review (read-only)

Reviewed #78 contract and migrations at origin/feat/village-map-backend 10bc43a.
0053 derives IDs from household + exact label. These are source-defined IDs, not live probes:

| Mock ID / label | Backend record | Conclusion |
| --- | --- | --- |
| school / Maplewood School | rp_cf07653bee9c / Lincoln Elementary School / h_a | Different IDs; no mapping established |
| riverside / Riverside Park | rp_380ea0f0262d / Riverside Park / h_b | Same label does NOT establish identity |
| No matching fixture ID | rp_d68289d2cfb4 / Maple Grove Park / h_a | No substitution |
| No matching fixture ID | rp_0a943b46d18a / Maple Grove Park / h_malik | Different household and ID despite same label |

mockAdapter.ts and all geographic fixtures unchanged. Live adapter must preserve returned
IDs/labels. Proxy mode discriminator, world/person wire shape, calendar linkage and stored
ride-cost response are still pending #78's final contract; no endpoint fields invented here.

Staged secret scan: 833 files, 0 findings. Diff whitespace check PASS.
