# Village map review history — append-only

## Initial implementation / public tile loading

The first browser render found a MapLibre worker URL failure. The bundler now imports the packaged
worker URL explicitly. The public OpenFreeMap vector map subsequently rendered. No shared backend
was contacted; the dev server uses the explicit mock-auth flag.

## UI 72560f2 — cinematic-01

The interaction sequence completed, including disabled over-limit approval before the checkbox,
explicit approval, mini-map expansion and simulated arrival. Browser console reported:
`Transition was aborted because of timeout in DOM update. DOM update timed out`.
The recording remains unchanged. The expansion callback had awaited animation frames while the
view transition held rendering. It was replaced with a synchronous React route update.

## UI a04bad3 — cinematic-02 / interaction-01

Cinematic actions passed in 20,004 ms, with zero browser errors. The CLI's default recording size
was too small for final review. Original recording preserved. Interaction-01 failed waiting for
`Follow route` after manual input during a transition. A direct drag-start hook was added.

## UI b318640 — cinematic-03 / interaction-02

Cinematic actions passed in 20,007 ms at 1440×900, with zero browser errors. Manual pan after the
camera settled passed independently, but interaction-02 again failed while Show on map was opening
a redundant same-route view transition. Same-route Show on map now skips that transition. The
recording remains unchanged. `cinematic-20s.mp4` is a 20-second trim of cinematic-03, not final
coordinate-policy evidence.

## Coordinate decision

Bryan subsequently prohibited coarse-area pins and substitute coordinates. Earlier screenshots and
recordings above predate that correction and are historical only. The frontend read the settled
PR #78 contract at 3b3cc65 and coordinated the remaining wire details in its PR comment. Final
captures must use UI 55c99a5 or later: list-only area labels, explicit restricted state, and a
public-event origin explicitly recorded in the fictional fixture for Loretta.

## UI 55c99a5 — successful contract-aligned captures and motion follow-up

Cinematic-04 passed in 20,006 ms; interaction-03 passed selection/marker/context sync, pan cancellation,
all sheet positions, scrub and drawer dismissal. The later reduced-motion preference-change check
failed (`Reduced motion replay is actionable`); matchMedia was true but the mounted UI still enabled
replay. Replaced the map's hook with a live subscription and stopped an active clock on preference
change. The first unit rerun then exposed a missing-matchMedia fallback (2 failures); implemented a
static fallback without weakening assertions. The map suite subsequently passed 16/16. Browser
preference changes in both directions passed on the existing workflow after setup was restored.
One intermediate browser rerun timed out because HMR had cleared the approved-route setup; no pass
was claimed from that run.

## UI a22b4f3 / 6ee70d8 — sheet and final review

PhoneFrame review exposed the 44px controls extending beyond a 30px handle. Increased the handle
space to 50px, retaining the target size. A dev-harness reload cleared its mock session, so an initial
recheck timed out before setup was restored. A subsequent sequential bounding-box check during the
sheet transition reported overlap; the unchanged check after settling passed (day top 793, control
bottom 790). Original screenshot remains; phoneframe-verified.png is the settled final view.
Cinematic-05 passed in 20,020 ms; interaction-04 passed all assertions. Final screenshots use the
review-* names. No source edits/HMR occurred during these captures.
