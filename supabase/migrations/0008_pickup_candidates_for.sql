-- 0008 — narrow relationship read for pickup candidates.
--
-- Why: `relationships_read` is parent-only, but `pickupCandidates` / `Person.vehicles` are also
-- available to a caller holding pickup.verify for that child. Computing the candidate list needs
-- (from_id, type) for ACTIVE relationships to ONE child — nothing else.
--
-- This function answers exactly that question and nothing wider: no ids of other children, no
-- contact data, no history. The `relationships` table policy is unchanged, so a pickup.verify
-- holder still cannot read the relationship graph or any other child.
create or replace function pickup_candidates_for(child text, on_date date)
returns table (from_id text, type text)
language sql
stable
security definer
set search_path = public
as $$
  select r.from_id, r.type
  from relationships r
  where r.to_id = child
    and r.status = 'ACTIVE'
    and (
      is_parent_of(child)
      or exists (
        select 1
        from grants g
        where g.actor_id = current_person()
          and g.child_id = child
          and 'pickup.verify' = any(g.scopes)
          and (g.valid_from  is null or on_date >= g.valid_from)
          and (g.valid_until is null or on_date <= g.valid_until)
      )
    )
$$;

revoke all on function pickup_candidates_for(text, date) from public;
revoke all on function pickup_candidates_for(text, date) from anon;
grant execute on function pickup_candidates_for(text, date) to authenticated;
