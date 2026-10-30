# Evidence 40 — Rosina read tools: JobTimeline and Attempts

_Task E-NEXT, sub-task 2. Branch `feat/e-next-rosina-tools` off `main` `1cd7ab8`. Local stack only
(alt MCP 5051 → alt router 4012). Nothing restarted except the MCP process itself, so it could load
the new operation files._

## Status: tools shipped and exposed; **boundary proof BLOCKED on absent demo data**

| Item | State |
|---|---|
| Operation files + MCP exposure | **DONE and verified** (tools/list = `Attempts, JobTimeline, PickupCandidates`) |
| No mutation tool exposed | **PASS** — `mutation_mode: explicit` unchanged, no mutation operation file added |
| "Allowed persona sees data" | **BLOCKED — no coordination job exists in the dataset** |
| Out-of-network refusal / guide read-only | **BLOCKED by the same cause** (proven in the script, not yet passable) |

## What was added

| File | Change |
|---|---|
| `ops/JobTimeline.graphql` | **new.** `query JobTimeline($jobId: ID!)` |
| `ops/Attempts.graphql` | **new.** `query Attempts($jobId: ID)` |
| `.apollo/mcp.local.yaml` | operation `paths` now lists all three files; `mutation_mode: explicit` unchanged; `forward_headers: [authorization]` unchanged |
| `ops/mcp-rosina-tools-proof.mjs` | **new.** MCP-level boundary proof (identity, refusal, guide, anonymous) |
| `ops/mcp-e2-proof.mjs` | assertion "only PickupCandidates is exposed" replaced by "PickupCandidates is exposed AND no mutation tool is exposed" — the tool set legitimately grew |

Both documents validate against `supergraph.graphql` (0 errors, `graphql.validate`).

## Tool contract

| Operation | Arguments | Response shape | Allowed personas | Boundary proof |
|---|---|---|---|---|
| `JobTimeline` | `jobId: ID!` | `[{ at, kind, attemptId, candidate { id displayName }, detail }]` — ascending by stored time; `[]` when the job is not visible (never an error, so an id cannot be probed) | parents + guardians of the job's child (row RLS `is_parent_of`); Demo guide on sandbox jobs; nobody else | `ops/mcp-rosina-tools-proof.mjs` 2, 4, 5 — **blocked on data**, see below |
| `Attempts` | `jobId: ID` | `[{ id, channel, at, destinationMode, closedAt, closedReason, job { id status version }, candidate { id displayName } }]` | same as the Attempt row's own visibility | same script, checks 3–5 — **blocked on data** |

Neither tool can write: there is no mutation operation file, `introspection.execute` stays disabled,
and `mutation_mode` remains `explicit`. Adding these tools grants no action.

## The blocker (honest, and useful)

`scripts/db.ts#baseline()` maps **no coordination tables at all**. `src/fixtures.ts` declares
`coordinationJobs: []`, `attempts: []`, `informationRequests: []`, `confirmations: []`, and even if
they were populated, `baseline()` builds rows for neither `coordination_jobs` nor `attempts`.

Consequence, measured through the running stack: `coordinationJobs { id status }` returns `[]` for
Kendra (parent), for the Demo guide and for Dana on **both** routers (4010 and 4012). The database
holds zero jobs and zero attempts, so no read tool can show data and no refusal can be distinguished
from an empty dataset. This is not an auth defect — it is a missing fixture, and it is the same gap
that Group 4's seed has to close for every coordination story.

**Resume point:** add an idempotent sandbox fixture (one job on `p_nora` with two `TEST_RESPONDER`
attempts — one accepted through `p_gma`, one declined through `p_tasha`) to `createSeed()` **and** to
the `baseline()` mapping, seed it, then re-run `node ops/mcp-rosina-tools-proof.mjs`. Only then can
this PR go ready. A job created through `requestPickup` is not a substitute: it produces no attempt
rows, and the dispatch chain that does is deliberately inactive.

## Not claimed

- No persona boundary is claimed for these tools yet. The script asserts it and currently stops at
  check 1.
- No Rosina allowlist entry is claimed: Claude Code adds each tool to Rosina's allowlist, as the task
  specifies.
- No SECURITY DEFINER guide seam re-check is claimed for these two reads; both are direct
  `dbFor(ctx)` table reads (RLS-scoped), not derived reads, so 0026's seam does not apply. The check
  still applies to the Group 3–5 reads when they land.

## Hard stops held

No dialing, no SMS, no dispatch, no flag set, no new persisted authorization, no service-role read on
behalf of a caller (the proof discovers the job id with the caller's own token), no merge.
