# Mission Control integration receipt

Baseline main: `21565be8eb0be9552fed38e68e5001badd6bc172`.
Contract: `docs/contracts/frontend-data.md` at the same commit, with Station 06 fields.
Branch: `feat/web-mission-control-ui`. Exact final head is recorded in the draft PR.

## Result and boundaries

The app now renders a dark pickup card, all four recorded caregiver rows with channels and
status pills, Rosina's recommendation and because-list, caregiver review, job timeline and
Rosina's activity trace. Both travel-cost labels are exact; every displayed estimate includes
its supplied costBasis verbatim. PENDING remains Waiting for reply and implies no approval.

The explicit Simulated demo replays only the normal approval fact already recorded as
conf_0003. It does not contact a person, book anything, or claim pickup completion. The real
GraphQL adapter is **not connected** by this PR. In connected mode, candidate, over-limit and
confirmation states must come exclusively from authorized backend projections; no mock or
network-error fallback is permitted. A mutation's confirmed status cannot substitute for a
matching Confirmation row from the subsequent read.

The over-limit UI consumes CoordinationJob.overLimitCandidate and requires a separate checkbox
before passing acceptOverLimit:true. Confirmation.overLimitApproved alone determines whether
exception acceptance is shown. Unit tests inject a backend-projection stand-in; no live
backend verification is claimed. A lone OVER_POLICY row is still only an alternative for
review, and does not replace the recorded recommendation.

## Authorized dialog fix and test harness fixes

Before the fix, [the recorded audit](dialog-audit.json) showed focus landing on BODY after
Escape and Close. The dialog now stores the actual opening button and restores it in
onCloseAutoFocus. If successful approval removes that button, focus moves to persistent Review.
No other focus/dialog behavior was overridden.

Test harness fix: the two failing tests queried background status while a modal correctly
hid it from accessibility queries. They now use within(dialog), assert the background is
inaccessible while open, and check it again after dismissal. No hidden:true query is used.
PENDING, OVER_POLICY and parent-approval expected values are unchanged.

Test harness fix: removed unsupported Testing Library role-query exact options; string name
matching is exact by default. Browser smoke tests use installed Chrome because the runner's
bundled headless binary was absent; all original assertions were preserved. No install needed.

Contract-sync update, separate from harness fixes: costBasis now matches the approved source
verbatim, including updating the old custom-copy assertion as required by the new contract.
The sanitized fixture can be regenerated with `node web/scripts/sync-mocks.mjs`.

Source discrepancy: docs/mocks adds a PENDING illustration for p_angel, while the seed identifies
Angela Price as p_price and the authorized mock pickupCandidates list remains four people.
The generator joins by ID and preserves that four-person baseline. It does not add the unmatched
row or silently correct identity. The overLimitPath is copied without private location/contact
fields. This source discrepancy should be corrected upstream before adding that person.

## Verification actually run

- Full Vitest: **41 tests passed in 10 files**.
- Root `npm run typecheck`: passed.
- `npm run check`: clean after staging, **213 files scanned, zero findings**.
- `npm --prefix web run build`: passed. Vite reports a non-failing bundle-size warning.
- `npm --prefix web run test:e2e`: **10 passed**, five at each viewport.
- Playwright CLI capture: **47 checks passed**, no page errors, console zero errors/warnings.
- Name, focus entry, keyboard trapping, background isolation, Escape, Close, both opening
  buttons and restored background accessibility verified in real Chrome at both widths.
- [Post-fix browser result](browser-after-fix.json). Original failing audit is preserved.

## Interaction screenshots

| Step | 1440px desktop | 390px mobile |
| --- | --- | --- |
| Recorded recommendation | [Desktop](01-recommendation-1440.png) | [Mobile](01-recommendation-390.png) |
| Select Loretta, then Review | [Desktop](02-alternative-review-1440.png) | [Mobile](02-alternative-review-390.png) |
| Open the recommendation dialog | [Desktop](03-recommendation-dialog-1440.png) | [Mobile](03-recommendation-dialog-390.png) |
| Explicitly replay recorded approval | [Desktop](04-approval-recorded-1440.png) | [Mobile](04-approval-recorded-390.png) |

Between dialog screenshots, Escape/Close return to the opener; reopening is required before
approval. The browser capture also checks that approval is separate from pickup completion.

To reproduce, start the local Vite server on 4182 and use Playwright CLI with
`web/evidence/mission-control/verify-browser-after-fix.js`. Smoke tests are in
`web/e2e/pickup.smoke.spec.ts`; `web/playwright.config.ts` defines both viewports.

## Handoff packet

BRANCH: feat/web-mission-control-ui
WORKTREE: /Users/user/orca/workspaces/fridgegraph/fridgegraph-mission-control-ui
TASK: Review Mission Control UI against the merged contract and explicit simulated replay.
LAYER: frontend
TOUCHED: web/src/features/mission-control/**, App.tsx, lib/frontendData/**,
web/package.json, web/playwright.config.ts, web/e2e/**, web/scripts/sync-mocks.mjs,
web/INTEGRATION.md, web/evidence/mission-control/**.
DONE WHEN: npm run typecheck; npm run check; npm --prefix web test (41 tests);
npm --prefix web run build; npm --prefix web run test:e2e (10 tests); screenshot review.
NOT DOING: parent chat, Hermes village UI, contracts, backend/schema/DB, live auth/outreach,
merge or deploy. Parent chat is preserved on its separate branch.
BLOCKERS: real GraphQL adapter and live authorized API integration remain future work;
unmatched mock PENDING identity needs upstream correction before inclusion.

## Files changed against baseline

- `web/.gitignore`
- `web/INTEGRATION.md`
- `web/e2e/pickup.smoke.spec.ts`
- `web/evidence/mission-control/01-recommendation-1440.png`
- `web/evidence/mission-control/01-recommendation-390.png`
- `web/evidence/mission-control/02-alternative-review-1440.png`
- `web/evidence/mission-control/02-alternative-review-390.png`
- `web/evidence/mission-control/03-recommendation-dialog-1440.png`
- `web/evidence/mission-control/03-recommendation-dialog-390.png`
- `web/evidence/mission-control/04-approval-recorded-1440.png`
- `web/evidence/mission-control/04-approval-recorded-390.png`
- `web/evidence/mission-control/README.md`
- `web/evidence/mission-control/browser-after-fix.json`
- `web/evidence/mission-control/dialog-audit-1440.png`
- `web/evidence/mission-control/dialog-audit.json`
- `web/evidence/mission-control/verify-browser-after-fix.js`
- `web/package.json`
- `web/playwright.config.ts`
- `web/scripts/sync-mocks.mjs`
- `web/src/App.tsx`
- `web/src/features/mission-control/MissionControl.test.tsx`
- `web/src/features/mission-control/MissionControl.tsx`
- `web/src/features/mission-control/WORK.md`
- `web/src/features/mission-control/demoAdapter.test.ts`
- `web/src/features/mission-control/demoAdapter.ts`
- `web/src/features/mission-control/index.ts`
- `web/src/features/mission-control/mission-control.css`
- `web/src/features/mission-control/model.test.ts`
- `web/src/features/mission-control/model.ts`
- `web/src/features/mission-control/overLimit.test.tsx`
- `web/src/lib/frontendData/mock-data.json`
- `web/src/lib/frontendData/mockAdapter.test.ts`
- `web/src/lib/frontendData/mockSync.test.ts`
- `web/src/lib/frontendData/provider.tsx`
- `web/src/lib/frontendData/types.ts`
