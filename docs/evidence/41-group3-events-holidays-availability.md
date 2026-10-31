# Evidence 41 — Group 3: event status, holidays, adult availability (data layer)

_Task E-NEXT, sub-task 3. Branch `feat/e-next-group3` off `main` `1cd7ab8`. Migration **0027**
(`0027_events_holidays_availability.sql`), applied. Read layer (GraphQL + MCP) is the next increment
of this same PR._

## What 0027 adds

| Object | Purpose |
|---|---|
| `events.status` | `proposed` / `confirmed` / `cancelled`, default `confirmed`, CHECK constraint |
| `routines` | weekly routine definitions (per child, `weekdays` + start/end time); Group 4 seeds ~24 |
| `holidays` | per-child holiday range with `end_date >= start_date`; **both ends inclusive** |
| `holiday_covers(child, day)` | inclusive range test used by everything else |
| `day_kind(child, day)` | `HOLIDAY` (precedence) / `SCHOOL_DAY` / `WEEKEND` |
| `day_routines(child, day)` | the routines that apply on a day — **none** on a holiday |
| `adult_availability` | `BUSY`/`FREE` per person, with a **private** `reason` |
| `adult_availability_free_busy` | view projecting **state only**; sharing rule inside the view |

## Decisions that matter

- **Holiday precedence is in the function, not the caller.** `day_routines()` returns zero rows on a
  holiday even when the weekday matches, so no read can accidentally show a school routine on a
  holiday. `day_kind()` reports `HOLIDAY` first.
- **Inclusive end dates** are asserted at both edges: the day before and the day after are not
  covered, the first and the last day are.
- **RLS filters rows, not columns.** A policy that lets another adult read `adult_availability` would
  hand them `reason` too. So the base table is **owner-only** and sharing goes through the view,
  which has no reason column at all. The view's read is revoked for writes (a simple view can be
  auto-updatable in Postgres, so this is explicit).
- **Grants are not inherited.** `0004` granted privileges on the tables that existed then; new tables
  need their own grants or every caller gets `42501` before RLS is consulted. The dry run caught
  exactly that, and 0027 now grants `select` on the three tables and `execute` on the four functions.
- **The guide is read-only here too**: three restrictive policies per new table
  (`insert`/`update`/`delete`), separate commands because a restrictive `SELECT` would cancel the
  guide's read policy.

## Dry run — `node ops/0027-dry-run.mjs` — 18/18 PASS, transaction rolled back

| # | Check |
|---|---|
| 1 | new event defaults to `confirmed`; an unknown status is rejected (savepoint, so the expected failure cannot poison the transaction) |
| 2 | holiday range 25–27 Nov: 24 ✗, 25 ✓, 26 ✓, **27 ✓ (inclusive)**, 28 ✗ |
| 3 | routine applies on a normal Wednesday; **no** routine on a Wednesday inside the holiday; `day_kind` = HOLIDAY / SCHOOL_DAY / WEEKEND |
| 4 | owner reads her own row; another adult reads **0** base rows (reason private) but sees `BUSY` through the view; the view has no `reason` column; an adult outside the village sees nothing; the guide sees the sandbox row (state only) |

Caller identity in the dry run is a real `request.jwt.claims` (sub + `app_metadata` markers for the
guide) with `set local role authenticated` — the same path `current_person()` and `is_demo_guide()`
use. No test hook exists in product code.

## Applied — verified by `node ops/0027-apply.mjs`

`events.status` present; `routines` / `holidays` / `adult_availability` have RLS on with 5 / 5 / 2
policies; view columns are exactly `id, person_id, start_at, end_at, state`; `authenticated` has
EXECUTE on all four functions.

## Still to do in this PR (not claimed)

- GraphQL reads: `childEvents(childId, from, to)` (status-filtered, cancelled excluded by default) and
  `adultAvailability(personId, from, to)` returning **state only**.
- MCP operations `ChildEvents` and `AdultAvailability` with the **same no-oracle contract** as the
  Rosina tools (hidden == nonexistent == malformed).
- Persona-boundary proofs on both surfaces (Kendra sees, Priya/Loretta per grant, Dana refused as a
  known caller, guide read-only + sandbox).
- A minimal SIMULATED fixture for a holiday + a routine + one availability row so the reads have
  something to show (kept out of the v1 baseline, same separation as the coordination fixture).
- 0026 guide-seam re-check for any derived read introduced here.

## Hard stops held

No dialing, no SMS, no dispatch, no flag set, no new persisted authorization, no service-role read on
behalf of a caller, no merge.

---

## Correction — 0027 conflated a school closure with a parenting-time arrangement

Forward-only fix in **0028** (`0028_holiday_arrangements.sql`, applied). 0027 is never edited.

| Concept | Where it lives now | What it does |
|---|---|---|
| **School closure** | `holidays` + `day_kind()` → `SCHOOL_CLOSURE` | the calendar is closed; suppresses **SCHOOL_DAY routines only** and says nothing about who has the child |
| **HolidayArrangement** | `holiday_arrangements` (new) | an agreed, bounded change of parenting time; only `APPROVED` overrides the weekly rule, only inside its inclusive interval |
| Routine applicability | `routines.applies_on` (`SCHOOL_DAY` \| `ANY_DAY`, default `ANY_DAY`) | bedtime survives a closure; the school run does not |

