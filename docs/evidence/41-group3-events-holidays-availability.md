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
