# FridgeGraph — HANDOFF

_Last updated: Oct 26, 2026 (late). Written under context pressure — read §9 before trusting any state._

## 1. State

- **HEAD:** `fb0c77f` + the B3 commit (see §9).
- **Runtime source of truth:**
  - `village` + `access` (grants/approvals/householdPolicy/parentingSchedule/candidates/approverFor)
    → **Postgres, per-request RLS client** (`src/db.ts`). No in-memory read on those paths.
  - `coordination`, `schedule`, `school`, `transport`, `activities` → **still `src/fixtures.ts`**
    for their own rows; their authorization calls already go to Postgres via `src/authz.ts`.
- **Migrations:** 0001–0011. New in B3: `0008` pickup-candidate definer read, `0009`
  household_members policy recursion fix, `0010` grant-holder/co-parent definer helpers,
  `0011` Daniel's grant window widened off a single day.
- **Last measured results**
  - Graph suite: **31 cases, identical in `DEMO_CLOCK=1` and `DEMO_CLOCK=0`** after B3.
  - B3 proof: `docs/evidence/20-b3-village-postgres.md` — **21/21 PASS** (`node ops/b3-proof.mjs`).
  - RLS proofs: `17` (8/8), `18` (14/14 paired). B2: `19` regenerated from a live run.
- **Last green:** B3 commit — village + access DB-backed, rest restart-proven.

## 2. Test reality check

The 31-check suite runs against a **fixture-backed** graph (subgraphs still import `src/fixtures.ts`). Therefore **31/31 does not prove any migration.** It only proves the GraphQL contract and authorization semantics are intact. Postgres correctness is proven separately by `ops/rls-check.mjs`, `ops/rls-gaps.mjs`, and (partially) `ops/b2-proof.mjs`. When B3/B4 land, re-check with a DB-only change (e.g. edit a care plan in Postgres, see it in the suite) and confirm `grep -r "fixtures" src/` returns no runtime importer.

## 3. Cold start

```bash
cd ~/Desktop/bentley/fridgegraph
set -a; . ./.env; set +a

# subgraphs (7 ports, one process)
npm start                     # 4001-4007; logs "7 subgraphs listening"
# optional test clock: DEMO_CLOCK=1 npm start

# main router — GraphOS mode, edge JWT ON (4010, health 8090)
~/.rover/bin/router-v2.18.0 --config router.graphos.yaml
#   expect: UpdateLicense(Licensed), 0 ERROR lines

# rollback router — offline, no edge auth (same ports)
~/.rover/bin/router-v2.18.0 --config router.yaml --supergraph supergraph.graphql

# MCP (5050) — standalone, survives either router
~/.rover/bin/apollo-mcp-server-v2.1.0 .apollo/mcp.local.yaml
```

Health: `curl 127.0.0.1:8090/health`; MCP probe `node ops/mcp-probe.mjs`; suite `node ops/run-evidence.mjs`.

## 4. `.env` variables (names + purpose; values never recorded)

| Name | Purpose | Status |
| --- | --- | --- |
| `SUPABASE_URL` | project base URL | present |
| `SUPABASE_PUBLISHABLE_KEY` | anon/publishable key; per-request client | present |
| `SUPABASE_SERVICE_ROLE_KEY` | server-side scripts only | present |
| `SUPABASE_DB_URL` | migrations via `supabase db push --db-url` | present |
| `SUPABASE_JWKS_URL` | router edge auth (fixes redaction mangling) | present |
| `APOLLO_KEY` | router ↔ GraphOS (licence + schema) | present |
| `APOLLO_GRAPH_REF` | `fridgegraph@dev` | present |
| `META_API_KEY` | Muse — **no calls made this run** | present |

## 5. Database

Migrations (`supabase/migrations/`, applied 0001–0007):

- `0001_schema.sql` — domain tables, FKs, checks.
- `0002_seed.sql` — fixtures by fixed id.
- `0003_rls.sql` — RLS enabled+forced on 28 tables, deny-by-default policies.
- `0004_grants.sql` — role grants (without these RLS never ran; everything was 403).
- `0005_whoami.sql` — `whoami()` RPC proving `auth.uid()` → person.
- `0006_local_today.sql` — grant windows in `America/Detroit` (UTC `current_date` expired grants at 20:00).
- `0007_village_event.sql` — history table + `ops_sentinel` (outside reset scope).

Ownership: village → people/children/households/relationships/goals/care_plans/groups/memberships/village_event; access → grants/approvals/household_policies/parenting_schedules; schedule → events; school → school_reports/permission_slips; transport → bus_rosters/vehicles; activities → practices; coordination → coordination_jobs/attempts/information_requests/confirmations; conversation_state.

RLS: `auth.uid()` → `identity_map.user_id` → `person_id`; `is_parent_of()`, `has_scope()` (local date), `current_person()`. `identity_map` has **no** policy and is revoked from `authenticated`/`anon`.

Seed/reset: `npm run db:seed`, `npm run db:reset`, `npm run db:checksum`. Boundary = fixed baseline ids + explicit table list in `scripts/db.ts`; no TRUNCATE; `identity_map`, auth users and `ops_sentinel` untouched.

`village_event` = history; `events` = schedule.

## 6. Mutation ownership (no change this run)

| Mutation | Owner | Persistence/restart evidence |
| --- | --- | --- |
| `approveRelationship` | access | fixture-backed only (B4) |
| `grantAccess` | access | fixture-backed only (B4) |
| `revokeGrant` | access | fixture-backed only (B4) |

## 7. Evidence index

`01`–`14b` graph/Auth; `15` edge JWT probe; `16` edge auth + MCP; `17` RLS core; `18` paired RLS gaps; `19` B2 seed/reset/village_event (**stale — §9**).

## 8. Gotchas (with fixes)

