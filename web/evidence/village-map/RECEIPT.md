# Village Map — review receipt

Base: `238f719fd4e0a4fec522e76a54a9542a32ebba3c`.
Branch/worktree: `feat/web-village-map`, `fridgegraph-village-map`.
Final UI source: `6ee70d8` (the last change separates 44px sheet controls from day tabs).
Dev app: 127.0.0.1:5197, explicit dev mock authentication. No shared-stack request, reset,
seed, restart, mutation or real outreach. No live session tokens were used. Public OpenFreeMap
vector tiles are the only remote map dependency exercised.

## Review artifacts

- `review-desktop-light.png`, `review-desktop-dark.png`: 1440×900.
- `review-mobile-light.png`, `review-mobile-dark.png`: 390×844.
- `phoneframe-verified.png`: real PhoneFrame containing the app iframe; controls clear day tabs
  (day top 793px, control bottom 790px after settling).
- `priya-refusal.png`: Kendra → Priya, no previous persona's map details and a route refusal.
- `review-cinematic-20s.mp4`: exactly 20 seconds, trimmed from the viewport-only
  `cinematic-05.webm` (unmodified original retained). Actions completed in 20,020 ms.
- `interaction-04.webm`: viewport-only desktop → phone interaction run. The phone segment is
  letterboxed in the fixed desktop recording frame. Selection sync, manual pan stopping follow,
  three sheet positions, keyboard scrubbing and Rosina Show on map all passed.

The final capture source was unchanged throughout the runs. The sheet CSS fix was already applied
before cinematic-05 began; its commit completed during that run without source edits or HMR.
The captured source matches 6ee70d8. Final screenshots were taken after that commit.
Earlier recordings/screenshots remain unchanged; `review-history.md` records failed gates and
superseded coordinate behavior. They are not final acceptance evidence.

## Actual checks

- Full web suite: **328 tests / 56 files PASS**.
- Map suite: **16 tests / 4 files PASS**, including withheld-coordinate restricted rendering,
  no area-centroid positioning, authorization, drag/request-only behavior, stored ride amount/basis,
  explicit over-cap approval, driver no-cost, single replay clock, no completion/history writes,
  stable refetch camera, fallback and dynamic reduced motion.
- Root typecheck PASS; web typecheck/build PASS; root secret scan **0 findings**.
- Browser cinematic: day → actual HTML drag → route → Walk → review stored estimate/cap →
  explicit parent confirmation → Today mini-map → expand → replay → arrived-near-school PASS.
- Browser interaction: selection reaches list/map/Rosina; pan stops follow; all three phone sheet
  positions; scrub; Show on map closes the phone drawer PASS.
- Kendra → Priya: prior map/private records cleared; no home records; route refused PASS.
- Reduced-motion preference switched both directions in an existing approved workflow: static
  route and disabled animated replay PASS. The earlier actionable replay failure was fixed with
  a live media-query subscription; it was not waived.
- PhoneFrame and iframe layout checked. No reference screenshot or third-party TREK asset ships.

Browser runs had zero application errors. OpenFreeMap's upstream style emitted null numeric road
shield filter warnings and one missing wood-pattern sprite warning across theme switches. These
remain upstream warnings; tiles, markers and routes rendered. The initial PhoneFrame harness had
a favicon 404, corrected with a local empty favicon. Build retains the bundle-size warning;
MapLibre is lazy-loaded. jsdom reports its missing canvas implementation in unrelated full-app
mounts; assertions passed, and real canvas rendering was separately exercised in Chromium.

## Boundaries / remaining integration

UI: complete on mocks. Backend: PR #78 pending. Integrated + tested: mock browser PASS, live
PENDING; the overall live workstream is not DONE. Withheld coordinates produce labels/cards only,
never a pin, centroid, route or coordinate-derived camera. Public event places require an explicit
person/place association. Unsupported mock personas refuse; nobody is substituted.

The fixture covers Nov 2–6, 2026. Locations, geometry, distances and duration/cost values are
explicitly synthetic, not ORS measurements or GPS. The paid-ride cost is supplied as a stored mock
value, with its basis and cap; the browser performs no pricing calculation. Sample approval is
local and never assigns, contacts or writes a real pickup. The same shared store feeds both
mini-maps. The sample calendar is labeled separately from live calendar data and projects only
child-participating events; an adult's current public event is not a child's commitment.

Wire details still needed from Bentley: mode discriminator, returned GeoJSON property,
person-to-origin-place association, child association/refusal shapes, and household-cap/stored
candidate-evaluation linkage. See PR #78 coordination comment. The settled backend contract keeps
road vs haversine provenance explicit; there is no parallel cost store or guessed live endpoint.

## Final portrait-cluster review — supersedes earlier final visual artifacts

UI source `c36796a`: overlapping person/place markers retain the person's portrait with a count
badge and the accessible colocated-record menu. The simulated moving portrait stays above the
stationary endpoint cluster. No authorization or route/cost behavior changed.

Final screenshots: `portrait-desktop-light.png`, `portrait-desktop-dark.png` (1440×900),
`portrait-mobile-light.png`, `portrait-mobile-dark.png` (390×844).
Final recordings: `portrait-cinematic-20s.mp4` (20-second trim; original `cinematic-06.webm` retained),
`interaction-05.webm`. Cinematic actions passed in 20,004 ms; all interaction assertions passed.
Source was committed and frozen before both runs, with no UI edits/HMR. Browser errors: zero;
the same upstream style warnings remain. Full web suite rerun: 328/56 PASS; targeted 16/4 PASS;
web typecheck/build and secret scan PASS. Reviewed the rendered portrait composition after capture.

Bentley's subsequent 0056 dry-run showed Priya's own-family school coordinates withheld. The
settled prose's public-event exception needs reconciliation in the final contract. The frontend
supports complete withholding without any coordinate fallback; the clarification is recorded at
https://github.com/Pettybytes/fridgegraph/pull/78#issuecomment-6563607006 . No live integration or
public-place grant is inferred from the mock.