`_is_approver_for` now delegates to `effective_schedule_for()` (definition inspected, not called — it
stays revoked from `authenticated`), and `src/derive.ts#approverForChild` uses the same function via
RPC, so pickup and the approver read follow an approved arrangement and are unchanged everywhere no
arrangement exists.

**HolidayArrangement** has exactly the contract's shape: `id, child, holidayName (nullable for a
one-off swap), dateStart, dateEnd (both inclusive), assignedParent, pickupDutyParent,
dropoffDutyParent, status PROPOSED/APPROVED/DECLINED, proposedBy, approvalId`, plus RLS (parent/
guardian or `schedule.read`, guide sandbox read-only) and a **table-level trigger** so no update path
can approve a swap on the proposer's own authority.

`schedule_conflicts(child, from, to)` returns `OVERLAP` rows (two approved arrangements covering one
day) and `GAP` rows (no rule assigns a parent). It surfaces; it never resolves.

Approval follows `household_policies.schedule_swap_approval`, default **BOTH_PARENTS** — the other
parent/guardian, never the proposer, never a grant.

## Dry run — `node ops/0028-dry-run.mjs` — 20/20 PASS, rolled back

| # | Check |
|---|---|
| 1 | closure suppresses the `SCHOOL_DAY` routine; **bedtime (`ANY_DAY`) survives**; both apply on a normal Wednesday; `day_kind` = `SCHOOL_CLOSURE` |
| 1 | adult availability is recorded and readable **independently** of the closure |
| 2 | `PROPOSED` arrangement does **not** override (WEEKLY/p_mom); `APPROVED` applies 25, 26 **and 27 (inclusive)**; 28 returns to WEEKLY; 24 unchanged |
| 2 | `_is_approver_for` delegates to `effective_schedule_for` and stays internal; the approver on the arrangement day is Andre, on a normal Wednesday still Kendra |
| 3 | overlapping approved arrangements surface as `OVERLAP`; a day no rule covers surfaces as `GAP` |
| 4 | the proposer cannot approve her own swap; the policy defaults to `BOTH_PARENTS`; the other parent can approve |

## PENDING in this PR (deliberately not claimed as implemented)

- **GraphQL reads** `childEvents(childId, from, to)`, `adultAvailability(personId, from, to)`,
  `effectiveScheduleFor(childId, date)`, `scheduleConflicts(childId, from, to)` — PENDING.
- **MCP operations** `ChildEvents`, `AdultAvailability` (+ `EffectiveSchedule` if ready) with the
  same no-oracle contract — PENDING.
- **Availability wording** (required in the GraphQL field description AND the MCP tool description):
  FREE means *recorded free time*, **not** confirmed willingness or permission to care for a child.
  Rosina must say "has free time recorded" and never "is available to watch" / "can pick up".
  Recorded here because the field and tool do not exist yet — it lands with them.
- Persona-boundary proofs on both surfaces, the SIMULATED holiday/routine/availability fixture, and
  the 0026 guide-seam re-check for any derived read — PENDING.

---

## Read layer — DONE (GraphQL + MCP)

| Surface | Reads |
|---|---|
| GraphQL (`schedule` subgraph) | `childEvents(childId, from, to, includeCancelled)`, `adultAvailability(personId, from, to)`, `effectiveScheduleFor(childId, date)`, `scheduleConflicts(childId, from, to)` |
| MCP (`5051`) | `ChildEvents`, `AdultAvailability`, `EffectiveSchedule` — `tools/list` now returns six tools, none writable |

**Availability wording is in the schema itself** (GraphQL field description) **and in the MCP
operation file**: FREE means *recorded free time*, NOT confirmation of willingness, permission, or
suitability to care for a child, and never "can pick up". The projection contains no `reason`
column at all — the view masks it structurally, not by convention.

### Proof — `node ops/mcp-group3-proof.mjs` — 24/24 PASS

Surfaces: GraphQL through **router 4012** (alt stack, subgraphs 4101–4107 running this checkout) and
**MCP 5051 → 4012**.

| # | Check |
|---|---|
| 0 | MCP exposes `ChildEvents`, `AdultAvailability`, `EffectiveSchedule`; no mutation tool |
| 1 | Kendra reads the calendar; no cancelled entry appears; the confirmed baseline event carries `status`; 25 Nov is `ARRANGEMENT`/`p_dad`, 24 Nov `WEEKLY`/`p_mom`, 28 Nov back to `WEEKLY`; her own Busy window is readable and the payload contains **no reason** |
| 2 | Andre (co-parent) sees `BUSY` and still no reason; the guide reads the sandbox calendar and state only |
| 3 | Dana is a **known** caller (`UNAUTHORIZED`, not `UNAUTHENTICATED`) and **hidden == nonexistent == malformed** child ids return identical payloads |
| 4 | MCP: `ChildEvents` returns rows, `EffectiveSchedule` says `ARRANGEMENT`, `AdultAvailability` is Busy/Free only, no reason |
| 5 | MCP: Dana known, hidden == nonexistent == malformed, no event rows |
| 6 | no token → `UNAUTHENTICATED` |

### SIMULATED calendar fixture (kept out of the v1 baseline)

`src/fixtures-simulated.ts#createSimulatedCalendar()` — closure 25–27 Nov, `rt_nora_school_run`
(`SCHOOL_DAY`) + `rt_nora_bedtime` (`ANY_DAY`), one Busy window with a private reason, and two
approved arrangements (one deliberate overlap). Seeded with
`npx tsx scripts/db.ts seed:simulated`, checksummed with `checksum:simulated`:

