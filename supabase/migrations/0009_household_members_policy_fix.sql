-- 0009 — fix the self-referencing policy on household_members.
--
-- 0003 created:
--   using (person_id = current_person()
--          or household_id in (select household_id from household_members where person_id = current_person()))
-- That subquery selects the very table the policy protects, which Postgres rejects at RUNTIME
-- with 42P17 "infinite recursion detected in policy for relation household_members". It was never
-- hit before B3 because no signed-in client selected household_members; the graph now does on
-- every authorization check.
--
-- Fix: move "my households" into a SECURITY DEFINER helper (the same pattern `is_parent_of` and
-- `has_scope` already use). BYPASSRLS on the defining role means the helper reads the table
-- directly, so the policy no longer refers to itself. No policy is loosened: the rule is still
-- "my own row, or a household I belong to".
create or replace function my_household_ids() returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(m.household_id), '{}'::text[])
  from household_members m
  where m.person_id = current_person()
$$;

revoke all on function my_household_ids() from public;
revoke all on function my_household_ids() from anon;
grant execute on function my_household_ids() to authenticated;

drop policy if exists household_members_read on household_members;

create policy household_members_read on household_members for select to authenticated
  using (
    person_id = current_person()
    or household_id = any (my_household_ids())
  );
