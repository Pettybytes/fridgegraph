-- 0024_authority_model.sql
--
-- Group 2 / E1 — the four-fact authority model (contract §3). Forward-only. 0001-0023 never edited.
--
-- Relationship (relationships.type) stays descriptive. Residence is household_members.role.
-- Approval authority is the ONE thing widened here: 'guardian' joins 'parent', and a new
-- 'resident_adult' value records residence WITHOUT default authority.
--
-- Four direct edits, exactly as the contract specified:
--   1. household_members.role check widened (additive: existing rows satisfy the old set)
--   2. is_parent_of()      role = 'parent' -> role in ('parent','guardian')
--   3. parent_ids_of()     role = 'parent' -> role in ('parent','guardian')
--   4. src/authz.ts        .eq('role','parent') -> .in('role',['parent','guardian']) (two sites)
--
-- Everything that calls these functions inherits the widening; nothing else is edited.
-- 'resident_adult' is deliberately NOT in either IN-list: residence alone grants nothing.

begin;

alter table household_members drop constraint if exists household_members_role_check;
alter table household_members
  add constraint household_members_role_check
  check (role in ('parent', 'guardian', 'resident_adult', 'child'));

create or replace function is_parent_of(child text)
returns boolean language sql
stable security definer set search_path = public as $$
  select exists (
    select 1
    from household_members child_m
    join household_members caller_m on caller_m.household_id = child_m.household_id
    where child_m.person_id = child and child_m.role = 'child'
      and caller_m.person_id = current_person()
      and caller_m.role in ('parent', 'guardian')
  )
$$;

create or replace function parent_ids_of(child text)
returns text[] language sql
stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct m.person_id), '{}'::text[])
  from household_members m
  where m.role in ('parent', 'guardian')
    and m.household_id in (
      select cm.household_id
      from household_members cm
      where cm.person_id = child and cm.role = 'child'
    )
    and is_parent_of(child)
$$;

comment on column household_members.role is
  'Residence role: parent | guardian (both carry approval authority) | resident_adult (residence '
  'only, no default authority) | child.';

commit;

-- ROLLBACK (not applied):
--   alter table household_members drop constraint if exists household_members_role_check;
--   alter table household_members add constraint household_members_role_check
--     check (role in ('parent','child'));
--   is_parent_of / parent_ids_of: restore the 0003 / 0010 definitions (role = ''parent'').
