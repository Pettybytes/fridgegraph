-- 0070 — school.report: the write half of SchoolReport.
--
-- `school_reports` has existed since 0001 and was readable (0003: is_parent_of OR school.read) but
-- had no INSERT path at all: no table-level INSERT grant to `authenticated`, and no RLS policy,
-- so even a caller with school.read could never create a row. This closes exactly that gap for one
-- new, narrower scope — `school.report` — so a teacher can file a school-day report that a parent
-- then reads back through the existing school.read-gated query. It does not touch school.read,
-- does not touch permission_slips, and does not let a parent file their own child's report: a
-- parent already reads every report through is_parent_of; filing one is a distinct, staff-side
-- authority, so this policy checks has_scope() only, same as `src/subgraphs/school.ts`'s resolver.

begin;

grant insert on school_reports to authenticated;

create policy school_reports_insert on school_reports for insert to authenticated
  with check (has_scope(child_id, 'school.report'));

commit;
