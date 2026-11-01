-- 0056 — places carry coordinates; the coordinates are GATED, not merely hidden by the client.
--
-- Settled rule (VILLAGE-MAP-CONTRACT.md §1): a caller without address.read gets NO pin, no district
-- centroid, no approximate location and no coordinate-derived camera. There is no blurred-but-present
-- path, so the coordinates are removed BEFORE the row leaves the database.

begin;

alter table public.recorded_places
  add column if not exists latitude  numeric(9, 6),
  add column if not exists longitude numeric(9, 6);

-- Both or neither: a lone latitude is a bug, not a partial location.
alter table public.recorded_places drop constraint if exists recorded_places_coords_together;
alter table public.recorded_places add constraint recorded_places_coords_together
  check ((latitude is null) = (longitude is null));

alter table public.recorded_places drop constraint if exists recorded_places_coords_range;
alter table public.recorded_places add constraint recorded_places_coords_range
  check (latitude is null or (latitude between -90 and 90 and longitude between -180 and 180));

-- Anyone who may see the child at all sees the place as label/card; only a parent or an address.read
-- holder receives the coordinates. A caller with no relationship gets no row, so the refusal is the
-- same answer for "not your child" and "no such place".
create or replace function public.place_geometry_for(p_child text, p_place text)
returns table (id text, kind text, label text, latitude numeric, longitude numeric)
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
         p.kind,
         p.label,
         case when rel.may_locate then p.latitude  end,
         case when rel.may_locate then p.longitude end
    from public.recorded_places p, rel
   where p.id = p_place
     and rel.may_see
     -- The place must belong to a household the CHILD is in. Without this, a caller with any grant
     -- on the child is served another family's place row — and, with address.read, its coordinates.
     -- A place from another family must answer exactly like one that does not exist.
     and p.household_id in (
       select m.household_id from public.household_members m where m.person_id = p_child
     )
$$;

revoke all on function public.place_geometry_for(text, text) from public, anon;
grant execute on function public.place_geometry_for(text, text) to authenticated;

comment on function public.place_geometry_for(text, text) is
  'One place for one child. Row only for a caller related to that child; latitude/longitude only for '
  'a parent or an address.read holder. Omission, never rounding.';

commit;
