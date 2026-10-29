# Shell integration receipt

Baseline main: `34973a506571bf71b78f02b1ae19ed30afc8ec14`.
Frontend data contract: `ad188f2adaeb97b6bee6bda7ac395052e49822ab`.
Bryan approved the contract in the task and added `PENDING` (outreach sent, no reply).
The approved wording update uses **Estimated travel cost**, a synthetic $1.40/mile estimate
for every caregiver, including drivers. `OVER_POLICY` reads **Over your travel limit**.
The contract and backend field remains `estimatedRideCostUsd`; only user-facing labels change.
The contract file still labels itself draft. No contract edits in this frontend lane.

## Integration points

- `src/app/Shell.tsx`: hash routes `#/mission-control`, `#/parent-chat`, `#/village`.
  Pass `slots={{ village: <LivingVillage /> }}` to integrate Hermes's component.
  No files under `src/features/village/` are owned or changed here.
- `src/lib/frontendData/types.ts`: screen-facing `FrontendAdapter`, scoped reads and safe projections.
- `src/lib/frontendData/mockAdapter.ts`: mock-only scope and sanitized copies of approved JSON.
  Fixtures do not expose contact values, addresses, coordinates or voice-note URLs.
- `src/lib/frontendData/provider.tsx`: inject adapter + identity-derived scope at the app root.
  Hooks use Apollo `pollInterval: 2500`, paused when hidden. Apollo's local link calls the
  adapter; `LocalFrontendSnapshot` is an internal message, **never a server aggregate query**.
  A future GraphQL adapter must compose the contract's primitive queries with Apollo Client,
  use the signed-in user's Supabase session, and return the same projections.
  It must never forward the local document to the router. Real auth/transport is not wired.
- `reasonLabel('PENDING')`: Waiting for reply. Distinct from Awaiting parent approval.
- `cn` is imported only through `@/lib/utils`.

## Authorization boundary for the GraphQL adapter

The mock adapter's scope check is a demo convenience, **not a security boundary**.
When implementing the GraphQL adapter, `readVillage` must request only the server's
authorized projection, using the signed-in user's identity and the requested child/village
scope. The browser must never receive the full village and filter it locally for access.
Server-side RLS and per-resolver authorization remain the boundary; client sanitizing is
presentation/data-minimization only. Handle UNAUTHENTICATED and UNAUTHORIZED distinctly.

PR #8 is merged as `0f287e7`. Hermes's handoff is now consolidated here:

```ts
readVillage(scope: Scope): Promise<VillageData>
```

- `FrontendAdapter`, `Scope`, and `VillageData`: `web/src/lib/frontendData/types.ts`.
- Mock implementation: `web/src/lib/frontendData/mockAdapter.ts`.
- Read hook: `useSurfaceData<VillageData>('village')`; village polls at 30 seconds.
- Hermes supplies the named React component `LivingVillage` from
  `web/src/features/village/index.ts`.
- App lazily imports the named `LivingVillage` export from `@/features/village` and
  integrates its village slot under a local Suspense boundary; Mission Control stays wired.
- PR #11 provides the village export. This integration changes no village-owned implementation
  files. Production authorization stays on the server as specified above.

## Scope and dependencies

This is the first, deliberately separate shell PR. Feature cards, chat and the integrated
caregiver/approval smoke test follow in separate task worktrees. No live graph, auth or DB probes.
No merge or deployment performed. Real GraphQL integration depends on Bentley's coordination work.

Drift found: frontend.md §5.1 says the shadcn files are misplaced, but baseline already has
`src/components/ui/button.tsx` and `src/lib/utils.ts`. No move is necessary. The prescribed
frontend-only lane prevents correcting docs/contracts in this PR.

## Validation and changed files

Full Vitest suite: 15/15 tests, 3/3 files. Root typecheck and web build passed.
Secret scan is run again after staging so new files are included. Browser verification passed
14 checks with a 2508ms real poll, two adapter reads, and no page errors.
See [screenshots and interaction steps](evidence/shell/README.md).

Changed source/config files:

- `web/package.json`, `web/package-lock.json`
- `web/src/App.tsx`, `web/src/index.css`
- `web/src/app/Shell.tsx`, `web/src/app/Shell.test.tsx`
- `web/src/lib/frontendData/types.ts`, `mockAdapter.ts`, `mock-data.json`, `provider.tsx`,
  `mockAdapter.test.ts`, `provider.test.tsx`
- `web/src/test/setup.ts`, `web/vitest.config.ts`
- `web/INTEGRATION.md` and `web/evidence/shell/**` (screenshots, browser verification and receipt)

The resumed investigation changed only test timing and the explicitly approved travel-cost
projection/copy. No production polling behavior changed. Mission Control and parent chat
feature implementation has not begun. The shell draft PR is the next integration gate.

## Handoff packet

BRANCH: feat/web-mission-control
WORKTREE: /Users/user/orca/workspaces/fridgegraph/web-mission-control
TASK: Integrate the shell and mock adapter as the frontend foundation.
LAYER: frontend
TOUCHED: web/package.json, web/package-lock.json, web/src/App.tsx, web/src/index.css,
web/src/app/**, web/src/lib/frontendData/**, web/src/test/setup.ts,
web/vitest.config.ts, web/INTEGRATION.md, web/evidence/shell/**.
DONE WHEN: npm run typecheck; npm run check; npm --prefix web test; npm --prefix web run build;
Playwright CLI navigation at 1440px and 390px with screenshots.
NOT DOING: live auth, server/schema/DB changes, village implementation, merge or deploy.
BLOCKERS: feature work requires subsequent task worktrees; live integration needs backend fields.

## Mission Control integration after Station 06

Current baseline: main `21565be8eb0be9552fed38e68e5001badd6bc172`, which also owns the
current frontend-data.md contract. Parent chat remains on its separate branch.

Mission Control consumes the injected adapter's candidates, CoordinationJob.overLimitCandidate,
and Confirmation.overLimitApproved. A connected GraphQL adapter must source **every candidate,
over-limit and confirmation state from authorized backend responses**. Never merge in mock
rows, replay a mock decision, infer approval from a reason code or mutation status, or use
mock data as a network-error fallback. The mock replay is isolated to the explicit demo adapter
and mode. The UI waits for a matching Confirmation row from the subsequent read.

Over-limit review requires a separate checkbox and sends acceptOverLimit:true only after that
explicit action. An OVER_POLICY row alone is not an over-limit offer: the job must carry
`overLimitCandidate`. Estimates display the supplied `costBasis` verbatim. Missing estimates
remain unrecorded; PENDING never implies availability or approval.

When requestPickup is connected, forward its optional `window` argument exactly as requested;
the backend's default is afternoon, and different windows produce different idempotency keys.
The UI reads the window from the supplied job's idempotencyKey rather than choosing a new one.
No GraphQL adapter is connected by this UI PR, and no live API or database writes are claimed.

## Current route integration on main 3055fbf

Village is now wired on demand via React.lazy and Suspense, preserving Mission Control's slot.
The static loading text is quiet and accessible. At 390px, route-scoped CSS reserves space for
search/filter controls above the canvas; no files in features/village are changed.
See [bundle sizes, all six tab screenshots and verification](evidence/village-route/README.md).
Parent chat is still the existing placeholder tab; its feature implementation is separate.