1. **Redaction mangling**: literals like `jwks:`, `await`, `Bearer ${x}` get written as `***`. Fix: env expansion (`SUPABASE_JWKS_URL`) and building strings from parts; always `node --check`.
2. **Grants before RLS**: without table grants every request is 403 and RLS never runs — `0004_grants.sql`.
3. **UTC `current_date` in Postgres**: expired same-day grants at 20:00 Detroit — `0006_local_today.sql`.
4. **401 vs 200-zero-rows**: anon is rejected before RLS; signed-in denials are 200 with 0 rows. Keep them distinguishable.
5. **Stale evidence near-miss**: `14b` shipped from a rollback run and contradicted the live edge router.
6. **Silent no-op `.env` append**: verify the line count after appending.
7. `rover dev` **cannot** run edge auth (unlicensed); the GraphOS-connected **binary** must be used. `pkill rover dev` orphans the router child — kill by port.
8. **Self-referencing RLS policy**: putting a table's own `SELECT` inside its own policy raises `42P17` at runtime — migration `0009` (`my_household_ids()`). Never do it.
9. **RLS hides rows the derived queries need** (grants, co-parent membership, relationship types for a `pickup.verify` holder). Fix with narrow `SECURITY DEFINER` helpers (`0008`/`0010`), never by widening a policy.
10. **`/__reset` re-seeds from the fixtures the process loaded at startup** — after editing `src/fixtures.ts`, restart the stack or in-process resets restore OLD values. This silently reverted a grant window once.
11. **Single-day grant windows make the suite pass/fail on the wall clock** (`06a` went red at 00:00). Migration `0011` widened it to a covering window.

## 9. Decisions, mixed state, and what is NOT done

- **B2 status:** migration `0007`, `scripts/db.ts`, npm scripts done; seed idempotency proven (**28 tables, 157 rows, identical checksums**); reset deleted the temp grant/relationship and restored the care plan; sentinel survived; double reset a no-op; `village_event` → Kendra 1, Chris 0.
- **Two FAIL rows in `19-b2-persistence.md` are stale text**, not live failures: Dana legitimately keeps baseline `r_dana_friend_parent` (`DISCOVERED`). The corrected assertion (grants 0, status DISCOVERED only) was patched in `ops/b2-proof.mjs` but the re-run did not finish writing the file. **Re-run `node ops/b2-proof.mjs` and commit the refreshed file.**
- **B3 DONE (village + access on Postgres).** Per-request client, publishable key + caller's token,
  no service key in request handling. Evidence 20: graph + direct PostgREST for Kendra/Loretta/Dana/
  Walter/Chris, a named-row reality check, and `approveRelationship` surviving a real restart.
- **B4 IN PROGRESS:** coordination, schedule, school, transport, activities still read fixtures.
- **B5, Section C: not started.**
- No secrets printed/committed. `META_API_KEY` present; **no model calls made**.

## 10. Risks (ranked)

1. Fixture-backed graph can drift from Postgres schema unnoticed until B3/B4.
2. Reset scope is id-based; a demo record created with a baseline-colliding id would be overwritten, not deleted.
3. `village_event` has no write policy — only service role can insert. Fine for now, must be revisited when Muse writes history.
4. Edge auth depends on GraphOS connectivity at startup; offline → use the rollback config.

## 11. NEXT RUN

