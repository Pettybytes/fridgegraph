-- 0040 — approval policy is per household, read from `schedule_swap_approval`, and never inferred.
--
-- Policies:
--   BOTH_PARENTS     (default) the OTHER parent/guardian approves; the proposer never does.
--   GUARDIANS        guardians of record approve each other; the proposer never does.
--   ANY_PARENT       any parent/guardian in the household may approve (including the proposer).
--   SINGLE_APPROVER  when there is exactly one eligible approver, that person may approve their own
--                    proposal — otherwise a single parent could never approve anything.
--
-- A step-parent (relationship type `step_parent`, ACTIVE/APPROVED) is a resident adult but NEVER an
-- approver, whatever the policy says. That is the Vance–Reyes case.

begin;

create or replace function can_approve_swap(p_child text, p_proposer text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with hhs as (
    -- A child may live in more than one household (shared custody). Every one of them counts;
    -- assuming a single household is exactly the defect this replaces.
    select household_id from household_members where person_id = p_child and role = 'child'
  ),
  parents as (
    select distinct hm.person_id
      from household_members hm
      join hhs on hhs.household_id = hm.household_id
     where hm.role in ('parent', 'guardian')
  ),
  me as (select 1 from parents where person_id = current_person()),
  is_step as (
    select 1 from relationships r
     where r.from_id = current_person() and r.to_id = p_child
       and r.type = 'step_parent' and r.status in ('ACTIVE', 'APPROVED')
  ),
  eligible as (
    select p.person_id from parents p
     where not exists (
       select 1 from relationships r
        where r.from_id = p.person_id and r.to_id = p_child
          and r.type = 'step_parent' and r.status in ('ACTIVE', 'APPROVED')
     )
  ),
  rule as (select swap_approval_rule(p_child) as v)
  select
    exists (select 1 from me)
    and not exists (select 1 from is_step)
    and case (select v from rule)
          when 'BOTH_PARENTS'    then current_person() <> p_proposer
          when 'GUARDIANS'       then current_person() <> p_proposer
          when 'ANY_PARENT'      then true
          when 'SINGLE_APPROVER' then (select count(*) from eligible) = 1
          else current_person() <> p_proposer
        end;
$$;

grant execute on function can_approve_swap(text, text) to authenticated;

-- Policies per household. Additive rows only; Ellison keeps BOTH_PARENTS explicitly.
insert into household_policies (household_id, rule, value)
values
  ('h_a',    'schedule_swap_approval', 'BOTH_PARENTS'),
  ('h_emma', 'schedule_swap_approval', 'GUARDIANS'),
  ('h_taylor','schedule_swap_approval','BOTH_PARENTS'),
  ('h_micah','schedule_swap_approval', 'ANY_PARENT'),
  ('h_malik','schedule_swap_approval', 'SINGLE_APPROVER')
on conflict (household_id, rule) do update set value = excluded.value;

commit;
