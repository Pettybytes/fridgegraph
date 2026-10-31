-- 0029 — service_role privileges on the tables 0027/0028 created.
--
-- WHY: 0004 ran `grant select on all tables` and the per-table writes BEFORE these tables existed,
-- and Postgres does not carry a grant forward to objects created later. The seed uses the service
-- role, so seeding the SIMULATED fixture failed with 42501 on `holidays`. The same gap would hit any
-- future fixture or migration helper. This grants only what seeding needs, on only the new tables.
--
-- This is NOT an authorization change for callers: `authenticated` still reaches these tables
-- through RLS policies, and service_role bypasses RLS by design (it never runs on behalf of a
-- caller).

begin;

grant select, insert, update, delete on
  routines,
  holidays,
  adult_availability,
  holiday_arrangements
to service_role;

commit;
