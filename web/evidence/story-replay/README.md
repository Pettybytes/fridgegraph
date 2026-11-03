# Three-phone story replay · fixture proof

The preview and export use the local illustrative fixture in `web/src/features/story-replay/story.ts`. Friday, October 30, 2026 is fixed in America/Detroit. These are fictional demonstration states, not authenticated job records. The teacher receives only its notice and prototype pickup-authorization projection. A caregiver offer does not confirm a pickup; Kendra's later action confirms the plan. Physical pickup completion is never shown.

## Rendered captures

- [Desktop, opening beat](desktop.png)
- [Desktop, final hold](desktop-final.png)
- 390px phone: [Parent](phone-parent.png) · [Caregiver](phone-caregiver.png) · [Teacher](phone-teacher.png)
- [Reduced-motion phone](reduced-phone.png)
- [Standalone static export on phone](export-phone.png)
- [One complete loop](complete-loop.webm)

The browser preview was run at 1440 × 900 and 390 × 844 with Playwright CLI. The 390px viewport had no horizontal overflow. Switching Parent → Caregiver → Teacher kept the same progress value. Reduced motion loaded at 100% on the static final frames and did not play automatically. The full-loop fixture proof blocked `/api/`, exact `/graphql`, and `/voice/` requests; the browser resource list showed none. Sound remained visibly unavailable because no approved Loretta audio file was supplied. No waveform or word timing was fabricated.

The standalone Vite export was served from `web/story-replay-export/` through a local static file server. It rendered three phones and made zero API requests. Its 14 files total about 432 KB and include only local WebP art, font subsets, CSS and JavaScript. Source art is Bryan's and provenance is recorded in `web/src/features/story-replay/README.md`.

## Checks and review

- Focused story tests: 9 passed. They cover one clock, distinct offer/confirmation, teacher projection, clip-duration expansion, pause/resume/replay, reduced motion, mobile perspective switching, off-screen pause behavior, and supplied transcript isolation.
- Full web suite: 91 files, 563 tests passed after the missing-browser-API guard was added. The initial full run failed because some existing jsdom tests define `matchMedia` as a nonfunction; this was fixed in the component without changing any test expectation.
- Normal web production build, standalone static build, root typecheck, and secret scan passed. Exact-head GitHub CI must still be checked after the PR push.
- Impeccable source scan found no source patterns after removing the side-border treatment. Rendered scan found no tiny-text or low-contrast issue. Its four remaining findings are the required phone-screen messages nested inside cards and the app's existing paper background token; those are intentional here.
