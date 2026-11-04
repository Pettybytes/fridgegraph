# Contract — data model

Covers `schema/`, `supabase/`, `scripts/db.ts`, `src/fixtures.ts`, and every read/write that reaches Postgres.

## 1. The single most important fact

**All worktrees share one live Supabase database.**

A seed, reset, migration or mutation run in any worktree is immediately visible to every other agent, every other branch, and every running subgraph. There is no per-branch database and no sandbox copy.

Consequences:

- Never run `npm run db:reset` because *your* tests need a clean slate. Other people are using it. Ask first.
- Never apply a migration to test it. Write it, prove it locally, and report — applying is a coordinated action.
- Any data you create for a test, you delete in the same run. Leave no rows behind.
- If a proof needs a row that is not in the seed baseline, seed it and **clean it up**, and say both in the evidence.

## 2. Ownership

Every subgraph writes **only its own tables**. Cross-table reads happen through the graph, not by reaching into another owner's tables.

| Subgraph | Port | Owns |
| --- | --- | --- |
| village | 4001 | `person`, `child`, `village`, `household`, `household_members`, `relationships`, `contact_methods`, `capabilities`, `groups`, `memberships`, `goals`, `care_plan`, `village_event`, `fridge_notes` (Phase 2, migration `0083`, STAGED — see `docs/contracts/fridge-notes.md`) |
| access | 4002 | `grants`, `approvals`, `household_policies`, `parenting_schedules` |
| coordination | 4003 | `coordination_jobs`, `attempts`, `information_requests`, `confirmations` |
| schedule | 4004 | `events` |
| school | 4005 | `school_reports`, `permission_slips` |
| transport | 4006 | `bus_roster`, `vehicles` |
| activities | 4007 | `practices`, `group_events` |

`approveRelationship` (village) must also write an `approvals` row, which `access` owns. Federation has no cross-subgraph transaction; this is the **single** intentional cross-table write, and it is why the access layer exposes one approval-recording helper. Do not add a second one without a decision recorded here.

**Second recorded decision — `confirmAddVillager` (access), migration 0074.** This writes
`relationships` (village-owned) AND `grants`+`approvals` (access-owned) atomically. It is
NOT application code in one subgraph reaching into another's table — `access`'s resolver makes
exactly one `rpc()` call into a single `SECURITY DEFINER` Postgres function
(`confirm_add_villager`), which performs both writes inside one real database transaction. The
TypeScript ownership boundary (no subgraph's resolver code touches another's table directly) is
unchanged; only the database-level transaction now spans two owners' tables, mediated entirely by
one function. Same shape as `propose_school_report`/`confirm_school_report` (0071), which is
single-table and so didn't need this note. A third such function should record its own decision
here too, rather than being assumed pre-approved by these two.

## 3. Migrations

- Migrations live in `supabase/migrations/` and are **append-only**. Never edit an applied migration — the database already ran it.
- One logical change per migration. Name it for the outcome, not the mechanism.
- **Migration catalog:** through `0098` on main; `0099_showcase_calendar_care.sql` is staged in
  this calendar PR (not evidence of live application). It adds nullable weekly handoff time/place,
  preserves approved-holiday precedence, and includes composite-key parenting schedules in the
  owner-only atomic demo restore. Rehearse and apply forward-only before rolling this seed.
- Policy rule learned the hard way: **never put a table's own `SELECT` inside its own RLS policy** — it raises `42P17` at runtime. `0009` (`my_household_ids()`) exists for that reason.
- RLS legitimately hides rows that a derived query needs (grants, co-parent membership, relationship types). The fix is a narrow `SECURITY DEFINER` helper (`0008`, `0010`), **never** widening a policy.

## 4. Authorization layers

1. **Subgraph field-level authorization** — the real boundary, enforced per resolver in `src/authz.ts`. Denied field returns `null` plus `UNAUTHORIZED`.
2. **RLS** — the second boundary, evaluated for `current_person()` through a per-request client.
3. **Router JWT** — an *earlier rejection point only*, and it does not stop a **missing** token at all. Never treat the edge as the boundary.

Scope table is authoritative in `docs/schema-plan.md` and must stay mirrored in code. A change to one without the other is a defect.

## 5. Identity

- Supabase proves **who**; `grants` and household policies decide **what they may do**. Never conflate them.
- `sub` → `personId` via a server-side, gitignored map loaded at startup. Email is never identity. A client-sent person id is never trusted.
- Bad/absent identity → `UNAUTHENTICATED`. Verified identity lacking scope → `UNAUTHORIZED`. Keep the two distinct; the suite depends on it.

## 6. Seeds, reset, checksums

- Showcase calendar seed: all ten children across six families have seven-day responsibility,
  weekly handoffs, recorded availability and a Veterans Day arrangement. `createShowcaseCalendar()`
  is shared by operator seed and demo reset; availability is not permission or willingness to care.
- `npm run db:seed` — idempotent. Proven twice with byte-identical per-table checksums (**28 tables, 157 rows**).
- `npm run db:reset` — removes only non-baseline rows by an id-based boundary. A sentinel outside the boundary survives; a double reset is a no-op. **Shared-database operation — see §1.**
- `npm run db:checksum` — use it to prove you changed nothing you did not mean to.
- `scripts/db.ts` legitimately imports `createSeed` to build the baseline. That is its only remaining purpose.

## 7. Dates

- "Today" is computed in `APP_TIME_ZONE` (default `America/Detroit`), **never** from `toISOString()`. A UTC-derived date expired a same-day grant after 20:00 local.
- `DEMO_CLOCK` is a test clock only; no evidence case requires it.
- Ages are computed, never stored.
- `/__reset` re-seeds from the fixtures the **process loaded at startup** — after editing `src/fixtures.ts`, restart the stack or you will restore old values.

## 8. `src/store.ts`

**It does not exist.** It was deleted when the last subgraph moved to Postgres. Any doc, prompt or comment describing an in-memory store is stale. Reads go through a per-request Supabase client authenticated with the caller's token — the service key is never used in request handling.

### Effective schedule RPC authorization (0100)

`effective_schedule_for` checks its caller inside the SECURITY DEFINER function, before
reading schedule or handoff data. A mapped identity must be a parent/guardian (`is_parent_of`),
hold a current `schedule.read` grant, or pass `guide_reads_child` (verified guide identity and
sandbox child). The mapped guide identity cannot use ordinary grants to read private families.
A legitimate cross-family grant for an ordinary caller remains valid; household membership alone is
not the authorization rule. Anonymous, unmapped and unauthorized callers are refused. The
repair grants no write permissions and preserves approved-holiday precedence over weekly care.

Apply 0100 forward-only after 0099. If 0099 has not reached the shared database, rehearse and
apply the two in sequence so its unguarded RPC is not left exposed. Never edit applied 0099.
