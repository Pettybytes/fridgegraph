-- 0041 — approval authority comes from the AUTHORITY FACT (household role) + the household's explicit
-- policy, per coordination-v2 §3. Not from a relationship label.
--
-- §3.3: a `resident_adult` lives in the household but holds NO default authority by residence alone.
-- Marcus (Vance–Reyes) is exactly that: his membership role is `resident_adult`. The earlier draft
-- banned `relationships.type = 'step_parent'` outright, which is a blanket rule the contract does not
-- contain and which would override an explicit household policy. Removed.
--
-- Roles that carry authority: 'parent', 'guardian' (0024 widened the check constraint).

create or replace function can_approve_swap(p_child text, p_proposer text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with hhs as (
    select household_id from household_members where person_id = p_child and role = 'child'
  ),
  authority as (
    -- The authority fact: a parent/guardian membership in any household the child lives in.
    -- resident_adult is deliberately absent: residence without authority (§3.3).
    select distinct hm.person_id
      from household_members hm
      join hhs on hhs.household_id = hm.household_id
     where hm.role in ('parent', 'guardian')
  ),
  me as (select 1 from authority where person_id = current_person()),
  rule as (select swap_approval_rule(p_child) as v),
  eligible as (select person_id from authority)
  select
    exists (select 1 from me)
    and case (select v from rule)
          when 'BOTH_PARENTS'    then current_person() <> p_proposer
          when 'GUARDIANS'       then current_person() <> p_proposer
          when 'ANY_PARENT'      then true
          when 'SINGLE_APPROVER' then (select count(*) from eligible) = 1
          else current_person() <> p_proposer
        end;
$$;

grant execute on function can_approve_swap(text, text) to authenticated;
