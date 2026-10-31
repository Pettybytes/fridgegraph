-- 0047 — Stage 1 consent records ONE decision per permission slip.
--
-- 0046 indexed (subject_type, subject_id, approver_id), so it only stopped the same approver from
-- double-recording. Two different approvers could each insert an approval for the same slip, which
-- is not "one decision per slip". Stage 1 is single-approver: the decision is recorded once.
-- The new index is stricter, so it supersedes 0046's index and that one is dropped.
--
-- Also required for this feature and missed by 0046: 0028 constrained approvals.subject_type to
-- ('Relationship','Grant','HolidayArrangement'), and the constraint is enforced on new rows even
-- though it is NOT VALID (not retro-validated). Without widening it, a permission-slip approval
-- cannot be inserted at all. Same replacement pattern 0028 used.
--
-- Pre-flight against the live project: approvals had 0 rows and 0 permission_slip rows, so no
-- existing data can violate the new unique index. Verified in HANDOFF with the query result.

do $$
declare cname text;
begin
  select conname into cname
    from pg_constraint
   where conrelid = 'approvals'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) like '%subject_type%';
  if cname is not null then
    execute format('alter table approvals drop constraint %I', cname);
  end if;
  alter table approvals add constraint approvals_subject_type_check
    check (subject_type in ('Relationship','Grant','HolidayArrangement','permission_slip')) not valid;
end $$;

create unique index if not exists approvals_permission_slip_decision
  on approvals (subject_type, subject_id)
  where subject_type = 'permission_slip';

drop index if exists approvals_permission_slip_once;
