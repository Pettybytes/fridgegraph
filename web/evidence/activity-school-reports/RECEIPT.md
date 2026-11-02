# School reports in Activity — 2026-11-01

Branch `feat/web-activity-school-reports`, fresh base `origin/main` `93d648d` (#91 merged). Frontend only.

## Contract checked before implementation

`schema/school.graphql` exposes `schoolReports(childId)` returning `SchoolReport { id, child, kind, text, at }`. `school_reports.at` is a SQL `date`; the resolver returns its first ten characters. It is the recorded school day, not a local instant, symptom onset, pickup approval or confirmation. `schoolReports` calls `authorizeChild(ctx, childId, SCOPE.school)` and reads through the caller's RLS client. The `school_reports_read` policy allows a parent or `school.read` scope. The current type has no reporter and no report detail route. PR #92 is open and not live; its inspected diff still has date-only `at` and no `reportedAt` as of this receipt.

The frontend tries optional `reportedAt` and falls back to the date-only query **only** for a missing-field schema validation response. A real school read failure yields a separate unavailable or refused banner while other authorized entries remain. `at` remains the group date; a valid returned `reportedAt` supplies the local time, otherwise the UI says “Time not recorded.” School text is rendered as a React text node. IDs use `school:<id>`; pickup and consent entries also have source prefixes. The school item has no invented reporter or detail link.

## Browser check

Playwright CLI against this worktree's Vite server on 5194. Kendra used a real picker-issued session. The actual current backend returned no school report for Nora through the date-only fallback; existing pickup entries still rendered and ended attempts read RECORDED. To exercise the school row visually, only the `WebActivitySchoolReportsWithTime` GraphQL response was intercepted with an explicitly labelled fictional fixture. All other graph and login reads continued to the local services. The fixture text was “Fixture school report — Nora said she felt tired after reading.” `reportedAt` was null, so the rendered item showed REPORTED, “School report,” and “Time not recorded”; no CONFIRMED label appeared. The fixture was never written to the database. Captures: `kendra-fixture-light-1440.png`, `kendra-fixture-light-390.png`, `kendra-fixture-dark-1440.png`, `kendra-fixture-dark-390.png`. Dark mode used the existing `.dark` class. No graph mutations, demo reset, seed or deploy.

## Read gaps

- `SchoolReport` has no authorized reporter name or ID; show “School report.”
- There is no report detail route or link target; the feed item has no link.
- `reportedAt` is absent from the current and open #92 schema; only a date can be shown until that field is delivered and deployed.
