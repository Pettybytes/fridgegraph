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
