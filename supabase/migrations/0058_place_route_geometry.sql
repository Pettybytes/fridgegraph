-- 0058 — routing-specific geometry accessor.
--
-- 0056/0057 are APPLIED and are never edited: the live database is ahead of main, so any change is a
-- new forward migration. This one adds the distinction the proxy needs and could not express:
--
--   'granted'  the caller may locate this place and the place HAS coordinates -> routable
--   'withheld' the caller may see the place but not locate it                -> NOT routable
--   'absent'   the caller may locate it, but no coordinates are recorded     -> NOT routable
--
-- Without this, an authorized-but-ungeocoded place and a deliberately withheld one both look like
-- NULL, and a caller could not be told which happened. Row existence is still not routing permission.

begin;

create or replace function public.place_route_geometry_for(p_child text, p_place text)
returns table (id text, label text, state text, latitude numeric, longitude numeric)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with rel as (
    select (public.is_parent_of(p_child)
            or exists (
                 select 1 from public.grants g
                  where g.actor_id = public.current_person()
                    and g.child_id = p_child
                    and (g.valid_from is null or current_date >= g.valid_from)
                    and (g.valid_until is null or current_date <= g.valid_until)
               )) as may_see,
           (public.is_parent_of(p_child) or public.has_scope(p_child, 'address.read')) as may_locate
  )
  select p.id,
         p.label,
         case
           when not rel.may_locate then 'withheld'
           when p.latitude is null or p.longitude is null then 'absent'
           else 'granted'
         end,
         case when rel.may_locate then p.latitude  end,
         case when rel.may_locate then p.longitude end
    from public.recorded_places p, rel
   where p.id = p_place
     and rel.may_see
     -- same family rule as 0056: another family's place answers like a missing one
     and p.household_id in (
       select m.household_id from public.household_members m where m.person_id = p_child
     )
$$;

revoke all on function public.place_route_geometry_for(text, text) from public, anon;
grant execute on function public.place_route_geometry_for(text, text) to authenticated;

commit;
