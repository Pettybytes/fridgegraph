# Evidence 74 — 0082: `service_role` SELECT on `shared_statuses` (STAGED, NOT APPLIED)

**Status:** staged for review. **Not applied to any live database.** Never merged.
**Change:** one statement — `grant select on table public.shared_statuses to service_role;`
**Number: 0082.** Evidence `73` belongs to PR #143 (W-DEPLOY-54e8abe); this file takes `74`.

## Allocation check (done before writing the file)

| Source | Highest / conflict | Result |
| --- | --- | --- |
| `origin/main` migrations | `0081_reset_demo_villager_provenance.sql` | 0082 free |
| Open PR #142 (`feat/web-today-mic`) | touches `HANDOFF.md` only | no migration |
| Open PR #141 (`feat/web-rosina-page`) | touches `HANDOFF.md` only | no migration |
| Open PR #68 (`feat/visual-identity`) | no migrations, no HANDOFF | no migration |
| HANDOFF | no mention of `0082`/`0083` | no reservation held |
| Any ref | `git log --all -- 0082*` → empty | no branch carries it |

`0082` was **not assumed free**; it was checked against main, every open PR, HANDOFF and all refs.

## What it fixes

`0076` grants `shared_statuses` to `authenticated` only. `service_role` consequently holds no SELECT — unlike `people`, `events` and `orbit_alerts`, which grant it full DML. `scripts/db.ts` reads every table in `TABLES` with the service key through PostgREST, and `shared_statuses` is in that list at `54e8abe`, so `npm run db:checksum` fails **HTTP 403** on exactly this table.

## Scope, deliberately narrow

- **SELECT only.**
- **`service_role` only.**
- `anon` and `authenticated` privileges untouched.
- Applied migration `0076` **not modified** — forward-only.

## Rehearsal — fg81, disposable, loopback-verified

Target verified **before** execution: `fg81` running, published **`127.0.0.1:55434` → 5432** (loopback only, recreated to that binding in W-DEPLOY-54e8abe), PostgreSQL 17.11, sole database `postgres`. A replica of 0076's grant posture was built (roles `anon`/`authenticated`/`service_role`, table with the same 6 columns and `text_shape` check, RLS **enabled and forced**, DML to `authenticated`, `revoke all` from `public`/`anon`/`service_role`).

**Setup was done as postgres. Every privilege assertion below was executed as a non-owner role**, never as postgres or the table owner.

| Step | Before | After |
| --- | --- | --- |
| `anon` select/insert/update/delete | false ×4 | false ×4 (unchanged) |
| `authenticated` select/insert/update/delete | true ×4 | true ×4 (unchanged) |
| `service_role` select | **false** | **true** |
| `service_role` insert/update/delete | false ×3 | **false ×3 (still refused)** |

Functional, as `service_role`: `select` from the table **succeeded and returned the row** (`p_dad|Changing a diaper`); `insert`, `update` and `delete` each returned **`ERROR: permission denied for table shared_statuses`**.

Functional, others: `authenticated` read **1 row** (grant intact); `anon` read **`permission denied`**.

A first pass returned `0` for `authenticated` — that was the replica's simplified predicate (`person_id = current_user`), not a privilege change. The predicate was relaxed to `true` and re-measured; the catalogue check was already decisive and is what the table above reports.

## LIMITATION — recorded, not glossed

**fg81 has no local PostgREST.** `db:checksum` reads through PostgREST at `SUPABASE_URL`, so it **cannot** be exercised against this rehearsal target. What is proven here is the **SQL privilege delta only**. **Full `npm run db:checksum` command verification remains PENDING the next window**, and must run against an endpoint verified to be the local environment before execution.

## What SELECT does NOT repair

`SELECT` does not repair the **service-role seed / upsert / delete paths**. Nothing here grants INSERT, UPDATE or DELETE to `service_role`; the rehearsal proves those are still refused. Today the reset and seed routines write as the caller, so this is not a live breakage — but making the checksum readable must not be read as making service-role writes work.

## Rollback

`revoke select on table public.shared_statuses from service_role;` — additive and reversible. Reverting returns `db:checksum` to HTTP 403 on this table.

## State

- PR staged, **not merged**, **not applied live**.
- No live database touched by this change; the only execution was inside disposable `fg81`.
- No tunnel, no dial, no SMS, no scopes, no permission widening.

---

## Corrections — superseding notes, 2026-11-02

Appended rather than rewriting the sections above, so the earlier wording stays visible and the
correction is auditable. **Where this section and anything above disagree, this section wins.**

1. **#143 is MERGED**, not pending. `W-DEPLOY-54e8abe` landed as **`c4d190c`** (2026-11-02T19:06:21Z).
   Any earlier reference to it being open is superseded.
2. **The allocation finding is "no migrations", not "HANDOFF only".** PR #141 and #142 contain **web
   changes** and also touch `HANDOFF.md`; the reason they do not consume `0082` is that **neither adds
   a migration**. The conclusion (`0082` free) is unchanged; the reason is corrected. #68 adds neither.
3. **A local PostgREST is optional, and only for an offline HTTP rehearsal.** It is **not a
   prerequisite for the apply.** Live `db:checksum` verification runs against the **intended Supabase
   PostgREST endpoint** in a freshly reserved window. Removing the earlier "pending a local
   PostgREST" framing: nothing about applying 0082 waits on a local endpoint.
4. **The maintenance-write statement above was wrong and is retracted.** The line "today they write
   as the caller" does not describe the two paths correctly:
   - the **canonical reset** uses its **own server-side PostgreSQL connection**;
   - **`scripts/db.ts` seed/reset** goes through **service-role PostgREST**.
   `SELECT`-only therefore leaves those **maintenance writes unresolved**, and that is the accurate
   statement. Neither is a live breakage claimed here; repairing either is a separate change with its
   own proof.
   - **Note on file state:** the applied-candidate migration file's inline comment still carries the
     superseded "write as the caller" wording. The SQL is **accepted unchanged** and was deliberately
     not edited; **this section supersedes that comment.**
5. **The rehearsal label stays narrow: SQL privilege proof only.** Stated once here rather than
   repeated throughout; the fg81 result proves the grant delta, not PostgREST or JWT behaviour.
6. **Map query pack corrected separately** (`docs/handoff/guide-map-inspection-queries.md`):
   `recorded_places` is household-scoped (0053, no `child_id`); the geometry helper is
   `place_route_geometry_for(p_child, p_place)` (0058); and `village_places_for_child(p_child)` (0075)
   — the function the map resolver actually calls — was missing and is now included.

---

## Comment-only correction to the migration file — 2026-11-02

The retracted sentence ("today they write as the caller") was removed from the migration's inline
comment. **The executable statement was not touched.**

| | |
| --- | --- |
| Executable GRANT | `grant select on table public.shared_statuses to service_role;` — line 28, **unchanged** |
| Diff scope | **comments only** (verified: `git diff` shows no `+`/`-` on any executable line) |
| Previous hash | `142cb8da1c4a4ad5d174a4ab0fb7e889e7e5862ab2e93fb5f05e034a4257e66b` |
| **New hash** | **`b32642abd3cc8665974905de03f25a2c101128f163fd44e28f66e5fd26f2a868`** |
| File state | **still unapplied** — no database has executed it |
| Rehearsal | **not re-run.** A comment-only edit cannot change SQL semantics, and repeating the fg81 run would imply new evidence where none exists. |

Replacement wording now states the two paths accurately: the canonical reset uses its **own
server-side PostgreSQL connection**, while `scripts/db.ts` seed/reset goes through **service-role
PostgREST** and remains ungranted.