1. `node ops/b2-proof.mjs` → confirm all PASS, replace `docs/evidence/19-b2-persistence.md`, commit+push B2.
2. README "Run it locally" (seed/reset/start stack) if not already committed.
3. **B3**: per-request `supabase-js` (publishable key + caller's Authorization) inside village; migrate village reads, then its writes; suite in both clock modes + restart durability + reset.
4. **B4**: access → coordination → schedule → school → transport → activities, one at a time; delete `src/store.ts` at the end; `grep -r fixtures src/` must show no runtime importer.

First three commands: `cd ~/Desktop/bentley/fridgegraph` · `set -a; . ./.env; set +a` · `node ops/b2-proof.mjs`.

## 12. Milestone 3 (pickup job) needs

Present: `coordination_jobs`, `attempts`, `information_requests`, `confirmations` (RLS-scoped, empty), `village_event` for history.
Missing: idempotency keys on job creation (unique `idempotency_key` exists — needs an enforced create path), an outbound channel adapter with labeled test responders, confirmation state that cannot be invented by the model, and a job state machine (pending → awaiting_parent → awaiting_adult → confirmed/failed) with versioned writes.

---

## 13. B3/B4 STATUS — stop point (Oct 27, 2026 00:20)

**Green and pushed, each proven by its own evidence file:**

| Step | Commit | Evidence | Proof |
| --- | --- | --- | --- |
| B3 village + access on Postgres | `f1cb43a` | `20-b3-village-postgres.md` | 21/21 |
| B4 schedule | `0de43f6` | `21-b4-schedule.md` | 8/8 |
| B4 school | `a2a1356` | `21-b4-school.md` | pass (seeded + cleaned a fictional row) |
| B4 transport | `a836604` | `21-b4-transport.md` | pass |

Suite: **31 cases, byte-identical outcome in `DEMO_CLOCK=1` and `DEMO_CLOCK=0`** after every green step
(12 single `UNAUTHORIZED` denials + 04's pair + 14a `UNAUTHENTICATED` + 14b edge `AUTH_ERROR`).

**NOT green — activities (uncommitted code in this commit, marked `wip`):**
- `activities` resolvers were migrated to Postgres, but `node ops/b4-proof.mjs activities` FAILS two checks:
  1. `edit is visible through the graph` — after patching `practices.location`, the graph returned `[]`.
     Not yet diagnosed; the same read path works in the suite (01 shows the practice row).
  2. `paired RLS` — `p_dana` reads 1 `practices` row for Nora's team. **This is a real RLS gap, not a
     test artifact:** `practices_read` (0003) authorizes on the *player's* grants —
     `is_parent_of(m.person_id) or has_scope(m.person_id,'schedule.read')` — instead of the CALLER's.
     Any signed-in user sees practices for any group whose player has a parent.
- **Decision needed (Bryan):** tighten `practices_read` to the caller (`is_parent_of(player) or
  has_scope(player,'schedule.read')` evaluated for `current_person()`), then re-run 18-rls-gaps
  because the policy changes proven evidence. Not done here: changing a policy with no budget left
  to re-verify it would be exactly the "pass the check by moving the goalposts" failure mode.

**Remaining:**
1. Diagnose the activities graph read, then finish activities (needs the policy decision above).
2. Migrate `coordination` (all four tables are empty by design; proof harness already supports
   seed-and-clean via `emptyByDesign`).
3. Delete `src/store.ts`; `grep -rn "fixtures" src/` must show no runtime importer
   (`scripts/db.ts` legitimately imports `createSeed` to build the seed baseline).
4. Re-run the full battery: both clock modes, `b3-proof`, `b4-proof <owner>`, MCP probe as Kendra
   (expect 4 pickup candidates), secret scan for `***` outside fixture data.
5. MCP (5050) was not re-proven after B3/B4 — do that in the final pass.

**New gotchas found this run (add to §8 when next editing):**
- Self-referencing RLS policy on `household_members` = `42P17` at runtime → migration `0009`
  (`my_household_ids()`). Never put a table's own select inside its policy.
- RLS hides *other people's* rows the derived queries need (grants, co-parent membership,
  relationship types for a pickup.verify holder) → narrow `SECURITY DEFINER` helpers in `0008`/`0010`
  rather than widening policies.
- `/__reset` re-seeds from the fixtures the **server process loaded at startup**; after editing
  `src/fixtures.ts` you must restart the stack or in-process resets restore the OLD values. This
  silently reverted Daniel's grant window once and cost a debugging cycle.
- A single-day grant window in the seed makes a suite case pass/fail on the wall clock
  (`06a` went red at 00:00 Oct 27) → migration `0011` widened it to a covering window.

---

## 14. B4 COMPLETE (Oct 27, 2026) — store removed

`src/store.ts` is **deleted**. `grep -rn "fixtures" src/` shows only `src/fixtures.ts` itself and
two stale comments; `scripts/db.ts` still imports `createSeed` to build the seed baseline, which is
its only remaining purpose. Every subgraph reads its own tables through the per-request RLS client.

Suite after the deletion, with no in-memory fallback anywhere:
**31 cases, outcome identical in `DEMO_CLOCK=1` and `DEMO_CLOCK=0`, 0 `DB_UNAVAILABLE`.**

Green steps (each with its own evidence file):

| Step | Commit | Evidence |
| --- | --- | --- |
| B3 village + access | `f1cb43a` | `20-b3-village-postgres.md` (21/21) |
| B4 schedule | `0de43f6` | `21-b4-schedule.md` |
| B4 school | `a2a1356` | `21-b4-school.md` |
| B4 transport | `a836604` | `21-b4-transport.md` |
| B4 activities | `6840829` | `21-b4-activities.md` |
| B4 coordination | `32d669a` | `21-b4-coordination.md` |
| store removed | this commit | final suite above |

### The reported practices_read "gap" was a bad test premise — NOT fixed, deliberately

`practices_read` already evaluates for the CALLER: `is_parent_of(m.person_id)` and
`has_scope(m.person_id, scope)` are `current_person()`-anchored definer helpers. `p_dana`'s single
row was correct access — **Jax is a Tigers player** (`memberships: p_jax / g_tigers / player`).
No policy was rewritten; rewriting it would have broken correct behaviour to satisfy a wrong
expectation. `ops/practices-authz.mjs` / `evidence 22` records the probe table, proves the guard
actually FIRES (withdraw Jax → Dana 1→0, restored → 1), and states the genuine no-op (Kendra stays
at 1 because Nora is still a player).

### Still open

1. **MCP PickupCandidates as Kendra → 4 candidates: RESOLVED (Oct 28, 2026).** Re-proved through
   MCP → router → subgraph → RLS on both routers: see `docs/evidence/16b-b5-mcp-reproof.md`. The
   earlier `ROUTER_FREE_PLAN_RATE_LIMIT_REACHED` was an account plan limit; a single paced probe on
   the GraphOS-connected router now returns 4 candidates with no rate-limit response.
2. `practices_read` authorizes on any group the player belongs to while the resolver surfaces only
   team groups. Scoping question, not a leak; left as-is and flagged in evidence 22.

---

## 15. MCP mutation exposure — pinned to `explicit` (Oct 28, 2026)

`.apollo/mcp.local.yaml` now carries `overrides.mutation_mode: explicit`.

Key and values verified against the **installed binary** (Apollo MCP Server v2.1.0), not only the
skill docs: the field is `mutation_mode` inside `overrides`, and the enum is `none | explicit | all`.

Measured on 2026-10-28 with one query file and one mutation file (`tools/list`):

| `mutation_mode` | Tools exposed |
| --- | --- |
| `explicit` | `PickupCandidates`, `ApproveRelationship` |
| `none` | `PickupCandidates` only (log: `Skipping mutation operation ApproveRelationship`) |
| `all` | `PickupCandidates`, `ApproveRelationship` |

A mutation that has **no operation file** is not exposed in any mode: `grantAccess` and
`revokeGrant` both return `-32602 Tool <name> not found`. Ad-hoc `execute` is separately disabled,
so there is no path to an arbitrary mutation.

With the real repo config (only the port changed for the test) `tools/list` returns exactly
`PickupCandidates`.

**This is an exposure gate, not authorization.** Apollo states `mutation_mode` is a configuration
gate, never per-invocation approval. Every write still runs as the caller's own JWT through the
router and the subgraph resolvers, where identity, scope, parent checks and (for Station 06)
idempotency and explicit parent approval must be enforced. Adding a mutation file must never be
treated as granting it.

## 16. Pre-exposure checklist — public hosting

**Decision (Oct 28, 2026): Cloudflare Tunnel from Bryan's Mac.** It must stay up through judging.
Not set up yet; do not create it until Station 06 needs it.

**Exposure order.** Station 06 needs a public URL for the GHL Custom Action: expose **only the
voice/webhook endpoint first**. The GraphQL router stays private until every gate below passes.

| # | Gate before the router is public | State today | Where |
| --- | --- | --- | --- |
| 1 | `authentication.router.jwt.on_error: RedactedError` | **FAIL** — currently `Error`, returns detailed validation messages | `router.graphos.yaml` |
| 2 | GraphQL introspection **off** | **FAIL** — `introspection: true` | both router configs |
| 3 | Apollo sandbox / homepage explicitly disabled | not configured | both router configs |
| 4 | `include_subgraph_errors` not `all` | **FAIL** — leaks subgraph error detail | both router configs |
| 5 | CORS: no wildcard origin, explicit allowlist | not configured | both router configs |
| 6 | `overrides.mutation_mode: explicit` | **PASS** (pinned) | `.apollo/mcp.local.yaml` |
| 7 | Bind address / tunnel scope: only the intended listener is tunnelled | n/a (no tunnel yet) | Cloudflare |
| 8 | Supabase password rotation | due **before the repo goes public**, not a merge gate | — |

Both router configs are **localhost-only development configs** that bind `127.0.0.1`. They are
correct for local work and must never be promoted as-is.

## 17. SECURITY DEFINER audit — nine functions in `public` (Oct 28, 2026)

Read-only at the time of the audit. The fix below was prepared afterwards and applied on
2026-10-28 with explicit approval.

**Correction to the first version of this section (the repo text and the live database differ).**
Eight of the nine functions pin `set search_path = public`. `local_today()` does **not**: the live
catalog shows `prosecdef = false` and **no** `proconfig`, i.e. a plain `STABLE` SQL function with
no SECURITY DEFINER and no pinned search path — while `0006_local_today.sql` in this repo declares
both. So the earlier "9 of 9" claim was taken from the migration file and was wrong about the
live object. `local_today()` only computes a date from `now()`, both resolved from `pg_catalog`,
so there is no table reference for a search-path attack to redirect; the risk is nil, but the
drift is real and is recorded here rather than silently "fixed". Re-applying 0006 verbatim would
change a live function's attributes, which is out of scope for a grant migration.

All nine live in `public`, the schema PostgREST exposes.

Live probe through PostgREST RPC — as `anon` (publishable key, no user token), as `p_walter`
(authenticated, unrelated adult) and, for child-scoped helpers, as `p_dana` (cross-village):

| Function | `anon` | `p_walter` | `p_dana` | Notes |
| --- | --- | --- | --- | --- |
| `current_person()` | **200** `null` | 200 own id | — | anon-executable |
| `local_today()` | **200** `2026-10-28` | 200 | — | anon-executable |
| `is_parent_of(child)` | **200** `false` | `false` | `false` | anon-executable |
| `has_scope(child, scope)` | **200** `false` | `false` | `false` | anon-executable |
| `whoami()` | 401 `42501` | 200 own id | — | correctly locked |
| `my_household_ids()` | 401 `42501` | `[]` | — | correctly locked |
| `parent_ids_of(child)` | 401 `42501` | `[]` | `[]` | correctly locked, no leak |
| `pickup_candidates_for(child, date)` | 401 `42501` | `[]` | `[]` | correctly locked, no leak |
| `grant_holders_for(child, scope, date)` | 401 `42501` | `[]` | `[]` | correctly locked, no leak |

**Result: no unauthorized data retrieval.** The three child-scoped helpers return empty for an
unrelated adult and for a cross-village parent, and are refused outright for `anon`. Their internal
`is_parent_of` / `pickup.verify` gates work.

**Finding (low severity, posture not leak):** four functions — `current_person`, `local_today`,
`is_parent_of`, `has_scope` — were created without `revoke all … from public`, so they keep
Postgres's default PUBLIC execute and are callable by `anon`. What an unauthenticated caller
actually gets is a null identity, the local date, and two booleans that are always false for them.
No row data is disclosed. The defect is inconsistency: the other five were explicitly revoked.

**Fix applied: `supabase/migrations/0012_revoke_public_execute.sql` (Oct 28, 2026).**
`revoke all … from public` and `from anon` on those four, plus an explicit `grant execute … to
authenticated` (revoking PUBLIC also removes the inherited grant from `authenticated`, which is the
role every request uses). Bodies, policies, tables and `search_path` are untouched.

Catalog ACL, before → after (`has_function_privilege`):

| | `anon` before | `anon` after | `authenticated` before/after |
| --- | --- | --- | --- |
| `current_person()` | YES | **no** | yes → yes |
| `local_today()` | YES | **no** | yes → yes |
| `is_parent_of(text)` | YES | **no** | yes → yes |
| `has_scope(text, text)` | YES | **no** | yes → yes |

Behavioural verification, direct PostgREST (`node ops/run-evidence.mjs`, case 26):

- `anon` on all four → `401 42501` (was `200`)
- authenticated (Kendra) on all four → `200` (no regression)
- authorized data path intact: Angela (`pickup.verify`) → `pickup_candidates_for` **18 rows**
- unauthorized path intact: Walter → `pickup_candidates_for` **0 rows**
- asserted suite: **114 checks across 32 cases, PASS at `DEMO_CLOCK=0` and `DEMO_CLOCK=1`** —
  this is the regression test that revoking PUBLIC did not break the RLS policies that call these
  helpers as `authenticated`.

Residual drift, not fixed (needs its own decision): `local_today()` is not SECURITY DEFINER and has
no pinned `search_path` in the live database, unlike the repo's 0006.

---

## Task W progress — judge-ready web (2026-10-30)

Three states: UI complete · backend complete (Bentley) · integrated + tested. Only integrated
and tested against real services is DONE. No steps are DONE. One branch/worktree/PR per step
from main 72c1cf5; rebase after Bryan merges earlier work. Never merge.

| Step | UI complete | Backend complete (Bentley) | Integrated + tested |
|---|---|---|---|
| W1 — PR #17 | yes, read-only transport + derived feed | primitive reads exist; demo session delivery unavailable | fixture integration tested; live session not tested; NOT DONE |
| W2 — PR #19 | yes, mock | demo login/reset/create unavailable | mock-tested (61 tests); live not tested; NOT DONE |
| W3 — PR #20 | yes, mock | Rosina service unavailable | mock-tested (78 tests); live not tested; NOT DONE |
| W4 | not started | awaiting services | not started |

### W1 implemented surfaces and provenance

- Mission Control reads live `coordinationJobs` + `attempts(jobId)`. Its feed is **derived**,
  never a synthetic event history. Only attempts, recorded confirmations and cost-calculation
  facts carry their own timestamps; job status/version, reasonCode, availability and acceptedVia
  appear under Current state, without manufactured times. Timestamped events never claim an old
  job version or status observed at that time. Candidate channel is **unavailable** (`—`).
- Living Village: **derived** graph projection from live `village`, `child`, `householdMembers`
  and `relationships`. No inferred private roles or fabricated edges. Polls at 30s; Mission
  Control polls at 2.5s. Forbidden results stop polling and show access denial.
- Graphql mode is read-only and has no `readParentChat`. Mock is the default, including tests.
  Legacy mock chat is **unavailable as a live surface**; W3 replaces it with Ask Rosina.
- `/graphql` proxies to 127.0.0.1:4010. Apollo gets the existing Supabase user's access token
  using publishable runtime configuration. No browser passwords or server credentials. The
  connected entry accepts child/village IDs and checks session presence; actual access is server-side.
  It displays unavailable login rather than substituting a mock session. W2/W4 replace this entry.

Validation run: root typecheck PASS; staged secret scan PASS; web **61 tests PASS**; production
build PASS (existing >500kB bundle warning). Playwright CLI checked the derived GraphQL fixture
preview and denied response at desktop/mobile. Screenshots: `web/evidence/task-w/w1-desktop.png`,
`w1-mobile.png`; cost correction screenshots `cost-normal-desktop.png`, `cost-normal-mobile.png`.
These are explicitly labeled fixture previews, not evidence of a live authenticated service.
No live DB evidence suite/probes run: frontend-only, credential-free; those suites are backend scope.

Bentley needs: real demo-login session + authorized scopes; jobTimeline to replace the derived
feed; Attempt.candidate to join channels by candidate id. Parent chat/chatThread is DROPPED.
No attempt destination-mode field exists today; the UI makes no claim about individual deliveries.

BRANCH: feat/web-graphql-adapter; WORKTREE: /Users/user/Desktop/bentley/fridgegraph-web-adapter
TASK: complete W1 read-only adapter, keeping PR #17 draft until live integration.
LAYER: frontend + companion frontend contracts/handoff/mocks only.
TOUCHED: web/, docs/contracts/frontend-data.md, docs/mocks/pickup-candidates.json,
  docs/mocks/pickup-job-lifecycle.json, docs/mocks/mission-control.json,
  docs/mocks/parent-chat.json, docs/handoff/HANDOFF.md.
DONE WHEN: npm run typecheck; npm run check; npm --prefix web test (61);
  npm --prefix web run build; live authenticated Mission Control + village browser proof still required.
NOT DOING: server/schema/auth/DB, merges, Family Calendar, v2 catalog proposals.
BLOCKERS: real authenticated integration unavailable; use explicit mocks for the next UI steps.

### Task W cost-fixture correction (2026-10-30)

Authority: pickup-job.md §6a (PR #14). Normal night: Loretta is AVAILABLE_NO_TRANSPORT;
all candidate costs and bases are null. Drivers are never costed. The explicitly named
**no-driver night** alone carries the $12.40 OVER_POLICY example. mockSync's assertions stay intact.
The source candidate/lifecycle mocks also contained stale driver costs; those documentation
records are reconciled to §6a in this correction. No seed, schema, auth or database changes.

§1.5 rideshare-label amendment is proposed for Bryan's approval in PR #17. The UI describes
the ride and preserves the backend basis; null costs have no label, while zero remains visible.

Bentley follow-up (reported, unchanged): pickup-candidates.json lists Loretta's DEMO-103 vehicle;
the seed has no vehicle for p_gma and PR #14's harness asserts zero. Decide whether the scenario
is “no vehicle on file” or “vehicle on file but not available today”. This does not block web work.

### Task W cross-step resume pointers

- W1: https://github.com/Pettybytes/fridgegraph/pull/17 — feat/web-graphql-adapter, this worktree; 61 tests.
- W2: https://github.com/Pettybytes/fridgegraph/pull/19 — feat/web-persona-picker,
  /Users/user/Desktop/bentley/fridgegraph-web-persona-picker; 61 tests.
- W3: https://github.com/Pettybytes/fridgegraph/pull/20 — feat/web-ask-rosina,
  /Users/user/Desktop/bentley/fridgegraph-web-ask-rosina; 78 tests.

All UI steps are complete with explicit mocks/derived facts; all are draft and NOT DONE because
real-service integration is untested. W2 includes the shared policy correction; W3 includes policy
and W2 prerequisites. Main remains 72c1cf5 at this check. Rebase/deduplicate and reconcile App after
Bryan merges prior steps. Do not mark fixture browser runs as live proof. W4 remains conditional
on Bentley delivery. No merge, tag, release or database action was performed.

### Task W pre-merge copy corrections — W1

Human display labels replace workflow codes, version numbers and confirmation/household IDs.
Recorded values stay in adapter data; no new facts or authors were invented. The connected entry
no longer asks a family to enter internal child/village IDs; its scope still awaits demo login.
Mission Control and Living Village accept a persona-aware denied-state slot for W2/W3; the
credential-free W1 fallback explains sharing instead of rendering a bare denial.
Touched paths additionally include web/src/lib/frontendData/AccessEmptyState.tsx, displayCopy.ts,
displayCopy.test.ts and web/src/features/village/PersonCard.tsx; frontend only.
Validation: root typecheck, secret scan, web build PASS; **62 web tests PASS**. Playwright CLI
screenshots: web/evidence/task-w/w1-access-desktop.png and w1-access-mobile.png. No live integration
claim; W1 remains NOT DONE. Follow-up stack rebase is authorized by Bryan's copy-fix request.

## Task W progress — pre-merge copy review (current)

| Step | PR | Web tests | UI complete | Backend complete (Bentley) | Integrated + tested |
|---|---|---|---|---|---|
| W1 | #17 | 62 PASS | yes | primitive reads available; session delivery incomplete | fixture-tested, live untested; NOT DONE |
| W2 | #19 | 70 PASS | yes | demo login/reset/create unavailable | mock-tested, live untested; NOT DONE |
| W3 | #20 | 88 PASS | yes | Rosina service/action integration unavailable | mock-tested, live untested; NOT DONE |
| W4 | — | not run | pending services | unavailable | not tested |

Copy corrections stay on the owning feature branches. No author is recorded on the current care
plan; sources use “Nora's care plan” without attributing Kendra. W2 groups existing personas and
reserves portrait space. W3 answers first, cites plain-language evidence and offers role-aware,
catalog-validated screen cards. Schedule remains unavailable; Family Calendar and future v2
entries are deferred. Existing visual identity retained. Branch stack is W1 → W2 → W3 with PR
bases kept on main; final readable-label changes must be included before pushing the rebased tips.
No main merge, tag, release, server/auth/schema change or live database action was performed.

Main advanced during the copy pass: PR #18 added coordination-v2.md at 3ad23eb (docs only).
W1 was rebased onto that main. The contract's current/future visibility and catalog constraints
were reviewed; proposed backing models still are not implemented by a document merge. No v2
household, catalog entry or Family Calendar was added. W2 and W3 must be replayed above this tip
before final publication; author attribution still uses the existing record, not proposed fields.

## Task W progress — W2 persona picker (2026-10-30)

| Step | UI complete | Backend complete (Bentley) | Integrated + tested |
|---|---|---|---|
| W1 — PR #17 | yes | primitive reads; login unavailable | fixture-tested; live not tested; NOT DONE |
| W2 — PR #19 | yes, mock | demo-login/reset/create unavailable | mock-integrated + tested; live not tested; NOT DONE |
| W3 — PR #20 | yes, mock | Rosina unavailable | mock-tested (78 tests); live not tested; NOT DONE |
| W4 | not started | awaiting delivery | not started |

Branch created from main 72c1cf5 with the W1 cost correction cherry-picked as a shared prerequisite
so the existing fixture-sync assertions remain intact. No W1 adapter code is included. After Bryan
merges W1, rebase this branch onto main and reconcile App's connected entry; never merge autonomously.

Surface states: entry/sign-in/reset/create = **unavailable live**, explicit mocks. Mission Control
and Living Village = **unavailable live** in this step, conservative mock projections. Priya's
mock **care information** is derived verbatim from src/fixtures.ts carePlans and visible only under
her careplan.read example. Loretta has pickup.request/schedule.read/goals.read; Priya has
supervise.request/schedule.read/careplan.read. Neither gets parent job data or the broad village mock.
Dana scopes to her own child Jax; the Jax-family entry represents Ray. No invented identity.

Private cleanup synchronously unmounts the old workspace before any await, clears Apollo through
clearStore (plus adapter clearStore when provided), remounts selections/cards under the session
generation, and ignores superseded sign-in/family responses. W3 must register conversation cleanup
with the same session registry. Connected mode never signs into the live graph with a mock identity.

Validation: root typecheck PASS; secret scan PASS; **61 web tests PASS**; production build PASS
(existing >500kB warning). Six new session tests cover cache/DOM clearing, a late sign-in response,
Kendra → Loretta, Priya's grants and mock family validation/reset. Existing shell tests now enter via
Kendra instead of assuming private data before sign-in. Playwright CLI checked desktop/mobile,
Kendra → Loretta with a MutationObserver (no old private content in switch mutations), Priya's
care-only view, and mock create/reset. Screenshots: web/evidence/task-w/w2-desktop.png, w2-mobile.png.

BRANCH: feat/web-persona-picker; WORKTREE: /Users/user/Desktop/bentley/fridgegraph-web-persona-picker
TASK: six-person mock entry, session isolation and sandbox demo controls.
LAYER: frontend and companion handoff only (plus shared W1 policy prerequisite).
TOUCHED: web/src/features/personas/, web/src/App.tsx, web/src/lib/frontendData/types.ts,
  web/src/app/Shell.test.tsx, web/src/app/VillageRoute.test.tsx, web/evidence/task-w/, this handoff.
DONE WHEN: npm run typecheck; npm run check; npm --prefix web test (61);
  npm --prefix web run build; real demo-login/reset/create integration still required.
NOT DOING: backend auth, passwords, credentials, DB, Family Calendar, merge, v2 catalog entries.
BLOCKERS: Bentley's server-side demo-login must return the actual user session and authorized
  scope; resetDemo/createDemoFamily endpoints and their contracts remain unavailable.

W2 privacy follow-up: switching/reset clears selected-person hash parameters before the next session loads. A dedicated route-cleanup test passes. PR: https://github.com/Pettybytes/fridgegraph/pull/19.

Task W resume: W1 #17 (61 tests), W2 #19 (61 tests), W3 #20 (78 tests) are pushed draft PRs.
All UI steps complete; Bentley services unavailable and live integration untested; none DONE.
W3 worktree: /Users/user/Desktop/bentley/fridgegraph-web-ask-rosina. Main still 72c1cf5; rebase
after Bryan merges earlier steps. W3 already registers conversation cleanup and owns the catalog
structure; do not implement future coordination-v2 entries or the Family Calendar prematurely.

### Task W pre-merge copy corrections — W2 (current)

W2 is rebased onto updated W1 (f6d4744); PR base remains main. Shared policy commits were
deduplicated. The feature branch history is rewritten only for this requested stack rebase.
The picker groups Nora's four existing personas under “Nora's village” and Dana/Ray under
“Jax's family”. Portrait space keeps initials; no portraits or additional households invented.
The sharing boundary derives its explanation from the persona's recorded mock grants. Priya sees
“Pickup plans are shared with Nora's parents. You can see Nora's schedule and care information.”
Her implemented care screen is offered; schedule is explicitly unavailable, not a new calendar.
W3 replaces these read-only screen links with catalog-validated cards on its branch.
Care sources say “Source: Nora's care plan”. Current CarePlan has no author field, so Kendra is
not attributed. A display helper accepts an author only when actual source metadata supplies one.
No file paths or workflow codes appear in the new source labels. Visual identity retained.
Added paths: web/src/features/personas/PersonaAccessState.tsx, careInformation.tsx,
PersonaPicker.test.tsx; MissionControl/LivingVillage use W1's denied-state slot. Care information
is a derived mock projection; live service remains unavailable. No auth/schema/DB changes.
Validation: root typecheck, secret scan, production build PASS; **70 web tests PASS** including
household grouping, care privacy and persona-isolation regressions. Playwright CLI checked the
grouped entry and Priya's sharing → care path at desktop/mobile. New screenshots are append-only:
web/evidence/task-w/w2-copy-desktop.png and w2-copy-mobile.png. W2 remains NOT DONE for live integration.

Final W2 stack check: rebased onto W1 including its final readable relationship/contact labels
and current progress table. Post-rebase root typecheck, secret scan, build and **70 web tests PASS**.
Full-page grouped picker evidence: web/evidence/task-w/w2-grouped-final-desktop.png and
w2-grouped-final-mobile.png. Existing evidence retained. W2 remains mock-tested, NOT DONE for live
integration. PR #19 stays based on main; no main merge. W3 must be rebased onto this updated tip.

## Task W progress — W3 Ask Rosina (2026-10-30)

| Step | UI complete | Backend complete (Bentley) | Integrated + tested |
|---|---|---|---|
| W1 — PR #17 | yes | primitive reads exist; real login unavailable | fixture-tested; live not tested; NOT DONE |
| W2 — PR #19 | yes, six personas | login/reset/create unavailable | mock-tested, 61 tests; live not tested; NOT DONE |
| W3 — PR #20 | yes, mock | Rosina endpoint/proxy target unavailable | mock-tested, 78 tests; live not tested; NOT DONE |
| W4 | not started | awaiting real services | not tested |

This branch was created from main 72c1cf5 and carries shared policy + W2 prerequisite commits,
without W1's GraphQL adapter. After Bryan merges earlier steps, rebase onto main, deduplicate
prerequisites and reconcile App's connected entry. No agent merge. No step is DONE yet.

### W3 surfaces and authority

- Ask Rosina appears on every mock screen, including entry. **Unavailable live**, explicitly
  scripted mock. Desktop dock; mobile sheet with close/Escape. History uses the existing
  ChatMessage model in memory, scoped to persona; each request sends prior role/content messages.
  Switching aborts/discards pending replies and removes draft/thread/pending confirmations.
- Current-screen explanation is **derived** from implemented UI behavior. Recommendation
  explanation is **derived** from the current recorded candidate reasonCode, never invented
  ranking reasons. Mock afternoon answer reads the current pickup status and does not imply
  a complete calendar. Care answer is **derived** from the care-plan fixture, cited verbatim.
- The catalog owns id/label/schema/handler/changesData/implemented. Unknown/bad/unimplemented
  actions are dropped. Routes are built locally; a person must occur in the available village
  projection. Child scope is rechecked for pickup. Model-written HTML and links remain plain text.
- Pickup execution is **unavailable live**: mock review always passes through the app-owned
  confirmation dialog, even if a response says no confirmation is needed. Cancel performs no
  action. Confirm consumes the card; the reply explicitly says no live job was created.
- Service adapter POST /api/rosina attaches the user bearer and client history, checks response
  shape, and refuses missing sessions. The live snack flow returns exactly “I can't confirm that
  yet” until the approved v2 care-rule integration exists. No guessed service port/proxy target.
- Contract: docs/contracts/ask-rosina.md. Its clearly marked coordination-v2 section defines no
  future IDs or args. Every current catalog entry has implemented. Family Calendar is deferred.

Validation run: root typecheck PASS; staged secret scan PASS; **78 web tests PASS**; production
build PASS (existing >500kB warning). Seventeen Rosina tests cover all seven acceptance examples,
unknown/bad/unimplemented actions, app confirmation despite a response's bypass claim, Cancel,
plain text/links, bearer/history shape, live care uncertainty and late reply/persona isolation.
Playwright CLI exercised all seven scripted examples, no cross-family disclosure, confirmed mock
pickup, Kendra → Priya conversation clearing, actual Loretta card routing, mobile close/Escape,
and additional boundary replies as Andre, Dana and Jax's family. These are scripted mock checks,
not W4 independent exploration or evidence of a live model. Desktop/mobile screenshots:
web/evidence/task-w/w3-desktop.png and w3-mobile.png.

Browser finding, corrected (verbatim initial mock reply): “You can open an available person card
from your own village.” The requested Tasha card was absent from that mock projection, so the
catalog correctly dropped it; the mock now resolves named people from the available projection
and explicitly explains an unavailable card. Loretta's card was exercised successfully. No live
Rosina model ran, so there are no live model errors to report or conceal.

BRANCH: feat/web-ask-rosina; WORKTREE: /Users/user/Desktop/bentley/fridgegraph-web-ask-rosina
TASK: catalog-controlled Ask Rosina with seven scripted flows and private client-side history.
LAYER: frontend and companion frontend contract/handoff (plus shared prerequisites).
TOUCHED: web/src/features/rosina/, web/src/App.tsx, web/src/app/Shell.tsx,
  web/src/app/Shell.test.tsx, web/src/features/village/LivingVillage.tsx,
  web/src/features/personas/Session.test.tsx, web/evidence/task-w/, docs/contracts/ask-rosina.md,
  docs/handoff/HANDOFF.md. Earlier prerequisites are separately committed.
DONE WHEN: npm run typecheck; npm run check; npm --prefix web test (78);
  npm --prefix web run build; real service + W4 exploration/browser runs still required.
NOT DOING: schema/auth/DB, service implementation, Family Calendar, future v2 catalog definitions,
  real outreach, merge/tag/release.
BLOCKERS: Bentley's authenticated demo login/scopes, Rosina service URL/port and endpoint,
  no-history-persistence guarantee, live pickup handler integration, reset/create APIs,
  jobTimeline and Attempt.candidate. W4 must report actual model mistakes verbatim.

W3 PR: https://github.com/Pettybytes/fridgegraph/pull/20 (draft, pushed). Resume map: W1 #17
(61 tests), W2 #19 (61 tests), W3 #20 (78 tests). No steps DONE; UI complete and explicit mocks
are tested, while real backend integration remains untested. Main still 72c1cf5. After Bryan
merges earlier steps, rebase/deduplicate prerequisites and reconcile App with W1; never merge.

### Task W pre-merge copy corrections — W3 (current)

W3 is rebased onto updated W2, with W1 beneath it; duplicate shared policy/privacy commits were
removed. PR base remains main. Resolve future upstream merges by rebasing, never merging here.
Scripted replies lead with the answer or clearly state what cannot be confirmed, then cite recorded
evidence. The snack answer begins “No, Nora has a peanut allergy.” and quotes the care plan.
Its source is “Nora's care plan”: no path, table name, workflow enum or invented “added by Kendra”.
Current source record has no author metadata. Future author attribution must come from the record.
Other sources say “the pickup plan” or “Nora's pickup plan”, with readable status labels.
Sharing boundaries use catalog-validated open-screen cards for care information and Ask Rosina.
Care cards are filtered by actual mock care access; the care screen checks that access again.
Schedule remains explicitly unavailable, with no usable schedule card and no Family Calendar.
The same catalog owns implemented flags, schemas, labels and route construction for both the
empty-state cards and conversation cards. Current routes add care-information and ask-rosina;
no future coordination-v2 entries are defined. Display labels say “Open care information” etc.
Demo conversation/confirmation copy describes the effect to the person, without implementation
terms. UI identity unchanged; household grouping and portrait initials come from W2.
Additional path: web/src/features/rosina/CatalogCards.tsx. Scope is frontend + companion contract
and handoff only. Live services remain unavailable; no auth/schema/DB changes or merge.
Validation: root typecheck/secret scan/build PASS; web tests and desktop/mobile Playwright checks
cover revised acceptance flows, answer-before-evidence, plain sources, no invented author, role-aware
sharing cards, care access filtering, persona privacy and confirmation. See final counts below.
Screenshots: web/evidence/task-w/w3-copy-desktop.png and w3-copy-mobile.png (new artifacts; old retained).

Current pre-merge validation: **88 web tests PASS**, root typecheck PASS, staged secret scan PASS,
production build PASS. Playwright CLI exercised all seven revised replies, care sharing cards,
mobile Ask Rosina navigation/Escape, and Loretta's absence of care cards/private care text.
The stack will receive W1's final readable relationship labels before the final push.

Final W3 stack validation: W1 → W2 → W3 ancestry verified after the requested rebase. Final root
typecheck, staged secret scan, web build and **88 web tests PASS**. W1 has 62 passing tests; W2 has
70 passing tests. The current three-state table above still applies: UI complete; real backend
services incomplete/unavailable; only fixture/mock integration tested; none DONE. PRs remain draft.
A mobile browser check initially timed out waiting for “Open care information” after navigating
to Ask Rosina (TimeoutError: locator.click, waiting for getByRole('link', { name: 'Open care information', exact: true })).
The check was corrected to return to Mission Control first; the same care navigation and Loretta
privacy assertions then passed. No assertion was relaxed and no app failure was called expected.
Sources must remain plain language and record-authored; author metadata remains a nonblocking
Bentley follow-up. Final rebased feature tip is pushed with a lease, never to main. No merge.

Final main update: the whole stack is rebased above main 3ad23eb (Coordination v2 contract, PR #18,
docs only): main → W1 → W2 → W3. W1/W2 code checks remain 62/70 PASS. W3's reserved contract section
now acknowledges the merged document and waits for backing migrations/services, not merely a doc.
A stale Area G sentence claiming current v1 catalog entries already had implemented:false was
corrected to describe their available mock handlers and unavailable live execution; future v2
wrappers remain unimplemented. This is a UI-reference correction only, with no new v2 action
IDs, schema or authorization rule. Touched packet additionally includes that paragraph of
docs/contracts/coordination-v2.md. Four future households and Family Calendar remain outside this
copy pass; their actual backing data/migrations have not landed in this main update.

Final publication check after main 3ad23eb and the approval-copy correction: ancestry verified
main → W1 → W2 → W3; post-rebase checks actually run and observed PASS: W1 62, W2 70, W3 88 web
tests, plus each branch's root typecheck, secret scan and web build. Human “Pickup marked confirmed”
never substitutes for separate Confirmation evidence; recommendation copy calls parent approval
a separate decision, not an inferred fact. All three PRs are draft and live integration remains
untested/NOT DONE. Copy corrections and screenshots are published on their owning branches.

### Task W squash-merge rebase — main 215df4a

Bryan squash-merged W1 (#17) as 215df4a. W2 was replayed with
`git rebase --onto origin/main 1880d70 feat/web-persona-picker`; W3 was replayed with
`git rebase --onto feat/web-persona-picker 05475c9 feat/web-ask-rosina`.
Range-diff verified all five W2 patches and all six W3 patches unchanged. Pre-squash W1 commits
were removed from both branches' pending history. No UI, schema, auth or database changes.
Observed checks after rebasing: W2 **70 web tests PASS**, W3 **88 web tests PASS**; root typecheck,
secret scan (zero findings), and web production build PASS on both. Existing bundle warning remains.

BRANCH: feat/web-persona-picker (#19), feat/web-ask-rosina (#20); existing sibling worktrees.
TASK: restack W2/W3 after W1's squash merge, without reintroducing W1's original commits.
LAYER: frontend history and this companion handoff only.
TOUCHED: commit ancestry only; docs/handoff/HANDOFF.md records this rebase.
DONE WHEN: both branches pass web tests, typecheck and secret scan, are pushed with leases,
  and GitHub reports MERGEABLE against main. Live integration remains a separate pending task.
NOT DOING: UI changes, merging, tags, releases, backend/auth/schema/database work.
BLOCKERS: none found in the rebase or local checks; verify GitHub's refreshed state after pushing.

## Task CAL progress — Family Calendar

BRANCH: feat/web-family-calendar; WORKTREE: /Users/user/Desktop/bentley/fridgegraph-web-family-calendar
BASE: actual origin/main 64429d94054d6429f6492ce05cd4a6e0ccf16226 (fetched at task start).
TASK: week/day calendar UI on explicit v2-shaped mocks; real integration queued alongside W4.
LAYER: frontend + companion calendar contract/handoff.
TOUCHED: web/src/features/calendar/, web/src/features/personas/, web/src/features/rosina/,
  web/src/app/Shell.tsx, web/src/App.tsx, web/evidence/task-cal/,
  docs/contracts/family-calendar.md, docs/contracts/frontend-data.md,
  docs/contracts/ask-rosina.md, docs/handoff/HANDOFF.md.
DONE WHEN: npm run typecheck; npm run check; npm --prefix web test; npm --prefix web run build;
  desktop/mobile Playwright proof including Rosa and the Detroit DST week.
NOT DOING: server/schema/auth/DB, live queries against proposed SDL, merges/tags/releases.
BLOCKERS: Bentley's v2 event/holiday/busy reads are not delivered; no credential needed for mocks.

| Surface | UI | Backend (Bentley) | Integrated + tested |
|---|---|---|---|
| Calendar | complete on mocks | unavailable; Bentley v2 reads pending | mock adapter + UI tested; live NOT DONE |

Baseline actually run: typecheck PASS, secret scan clean, 88 web tests PASS, build PASS.
Mock identities/scenarios are fictional projections of coordination-v2's Cast/seed plan, not live
seed claims. Guardian authority is distinct from the parent flag. Busy projections contain no
reason, employer, other-child or other-household detail. No real authorization is implemented here.
Mock holiday dateStart/dateEnd are inclusive Detroit calendar dates; wire end semantics need
confirmation before live integration. Bryan confirmed inclusive calendar dates for the mock;
no backend wire boundary was guessed.


Task CAL mock verification (2026-10-30): root typecheck PASS; **117 web tests PASS** (88
baseline + 29 additions); production build PASS (existing >500 kB chunk advisory). Detroit
adapter/time suite: **13 PASS** under TZ=UTC and **13 PASS** under TZ=Pacific/Auckland.
Playwright production-preview proof: **5 persona flows PASS** (Kendra, Priya, Dana, Rosa,
Dwayne). Rosa has guardian authority, not a parent flag; Priya’s Nora/Malik scopes remain
separate. Missing confirmer/link/location details are explicit; busy reasons are stripped.
Screenshots and reproducible browser proof: web/evidence/task-cal/ (Rosa desktop/mobile,
DST week desktop/day mobile, Thanksgiving desktop). Corrected a genuine mobile navigation
overflow found during the browser check; no test assertions were weakened.

QUEUE ALONGSIDE W4: calendar live integration after Bentley’s v2 migrations/read operations.
Need authenticated event/category/status reads, weekly/holiday precedence and inclusive-date
wire confirmation, busy-only projections, guardian/schedule grants and readable linked-record/
confirmation metadata. Repeat exploration, persona boundaries, day/DST/holiday cases against
real services. Mock completion does not establish live authorization or backend correctness.
Source classification: fixture facts are unavailable as live data, view segmentation/care bands
are derived; no Task CAL surface is represented as live. No merge/tag/release performed.

Final staged secret guard: `npm run check` PASS, 281 files scanned, **0 findings**.
Diff scope reviewed: web/ plus companion docs only. Task CAL is ready for review on mocks;
UI complete · backend unavailable (Bentley) · mock integrated + tested / live NOT DONE.
