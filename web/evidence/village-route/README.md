# Village route integration receipt

Baseline main: `3055fbf666d2375f779a9136b5891bd42bd28ad9`.
Contract: frontend-data.md at `21565be8eb0be9552fed38e68e5001badd6bc172`.
Branch: `feat/web-village-route`; final head is in the draft PR.

## App integration

App keeps Mission Control wired and adds the named LivingVillage export from
`@/features/village` with React.lazy and a route-local Suspense boundary. The quiet fallback
is static text with role=status; the shell and other tabs remain available while it loads.
Parent chat remains the existing route placeholder, faithfully captured below.

Production request capture proves no village JS request on Mission Control or Parent chat,
one after opening Living Village, and no additional request on revisit at either width.
The feature implementation and all files under web/src/features/village/ are unchanged.

## Bundle measurements

Each row was actually built in this worktree. Decimal kB; gzip column uses Vite's reported
compression values. Exact raw bytes and independently computed, consistently level-9 gzip
measurements are retained in [bundle-sizes.json](bundle-sizes.json).

| Build | Entry JS raw | Entry JS gzip | Village JS deferred |
| --- | ---: | ---: | ---: |
| Untouched main, village not wired | 506.97 kB | 157.91 kB | absent |
| Eager-wired integration reference | 835.20 kB | 266.59 kB | included in entry |
| Final lazy integration | 509.10 kB | 158.77 kB | 327.55 kB raw / 108.73 kB gzip |

Lazy wiring avoids 326.10 kB of startup entry JS compared with eager integration (39.04%).
The untouched baseline did not ship the village at all, so this is not a claimed reduction
relative to its 506.97 kB entry. The final entry adds 2.13 kB of integration/loading overhead
to that baseline, and downloads the graph chunk only when selected. The existing >500 kB
entry warning remains; the warning threshold was not raised or disabled.

## 390px overlap

The eager-wired [before screenshot](before-overlap-390.png) reproduced the controls covering
the top graph nodes. Before: controls y=363.19 to
444.69; canvas began at y=351.19.
A scoped mobile rule in web/src/app/village-route.css moves those controls into normal flow.
After: controls end at y=456.69 and canvas
begins at the same y=456.69. They cannot overlap the canvas.
Graph physics, camera zoom, node sizes and existing edge clipping/panning behavior are
unchanged; this PR does not claim that every node fits in the initial graph viewport.

## Actual verification

- Unmodified baseline: 52 Vitest tests passed, root typecheck/check/build passed.
- Final: **53 Vitest tests passed in 12 files**.
- Full browser suite: **12 smoke tests passed**, including existing pickup approval/focus tests
  plus route loading, graph search/filtering and mobile bounds at both widths.
- Production Playwright CLI capture: **16 checks passed**, zero page errors,
  console zero errors/warnings, all three tabs at both widths.
- Root typecheck, web build and diff check passed. Staged secret scan: **228 files, zero findings**.
- The new deferred-load test was run red against eager wiring, then green after React.lazy.
- Test harness fix: its hoisted persistent module counter observes eager evaluation before
  the test body; a mock spy did not retain that observation. Expected counts stay zero before
  route selection and one afterward, including a route revisit.

## Screenshots and interaction sequence

| Tab | 1440px desktop | 390px mobile |
| --- | --- | --- |
| Mission Control | [Desktop](mission-control-1440.png) | [Mobile](mission-control-390.png) |
| Parent chat (current placeholder) | [Desktop](parent-chat-1440.png) | [Mobile](parent-chat-390.png) |
| Living Village | [Desktop](living-village-1440.png) | [Mobile](living-village-390.png) |

1. Open Mission Control and verify the pickup card; village chunk remains unloaded.
2. Open Parent chat; village chunk remains unloaded.
3. Open Living Village with its chunk held by the test harness; verify the
   [quiet loading state](village-loading-390.png), then release it.
4. Verify the actual 8-person canvas, search Loretta and filter Parents.
5. Revisit Mission Control and Village and verify the already loaded module is reused.

The existing graph's 2000ms physics cooldown is allowed to settle before graph screenshots.
[Browser measurements](browser-result.json) and [before bounds](before-overlap.json) are saved.
Reproduce against `npm --prefix web run preview -- --host 127.0.0.1 --port 4185 --strictPort`
using Playwright CLI and `web/evidence/village-route/verify-browser.js`.

## Handoff packet

BRANCH: feat/web-village-route
WORKTREE: /Users/user/orca/workspaces/fridgegraph/fridgegraph-village-route
TASK: Review the lazy village route integration and mobile controls separation.
LAYER: frontend
TOUCHED: web/src/App.tsx, web/src/app/VillageRoute.test.tsx,
web/src/app/village-route.css, web/e2e/village-route.smoke.spec.ts,
web/INTEGRATION.md, web/evidence/village-route/**.
DONE WHEN: npm run typecheck; npm run check; npm --prefix web test (53 tests);
npm --prefix web run build; npm --prefix web run test:e2e (12 tests); six tab screenshots.
NOT DOING: village implementation/physics, parent chat feature, backend/schema/DB/contracts,
credentials, merge or deploy.
BLOCKERS: none for route integration. Parent chat feature remains separate work.

## Files changed

- `web/INTEGRATION.md`
- `web/e2e/village-route.smoke.spec.ts`
- `web/evidence/village-route/README.md`
- `web/evidence/village-route/before-overlap-390.png`
- `web/evidence/village-route/before-overlap.json`
- `web/evidence/village-route/browser-result.json`
- `web/evidence/village-route/bundle-sizes.json`
- `web/evidence/village-route/living-village-1440.png`
- `web/evidence/village-route/living-village-390.png`
- `web/evidence/village-route/mission-control-1440.png`
- `web/evidence/village-route/mission-control-390.png`
- `web/evidence/village-route/parent-chat-1440.png`
- `web/evidence/village-route/parent-chat-390.png`
- `web/evidence/village-route/verify-browser.js`
- `web/evidence/village-route/village-loading-390.png`
- `web/src/App.tsx`
- `web/src/app/VillageRoute.test.tsx`
- `web/src/app/village-route.css`
