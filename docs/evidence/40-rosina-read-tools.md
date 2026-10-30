# Evidence 40 — Rosina read tools: JobTimeline and Attempts

_Task E-NEXT, sub-task 2. Branch `feat/e-next-rosina-tools` off `main` `1cd7ab8`. Local stack only
(alt MCP 5051 → alt router 4012). Nothing restarted except the MCP process itself, so it could load
the new operation files._

## Status: DONE — 23/23 PASS on the alt MCP (5051 → 4012)

| Item | State |
|---|---|
| Operation files + MCP exposure | **PASS** — `tools/list` = `Attempts, JobTimeline, PickupCandidates` |
| No mutation tool exposed | **PASS** — `mutation_mode: explicit` unchanged, no mutation operation file added |
| Allowed persona sees data | **PASS** — Kendra: 5 timeline entries, 2 attempts with candidates |
| Out-of-network refusal | **PASS** — Dana is a known caller, refused `UNAUTHORIZED`, zero rows, not `UNAUTHENTICATED` |
| Demo guide read-only + sandbox | **PASS** — guide reads the same 5 entries / 2 attempts; no write tool exists |
| Anonymous fails closed | **PASS** — `UNAUTHENTICATED` on both tools |

Run: `node ops/mcp-rosina-tools-proof.mjs` (alt stack must be up from THIS checkout).

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

## Two defects found on the way (both fixed here)

**1. No coordination fixture existed.** `scripts/db.ts#baseline()` mapped no coordination table at
all, and `src/fixtures.ts` had `coordinationJobs: []`, `attempts: []`. Measured before the fix:
`coordinationJobs` was `[]` for Kendra, the guide and Dana on **both** routers (4010, 4012), so a
read tool could not be distinguished from an empty table. Fixed with one simulated job on `p_nora`
(`status awaiting_approval`, v3) and two `TEST_RESPONDER` attempts — one accepted via `p_gma`, one
declined via `p_tasha` — in `createSeed()` **and** the `baseline()` mapping. Seeded: 163 rows.
`requestPickup` would not have been a substitute: it creates no attempt rows, and dispatch stays
inactive.

**2. `Attempt.job` was a stub.** The attempts resolver returned `job: { id }`, so `job { status
version }` — exactly what Rosina's Attempts tool asks for — failed with
`Cannot return null for non-nullable field CoordinationJob.status`. Fixed with a real
`Attempt.job` resolver that loads the job through the caller's own RLS (`requireCaller` +
`jobById`). This is a genuine pre-existing bug that only a richer read exposed; it is not an
authorization change.

## Not claimed

- **Rosina's allowlist is not updated here** — Claude Code adds each tool to it, per the task.
- **No SECURITY DEFINER guide-seam re-check is claimed for these two reads**: both are direct
  `dbFor(ctx)` table reads (RLS-scoped), not derived reads, so 0026's seam does not apply. The check
  applies to the Group 3–5 reads when they land.
- **The alt stack must run this checkout** to reproduce: the subgraphs on 4101–4107 were restarted
  from `fridgegraph` (previously they served a different worktree, `fridgegraph-level-b`). The router
  (4012) and MCP (5051) were not restarted for this; only the MCP process was, to load the new
  operation files.

## Hard stops held

No dialing, no SMS, no dispatch, no flag set, no new persisted authorization, no service-role read on
behalf of a caller (the proof discovers the job id with the caller's own token), no merge.
