# Live school reports in Activity — 2026-11-02

## Window and revisions

Read-only browser proof performed inside the AGENT PROOF SLOT posted on PR #78. The slot opened at 2026-11-02T00:28:25Z; Bentley's 00:40:30Z “agents resume” comment extended the deadline to **2026-11-02T02:00:00Z** after restarting only Rosina. The proof completed by 00:47:48Z (`date -u`). I checked the listed process IDs before and after the read.

| Component | Serving revision / identity |
| --- | --- |
| Activity UI | `origin/main` `3e417a8de5408ae7dc3666f82826b72b8abc2409`, proof worktree `proof/web-activity-school-live`, production Vite build served through a temporary local preview proxy on 5202; `web/dist/index.html` SHA-256 `2f7a248f1c16f785a1eaf90886a6ac0f6c6d4f8d96d0d756a36defaaec1d5358` |
| graph + demo/API 4001–4008 | Bentley's slot revision `c231ba8`, pid 57746 |
| routers 4010 / 4012 | slot supergraph revision `c806f46`, pids 16254 / 16282 |
| MCP 5051 | slot config revision `cfbbb6a`, pid 45267, caller-header forwarding restored |
| Rosina 4200 | `7fda69d`, restarted pid 39469 with the router target restored |
| old 5189 UI | `dd14400`, untouched; this proof did not use it |

The slot and service revisions above come from Bentley's PR #78 comments, corroborated by live process IDs. Current checkout HEADs of long-running process worktrees had moved since process launch; they are not treated as proof of what those processes loaded. The earlier HTTP 502 notice failure remains in #89's evidence and is not rewritten here. The #90 single sample-(a) confirmation, Rosina-service leg, and teacher filing were posted complete on #78 before this Activity read.

## Actual Kendra read and UI result

Playwright CLI used Kendra's real picker-issued session in the frozen preview. No GraphQL response was intercepted. `WebActivitySchoolReportsWithTime` returned HTTP **200** with three rows for Nora. All three had school-day `at: 2026-11-01`; that date is the day the report is about. `reportedAt` is the filing timestamp. Activity grouped the rows under Sunday, Nov 1 and showed:

| Report ID | Returned text | `reportedAt` UTC | Rendered Detroit time | UI |
| --- | --- | --- | --- | --- |
| `sr_8d414c57375b` | Nora has a fever and is asking to go home | `2026-11-02T00:37:02.192805+00:00` | 7:37 PM EST | REPORTED · School report |
| `sr_fa2617d92e2a` | Nora twisted her ankle at recess and the nurse thinks someone should pick her up | `2026-11-02T00:43:23.378188+00:00` | 7:43 PM EST | REPORTED · School report |
| `sr_1621815c7531` | Nora has a fever today. | `2026-11-02T00:44:09.738027+00:00` | 7:44 PM EST | REPORTED · School report |

For every row, the browser check found the returned text **byte-for-byte** in a paragraph with zero child elements, the REPORTED label, “School report” attribution, and no invented detail link. The text was not labeled CONFIRMED and no diagnosis or pickup outcome was inferred. `sr_1621815c7531` is the #99 browser-card filing; `sr_8d414c57375b` is the #103 teacher chat proof. Screenshot captures, all from the live read: `kendra-light-1440.png`, `kendra-light-390.png`, `kendra-dark-1440.png`, `kendra-dark-390.png`.

This leg made no mutation, reset, seed, restart or merge. Bentley owns the canonical reset at slot close.
