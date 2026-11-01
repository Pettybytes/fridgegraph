-- 0072 — school_reports.reported_at: WHEN a report was filed, distinct from `at` (the school day
-- the report is ABOUT, unchanged since 0001).
--
-- Nullable, no default: existing rows and every historical/fixture row stay NULL forever — this
-- migration never backfills an invented filing time for a report nobody actually filed through the
-- write path. NULL means "time not recorded," not "filed at some unknown instant."
--
-- Server-owned, enforced in the database — not just omitted from the GraphQL input, which 0070's
-- own `school_reports_insert` RLS policy would otherwise let a direct authenticated PostgREST
-- insert bypass entirely. `auth.uid()` is set by PostgREST for the whole transaction regardless of
-- any SECURITY DEFINER role switch inside it (confirm_school_report, 0071, included), so this one
-- check correctly covers: a direct authenticated insert, `reportSchoolDay`'s own insert (#92), and
-- `confirm_school_report`'s insert — all three get a real `now()`, unconditionally overriding
-- whatever the caller supplied. `scripts/db.ts`'s seed/reset inserts use the service key, which
-- carries no end-user JWT at all, so `auth.uid()` is null there and this trigger does nothing —
-- reseeding a historical/fixture row never manufactures a filing time for it.

begin;

alter table school_reports add column if not exists reported_at timestamptz;

create or replace function _school_reports_stamp_reported_at() returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null then
    new.reported_at := now();
  end if;
  return new;
end $$;

drop trigger if exists school_reports_stamp_reported_at on school_reports;
create trigger school_reports_stamp_reported_at before insert on school_reports
  for each row execute function _school_reports_stamp_reported_at();

commit;