| Table | Rows | SHA-256 (16) |
|---|---|---|
| `coordination_jobs` | 1 | `3e221662b46f5903` |
| `attempts` | 2 | `8e3fbbc30dfe618d` |
| `holidays` | 1 | `9ab32286f5018a76` |
| `routines` | 2 | `c00c7c4b24e551f8` |
| `adult_availability` | 1 | `ede67c9175fe4e96` |
| `holiday_arrangements` | 2 | `37e5d0d4a26d8f06` |

**Baseline impact:** the fixture writes to those six tables only. `events` is the one non-fixture
table whose checksum moved, and it moved **because 0027 added the `status` column** — the row count
is unchanged (1) and the row is the same baseline event (the proof reads it as `School`, `confirmed`).
No fixture rows are written into a baseline table that already had data; an earlier attempt that did
so was removed, which is why the fixture no longer seeds events.

### 0029 — grants the seed exposed

Seeding failed with `42501` on `holidays`: `0004` granted privileges before these tables existed and
Postgres does not carry a grant forward. `0029_service_role_grants.sql` grants `service_role`
`select/insert/update/delete` on the four new tables only. It is not an authorization change for
callers — `authenticated` still reaches them through RLS.

### Still PENDING (never claimed as implemented)

- The `includeCancelled` filter is exercised by the resolver and by the absence of cancelled rows in
  the response, but **no cancelled row is seeded** (that would touch the baseline `events` checksum).
  Proving it needs a fixture strategy that does not write into `events` — recorded, not claimed.
- The 0026 guide-seam re-check for these reads: `childEvents` is a direct RLS table read, while
  `effectiveScheduleFor`/`scheduleConflicts` are SECURITY DEFINER functions that authorize through
  `authorizeChild` first; the guide path is covered by the proof above (it reads sandbox data), but
  a dedicated seam audit is PENDING.

---

## Additive fixture rule — adopted, and the two PENDING items are CLOSED

The earlier rule ("never write into a table that already has baseline data") is replaced by a
provable contract:

1. fixture rows MAY be added to existing tables;
2. baseline rows are never rewritten;
3. fixture rows are identifiable — `fixture boolean not null default false` (migration **0030**) on
   `events`, `coordination_jobs`, `attempts`, `holidays`, `routines`, `adult_availability`,
   `holiday_arrangements`, plus the `fx_` identifier prefix on tables without a marker column;
4. the fixture keeps its own checksum;
5. cleanup removes exactly the fixture rows and restores the baseline checksum byte-for-byte.

### Proof — `node ops/fixture-rule-proof.mjs` — 6/6 PASS

| # | Check | Result |
|---|---|---|
| 1 | fixture seeds into existing tables | jobs 1, attempts 2, holidays 1, routines 2, availability 1, arrangements 2, events 2, households 1, people 2, children 1, members 2 |
| 2 | baseline event row survives (row count grew by fixture rows only) | 1 → 3 |
| 3 | every fixture row is identifiable + has its own checksum | PASS |
| 4 | cleanup removes rows | events 2, attempts 2, jobs 1, arrangements 2, availability 1, routines 2, holidays 1, members 2, children 1, households 1, people 2 |
| 5 | **baseline checksum byte-identical after cleanup** | `identical` (29 tables / 162 rows) |
| 6 | no fixture row survives cleanup | all `0` |

### `includeCancelled` proven with real data (was PENDING)

A cancelled event `fx_ev_nora_recital_cancelled` is a marked fixture row on a sandbox child. The
default `childEvents` read hides it; `includeCancelled: true` returns it. Both assertions run in
`ops/mcp-group3-proof.mjs`.

### 0026 guide-seam audit with a NON-sandbox record (was PENDING)

`fx_audit_hh` is a **non-sandbox** household in `v_nora` with its own parent, child and a confirmed
event (`Private appointment`). The Demo guide belongs to no household and reads sandbox data, so the
only thing that can refuse it here is the sandbox flag:

- guide → `childEvents(childId: "fx_audit_child")` = **`UNAUTHORIZED`**, and the event title never
  appears in the response;
- guide → `childEvents(p_nora)` still returns sandbox rows, and `adultAvailability(p_mom)` still
  returns state only (no reason).

`ops/mcp-group3-proof.mjs` is now **26/26 PASS** on router **4012** and MCP **5051 → 4012**.

**No PENDING items remain in Group 3.** The only open thread is Group 4's per-household approval
policy (recorded in HANDOFF).
