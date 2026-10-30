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

---

## Reconciliation 1 — no existence oracle (2026-10-30, before merge)

**Chosen behaviour: one empty result.** Both tools answer `{"data":{"jobTimeline":[]}}` /
`{"data":{"attempts":[]}}` — HTTP-equivalent, no GraphQL error, no code — for a **hidden** job, a
**nonexistent** id and a **malformed** id. Nothing distinguishes them, so the tools cannot be used to
learn that a job id exists.

Measured through MCP 5051 → 4012 (exact payloads, Dana's own token):

| Call | Input | Response |
|---|---|---|
| `JobTimeline` | visible job (`job_nora_oct16`) as Kendra | 5 entries |
| `JobTimeline` | the same job as **Dana** (hidden) | `{"data":{"jobTimeline":[]}}` |
| `JobTimeline` | `job_missing_000000000000` | `{"data":{"jobTimeline":[]}}` |
| `JobTimeline` | `not a job id !!!` | `{"data":{"jobTimeline":[]}}` |
| `Attempts` | the same job as **Dana** (hidden) | `{"data":{"attempts":[]}}` |
| `Attempts` | `job_missing_000000000000` | `{"data":{"attempts":[]}}` |
| `Attempts` | `not a job id !!!` | `{"data":{"attempts":[]}}` |

The proof now asserts byte-equality of the three payloads per tool (`identical=true`), not "either
UNAUTHORIZED or empty". The caller-is-known property is a **separate** check: Dana's call must not be
`UNAUTHENTICATED` (it would mean the token never arrived and the comparison would be vacuous). Proof:
**24/24 PASS** on MCP 5051.

## Reconciliation 2 — v1 baseline vs the simulated fixture

**The v1 baseline is unchanged by this branch.** `src/fixtures.ts` is byte-identical to `origin/main`
(`git diff origin/main -- src/fixtures.ts` is empty); `scripts/db.ts` gains only additive
`seed:simulated` / `checksum:simulated` commands.

| Check | Result |
|---|---|
| Baseline checksum with the fixture applied vs before | **only `coordination_jobs` and `attempts` differ — 2 of 29 tables**; the other 27 hashes are byte-identical |
| `db:reset` then checksum vs pre-fixture capture | **byte-identical (`true`)** |
| Baseline tables / rows today | 29 tables / 162 rows |
| Simulated fixture's own checksum | `coordination_jobs` 1 row `3e221662b46f5903`; `attempts` 2 rows `8e3fbbc30dfe618d` |

The **28 tables / 157 rows** figure in evidence 19 is an older snapshot than the merged E2 work; today's
`main` baseline is 29 tables / 162 rows. That delta is **not** from this branch (the baseline code is
identical to `main`) — it is recorded here so nobody reads the two numbers as the same thing.

Separation is now structural: `src/fixtures-simulated.ts` is its own module with its own label
(`SIMULATED`), its own seeder and its own checksum. It is additive, idempotent by fixed id, and
`TEST_RESPONDER`-only. `db:reset` removes it (that is exactly what restores v1); re-apply it with
`npx tsx scripts/db.ts seed:simulated`.

## Graph suite re-run

`ops/run-evidence.mjs` against **router 4012** (alt stack, subgraphs 4101–4107 running this checkout):
**114 checks across 32 cases — PASS** every case matched its expected status, code, count and
disclosure rule. The suite's regenerated evidence artifacts were reverted rather than committed, to
keep this PR scoped; the run and its counts are recorded here.
