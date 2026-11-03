# Village adapter integration receipt

Baseline main: `f8dd86baef6e3ff7455154434bfcc2d4dd8ee276`.
Contract commit: `ad188f2adaeb97b6bee6bda7ac395052e49822ab` (frontend-data.md §3).
Branch: `feat/web-village-adapter`. Exact final head is recorded in the draft PR.

`FrontendAdapter.readVillage(scope)` returns the approved mock's eight nodes and seven edges.
Both child and village scope must match the demo scope. Projection copies only explicit graph
fields, including nested person, household and relationship objects, so no addresses,
coordinates or contact values are returned. Each read returns independent objects.

The shared Apollo hook accepts `useSurfaceData<VillageData>('village')` and routes to that
adapter method with the contract's 30-second poll interval. No server aggregate is introduced.
No changes to the other surfaces' polling intervals.

## Dependency

`web/src/features/village/index.ts` does not exist on baseline main. Per Bryan's instruction,
App and the existing village route slot are unchanged. Once Hermes exports LivingVillage,
App can import it and pass `slots={{ village: <LivingVillage /> }}`. No village-owned files
were created or modified. This PR does not implement the graph visualization.

## Validation

- Baseline: 15 tests passed; root typecheck, secret scan and web build passed.
- New projection tests were run before implementation: five failures for missing readVillage
  and projectVillage. After implementation: **21 tests passed across five files**.
- Tests cover exact mock projection, both scope mismatches, stripping injected private fields,
  independent snapshots, and 30-second polling through the injected adapter.
- Root typecheck, secret scan and web build passed; final scan repeats with new files staged.
- Playwright CLI browser check: eight nodes, seven edges, wrong village rejected, private fields
  absent, retained route slot visible, no horizontal overflow at 390px.
- Browser console: zero errors and warnings. [Machine result](browser-result.json).

## Interaction steps

1. Open the app and select Living Village from Mission Control.
2. Check the retained route slot at [1440px](desktop-1440.png).
3. Resize to 390px and check the [mobile slot](mobile-390.png).
4. In the same browser, invoke the actual mock adapter and verify graph counts, scope and privacy.

Reproduce with the local Vite server on port 4181, then from the repository root:
`browser automation run-code --filename=web/evidence/village-adapter/verify-browser.js`.
No credentials, live graph calls, schema changes, database actions, merge or deploy.

## Handoff packet

BRANCH: feat/web-village-adapter
WORKTREE: /Users/user/orca/workspaces/fridgegraph/fridgegraph-village-adapter
TASK: Provide the scoped sanitized village read for Hermes to integrate.
LAYER: frontend
TOUCHED: web/src/lib/frontendData/types.ts, mockAdapter.ts, provider.tsx,
villageAdapter.test.ts, villageProvider.test.tsx; web/evidence/village-adapter/**.
DONE WHEN: npm run typecheck; npm run check; npm --prefix web test (21 tests);
npm --prefix web run build; browser village route and adapter verification.
NOT DOING: village UI, contracts, server/schema/DB, merges or deployment.
BLOCKERS: LivingVillage export absent on main; retain the slot until Hermes exports it.
