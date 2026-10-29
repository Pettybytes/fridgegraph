# Mission Control handoff

The UI, recorded replay, dialog fix, over-limit projection handling, tests and browser evidence
are implemented against main 21565be. See `web/evidence/mission-control/README.md` for the full
integration receipt, exact verification counts, screenshots, limitations and handoff packet.

No live GraphQL adapter is connected. Candidate, over-limit and confirmation states in connected
mode must come only from authorized backend responses. Never fall back to the mock fixture.
PENDING means Waiting for reply; a matching Confirmation row is required for approval evidence.
The demo is explicitly simulated, not a real outreach or approval write.

BRANCH: feat/web-mission-control-ui
WORKTREE: /Users/user/orca/workspaces/fridgegraph/fridgegraph-mission-control-ui
TASK: Review the implemented Mission Control UI and evidence.
LAYER: frontend
TOUCHED: web/src/features/mission-control/**, web/src/App.tsx,
web/src/lib/frontendData/**, web/evidence/mission-control/**, web/e2e/**,
web/playwright.config.ts, web/scripts/sync-mocks.mjs, web/package.json, web/INTEGRATION.md.
DONE WHEN: npm run typecheck; npm run check; npm --prefix web test (41 tests);
npm --prefix web run build; npm --prefix web run test:e2e (10 tests); screenshot review.
NOT DOING: parent chat, village UI, backend/schema/DB/contracts, live outreach, merge/deploy.
BLOCKERS: live GraphQL adapter remains future integration work; unmatched p_angel mock needs
upstream correction before adding it to the four-person authorized baseline.
