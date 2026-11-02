-- 0082 — service_role SELECT on shared_statuses (checksum read path only).
--
-- WHY THIS EXISTS
-- 0076 grants `shared_statuses` to `authenticated` only. `service_role` therefore holds no SELECT
-- on it — unlike `people`, `events` and `orbit_alerts`, which grant it full DML. `scripts/db.ts`
-- reads every table in `TABLES` with the service key through PostgREST, and the revision merged at
-- `54e8abe` adds `shared_statuses` to that list, so `npm run db:checksum` fails HTTP 403 on this
-- one table while every other table reads normally.
--
-- SCOPE, DELIBERATELY NARROW
-- SELECT only. To `service_role` only. `anon` and `authenticated` privileges are untouched, and
-- applied migration 0076 is NOT modified — this is forward-only.
--
-- WHAT THIS DOES *NOT* FIX
-- SELECT does not repair the service-role seed/upsert/delete paths. The reset and seed routines
-- that write `shared_statuses` do not gain INSERT/UPDATE/DELETE here and would still be refused if
-- they ever ran as `service_role`; today they write as the caller. Repairing writes is a separate
-- decision with its own proof, not a side effect of making the checksum readable.
--
-- ROLLBACK
-- `revoke select on table public.shared_statuses from service_role;` — additive and reversible,
-- but note that revoking it returns `npm run db:checksum` to HTTP 403 on this table.
begin;

grant select on table public.shared_statuses to service_role;

commit;
