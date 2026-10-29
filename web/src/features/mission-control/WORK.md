# Mission Control work in progress

Baseline main: f8dd86baef6e3ff7455154434bfcc2d4dd8ee276.
Contract: frontend-data.md at ad188f2adaeb97b6bee6bda7ac395052e49822ab, section 5,
plus Bryan's approved PENDING and label clarifications. API fields keep their contract names.

Started the recorded-data view model and tests. Every caregiver row is preserved, including
OVER_POLICY, leaving room for Bentley's upcoming alternative without implementing a new
selection or approval path ahead of the contract. No new state or confirmation is inferred.

Next: dark pickup card, caregiver selection/review, recommendation because-list sourced from
recorded policy evidence, job timeline, Rosina activity trace, and required UI/smoke evidence.
This is not a complete feature or a feature PR. No UI screenshots claimed for model-only work.

BRANCH: feat/web-mission-control-ui
WORKTREE: /Users/user/orca/workspaces/fridgegraph/fridgegraph-mission-control-ui
TASK: Build Mission Control against recorded mocks and the fixed frontend data contract.
LAYER: frontend
TOUCHED: web/src/features/mission-control/** (started); web/src/App.tsx,
web/src/lib/frontendData/**, web/evidence/mission-control/** and web smoke config/tests (next).
DONE WHEN: npm run typecheck; npm run check; npm --prefix web test;
npm --prefix web run build; Playwright navigation, caregiver selection and approval UI smoke;
1440px/390px screenshots plus interaction evidence.
NOT DOING: village UI, backend/schema/DB/contracts, unapproved alternative path, merge/deploy.
BLOCKERS: mutable coordination screens depend on backend operations; do not invent outcomes.
