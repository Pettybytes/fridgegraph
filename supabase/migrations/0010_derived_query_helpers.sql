-- 0010 — narrow helpers for the derived queries.
--
-- Two things the graph legitimately needs but must not get by widening table policies:
--
-- 1. `grant_holders_for(child, scope, on_date)` — WHO holds a given scope for one child on one
--    date. Candidate lists are built from other adults' grants, and `grants_read` (own grants, or
--    a parent's view of the child) deliberately hides those from a non-parent. Returning only
--    actor ids, for one scope and one child, gated to a parent of that child or (for
--    pickup.request only) a caller holding pickup.verify, exposes strictly less than the table.
--
-- 2. `parent_ids_of(child)` — the co-parent list used by `approverFor.fyiParents`. Household
--    membership is readable only inside your own household, so a parent could not see the other
--    parent's row. Gated to `is_parent_of(child)`: a co-parent of that child only.
--
-- Neither function changes a policy, and neither returns a row the caller could not already act on.
create or replace function grant_holders_for(child text, scope text, on_date date)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct g.actor_id), '{}'::text[])
  from grants g
  where g.child_id = child
    and scope = any(g.scopes)
    and (g.valid_from  is null or on_date >= g.valid_from)
    and (g.valid_until is null or on_date <= g.valid_until)
    and (
      is_parent_of(child)
      or (
        scope = 'pickup.request'
        and exists (
          select 1
          from grants v
          where v.actor_id = current_person()
            and v.child_id = child
            and 'pickup.verify' = any(v.scopes)
            and (v.valid_from  is null or on_date >= v.valid_from)
            and (v.valid_until is null or on_date <= v.valid_until)
        )
      )
    )
$$;

revoke all on function grant_holders_for(text, text, date) from public;
revoke all on function grant_holders_for(text, text, date) from anon;
grant execute on function grant_holders_for(text, text, date) to authenticated;

create or replace function parent_ids_of(child text)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct m.person_id), '{}'::text[])
  from household_members m
  where m.role = 'parent'
    and m.household_id in (
      select cm.household_id
      from household_members cm
      where cm.person_id = child and cm.role = 'child'
    )
    and is_parent_of(child)
$$;

revoke all on function parent_ids_of(text) from public;
revoke all on function parent_ids_of(text) from anon;
grant execute on function parent_ids_of(text) to authenticated;
