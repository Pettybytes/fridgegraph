-- 0026 — the Demo guide's derived reads (E2c seam).
--
-- WHY THIS EXISTS: 0025 gave the guide SELECT on sandbox records, and the resolvers accept a guide
-- on a sandbox child. But PickupCandidates is not a plain table read: it is derived through two
-- SECURITY DEFINER helpers (0008 `pickup_candidates_for`, 0010 `grant_holders_for`) that authorize
-- the caller themselves — parent, or a pickup.verify holder. A guide is neither, so it was permitted
-- by the resolver and then received an EMPTY list. An empty candidate list is not a harmless zero:
-- it reads as "nobody can collect this child", which is a false statement about sandbox data.
--
-- WHAT CHANGES: both helpers additionally accept a caller whose verified token carries
-- app_metadata.demo_guide AND whose child is a sandbox child. Nothing else changes:
--   * the projection stays narrow ((from_id,type) and actor ids only),
--   * every non-guide caller keeps the exact previous gate,
--   * a guide on a NON-sandbox child gets nothing,
--   * no table policy is relaxed; this is a definer read justified by the fact that the guide may
--     already read these same rows directly through 0025's demo_guide_* policies.
--
-- WHY NOT DROP THE GATE: the helpers bypass RLS by design. They must authorize the caller in their
-- own body; that is the same shape is_parent_of uses. This adds one narrowly-scoped clause rather
-- than weakening the function.
--
-- Rollback: recreate both functions from 0008/0010 verbatim (commented at the bottom).

begin;

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
      -- E2c: read-only guide scope over sandbox data.
      or (is_demo_guide() and is_sandbox_child(child))
    )
$$;

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
      -- E2c: read-only guide scope over sandbox data.
      or (is_demo_guide() and is_sandbox_child(child))
    )
$$;

comment on function pickup_candidates_for(text, date) is
  'Narrow projection of ACTIVE relationships to one child, for a parent, a pickup.verify holder, or '
  'the Demo guide on a sandbox child (0026).';

comment on function grant_holders_for(text, text, date) is
  'Actor ids holding a scope for one child on a date, for a parent, a pickup.request requester with '
  'pickup.verify, or the Demo guide on a sandbox child (0026).';

commit;

-- ROLLBACK (not applied): recreate both functions verbatim from
--   0008_pickup_candidates_for.sql and 0010_derived_query_helpers.sql (drop the is_demo_guide clause).
