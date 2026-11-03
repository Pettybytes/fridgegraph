# Fridge UX — offline proof

Base: 5aeec2dbbd50f9de0d149568afd7e720fe9827cc (fetched main, includes #168).
Branch/worktree: feat/fridge-zoom-create / fridgegraph-fridge-zoom-create.
UI: 898a1f0e67cbf824d6e93750f456e6ecc29da6e1.
Own preview: 5243. Mock sessions and adapters only; zero backend requests. No deployment, live calls, HANDOFF, backend, dependency or permission changes.

## Behavior

The fridge occupies 88% of its desktop content column, preserving the photograph's aspect ratio; phone width stays within the page. One normalized transform contains the photograph, paper, whiteboard and hit targets.

First tap zooms 2.5× around that point; the next opens the item. Pointer dragging pans; pinch, focused wheel/trackpad and keyboard controls zoom within 1–4×. Door buttons fit their measured regions. Double-click, Escape and Reset return to overview. Controls stay reachable while scrolling. Reduced motion disables transitions. Focus reveals clipped targets by moving the shared camera, not by separately scrolling the scene. Resize keeps normalized coordinates. The 2336px source is requested while zoomed.

Arrange items explicitly enables geometry-only dragging and Alt+arrow movement for photos, notes and stored papers. Normal dragging pans and cannot open an item. Stored papers keep confirmed record content separate from layout. Persona/child changes clear camera, pending opens, dialogs and editing state.

+ Sticky note uses the existing notes editor; initial save is PARENTS_ONLY. Share remains a distinct confirmed audience mutation. Write on the whiteboard reuses GoalForm inline on desktop and the existing full-size editor on phone. Period is explicit, horizon remains verbatim, and completion remains separate from approval. Existing edit/remove/failure coverage remains.

Editing still requires the verified rollout flag, compatible backend and parent/guardian authority. Production editing defaults off. Photo/paper intake has its own unavailable state: no upload, extraction or successful pin is claimed. Its readiness is not inferred from schema compatibility or deployed components.

## Evidence

- web-tests.txt: 564/564 tests, 92 files, one worker.
- Focused fridge suite: 70/70, including point invariance/clamps, tap vs drag, pan vs Arrange, touch-pointer pinch, focused wheel/keyboard/reset, stored-paper geometry, separate readiness gates, inline confirmed goals, own-hash race regression, existing note confirmation/failure/context protections.
- Web build/typecheck, root typecheck and secret scan pass.
- browser-flow.txt: desktop 1440×900 and phone 390×844 mouse/keyboard flows; post and inline/full-size goal creation, independent unavailable intake, reduced motion and resize; zero backend requests.
- overview, posted, posted-dark and goal-entry captures at both widths. All are visibly mock.
- zoom-flow-final.webm: 13.6-second fixed 1280×720 recording, reviewed after capture. First object tap zooms, second opens; pan, zoom controls, Arrange and Reset. zoom-flow.webm preserves the initial capture with a viewport-size artifact; use the final file.
- initial-phone-layout-failure.txt and initial-hash-race-failure.txt preserve browser failures corrected in the implementation. Former door-view font minimums were being scaled twice and covered the create control; browser focus separately scrolled the scene. Font sizing now scales once and the viewport clips without independent scroll. Own hash notifications no longer override a newer zoom gesture.
- Existing test setup now includes the required first zoom tap / explicit Arrange step. Dialog, privacy, source-read, sample, storage and failure assertions are retained. The read-only test explicitly excludes goal creation while the separately tested intake button is disabled.
- Preview entry stays outside the production build. Build retains existing bundle-size warnings. Preview favicon 404 is unrelated to product behavior.

## Remaining rollout limits

All editing evidence is mocked. Migration 0083 and the compatible backend must be deployed and verified before enabling production editing. Private photo/paper intake remains unavailable until its full authorized upload-to-retrieval pipeline is implemented and verified.

Native Chromium touch verification: touch-receipt.txt records a two-finger pinch from 1× to 2.4286× with browser page scale still 1×, no phone horizontal overflow, and a single-finger overview swipe scrolling the app's actual ancestor scroll container. The harness resets a previous browser page-scale setting before the pinch and measures the app container rather than window.scrollY. Capture controls remain operable after pinch.
