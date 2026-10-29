# Mock identifier audit

Baseline main and frontend-data.md contract: `21565be8eb0be9552fed38e68e5001badd6bc172`.
Branch: `docs/mock-person-ids`. Documentation-only correction requested by Bryan.

## Correction, in its own commit

Angela Price is `p_price` in src/fixtures.ts. Replaced the two incorrect `p_angel`
references, one in docs/mocks/pickup-candidates.json and one in
docs/mocks/pickup-job-lifecycle.json. No person, permissions, seed data or candidate
list was added or modified. The four authorized mock pickup candidates remain unchanged.

## Audit actually run

An offline Node/tsx audit calls the pure createSeed() fixture constructor and collects every
entity's id. It parses all seven mock JSON files, checks structured id/*Id fields, and greps
known identifier prefixes in prose/URLs. The event kind job_created is excluded as a kind,
not misreported as an entity ID. No database, environment file or identity map is accessed.

- Seed entity IDs: **91**.
- Unique mock identifier references: **50**.
- Person IDs checked: **13**.
- Before: **one missing person ID**, p_angel, in two files.
- After: **zero missing person IDs**.
- Other identifiers absent from the seed: **22**, listed below.
- All seven mock JSON files parsed successfully.

## Other IDs not present in src/fixtures.ts

These are reported, not silently renamed. The mock notes describe the message/feed shapes
and calendar rows as illustrative. Seed coordinationJobs, attempts, informationRequests and
confirmations are empty arrays; chat/feed and voice-note records are not seeded entity tables.
The list is not a claim that these IDs exist in a live database.

| ID | docs/mocks files |
| --- | --- |
| `conf_0003` | `mission-control.json`, `pickup-job-lifecycle.json` |
| `evt_0001` | `family-calendar.json` |
| `ir_0007` | `parent-chat.json` |
| `job_01HXYZ` | `family-calendar.json`, `geographic-map.json`, `mission-control.json`, `parent-chat.json`, `pickup-candidates.json` |
| `mc_0001` | `mission-control.json` |
| `mc_0002` | `mission-control.json` |
| `mc_0003` | `mission-control.json` |
| `mc_0004` | `mission-control.json` |
| `mc_0005` | `mission-control.json` |
| `mc_0006` | `mission-control.json` |
| `mc_0007` | `mission-control.json` |
| `mc_0008` | `mission-control.json` |
| `msg_0001` | `parent-chat.json` |
| `msg_0002` | `parent-chat.json` |
| `msg_0003` | `parent-chat.json` |
| `msg_0004` | `parent-chat.json` |
| `msg_0005` | `parent-chat.json` |
| `msg_0006` | `parent-chat.json` |
| `msg_0007` | `parent-chat.json` |
| `prac_0001` | `family-calendar.json` |
| `slip_0001` | `family-calendar.json` |
| `vn_0001` | `parent-chat.json` |

## Validation

The offline person-ID assertion passed after the correction, with all 13 person references
resolving to fixture people. Root typecheck, staged secret scan and diff checks are run before
commit. No UI changes, screenshots or live graph/database probes are required or claimed.

## Handoff packet

BRANCH: docs/mock-person-ids
WORKTREE: /Users/user/orca/workspaces/fridgegraph/fridgegraph-mock-person-ids
TASK: Correct Angela's mock identity and report all other unseeded identifiers.
LAYER: docs
TOUCHED: docs/mocks/pickup-candidates.json, docs/mocks/pickup-job-lifecycle.json,
docs/evidence/27-mock-person-id-audit.md.
DONE WHEN: offline audit has zero missing person IDs; seven JSON files parse;
npm run typecheck; npm run check; git diff --check.
NOT DOING: source fixtures, schema, database, frontend PR changes, merge or deploy.
BLOCKERS: none for this correction; non-person mock IDs remain illustrative as listed.

Final local validation observed: root typecheck passed; staged secret scan scanned 196 files
with zero findings; staged diff check passed. The person-ID audit found zero unresolved
person IDs after the two replacements.
