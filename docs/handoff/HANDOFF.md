# FridgeGraph — HANDOFF

_Last updated: Oct 26, 2026 (late). Written under context pressure — read §9 before trusting any state._

## 1. State

- **HEAD:** `d6e583f` (B0+B1 green). Working tree carries the uncommitted B2 work described in §9.
- **Runtime source of truth:**
  - `village`, `access`, `coordination`, `schedule`, `school`, `transport`, `activities` → **ALL still `src/fixtures.ts` in memory.** No subgraph reads Postgres yet.
  - Supabase → seeded, RLS-enforced, but **only read by scripts/ops**, not by the graph.
- **Last measured results**
  - Graph suite: **31/31** at `DEMO_CLOCK=1` and `DEMO_CLOCK=0` (measured at `d6e583f`, before B2; subgraph code unchanged since).
  - RLS proofs: `docs/evidence/17-supabase-rls.md` (8/8), `docs/evidence/18-rls-gaps.md` (14/14 paired).
  - Edge auth: `docs/evidence/15`, `16` (tampered → 401 `AUTH_ERROR`; missing → `UNAUTHENTICATED`).
  - B2: `docs/evidence/19-b2-persistence.md` — **contains 2 stale FAIL rows** (see §9).
- **Last green:** `d6e583f` for A+B0/B1. B2 partially verified.

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

## 9. Decisions, mixed state, and what is NOT done

- **B2 status:** migration `0007`, `scripts/db.ts`, npm scripts done; seed idempotency proven (**28 tables, 157 rows, identical checksums**); reset deleted the temp grant/relationship and restored the care plan; sentinel survived; double reset a no-op; `village_event` → Kendra 1, Chris 0.
- **Two FAIL rows in `19-b2-persistence.md` are stale text**, not live failures: Dana legitimately keeps baseline `r_dana_friend_parent` (`DISCOVERED`). The corrected assertion (grants 0, status DISCOVERED only) was patched in `ops/b2-proof.mjs` but the re-run did not finish writing the file. **Re-run `node ops/b2-proof.mjs` and commit the refreshed file.**
- **B3, B4, B5, Section C: not started.** No subgraph reads Postgres; `src/fixtures.ts` remains the runtime source for all seven.
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
