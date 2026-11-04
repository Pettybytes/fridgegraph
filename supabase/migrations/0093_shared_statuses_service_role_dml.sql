-- 0093 — shared_statuses: grant DML to service_role so the demo seed/reset can write it.
--
-- DEFECT (2026-11-03, `npm run db:seed`): seed upserts through PostgREST as `service_role`.
-- 0076 granted SELECT/INSERT/UPDATE/DELETE to `authenticated` only; 0082 added SELECT for
-- `service_role`. The table therefore refused INSERT/UPDATE with 42501 and the seed aborted before
-- seeding the all-family history.
--
-- SCOPE — one grant on one table. No policy change, no RLS change, no new table. `service_role` is
-- the seed/reset writer (and already bypasses RLS by design); `authenticated` and `anon` are
-- untouched. `authenticated` keeps exactly 0076's policy-governed DML.
--
-- Catalog guard fails closed: if the table is missing, abort instead of granting blind.

begin;

do $$
begin
  if to_regclass('public.shared_statuses') is null then
    raise exception '0093: public.shared_statuses is missing';
  end if;
  if not exists (select 1 from pg_class c where c.oid = 'public.shared_statuses'::regclass and c.relrowsecurity) then
    raise exception '0093: shared_statuses does not have row level security enabled';
  end if;
end $$;

grant select, insert, update, delete on table public.shared_statuses to service_role;

comment on table public.shared_statuses is
  'Shared statuses. authenticated: policy-governed DML (0076). service_role: SELECT (0082) + '
  'INSERT/UPDATE/DELETE for the demo seed/reset (0093).';

commit;
