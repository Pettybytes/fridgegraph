-- 0075 — the village's place read: labels for anyone with schedule.read, coordinates only with address access.
--
-- WHY (measured on the rehearsal stack, 2026-11-02)
-- `villageWorld` first sourced places from `recorded_places` through the caller's own RLS and priced
-- coordinates through `place_route_geometry_for`. Two separate defects:
--   * `recorded_places_read` is household-member-only, so a grant-holding caregiver (Loretta) received
--     **zero** places even though she may see the child — the map went empty for exactly the person it
--     exists for;
--   * `place_route_geometry_for` additionally requires household membership, so it can never be the
--     label source for a non-member caregiver.
--
-- WHAT THIS DOES
-- One SELECT-only function, gated exactly like `event_day_places` (0057): `is_parent_of(child)` OR
-- `has_scope(child,'schedule.read')`. Labels are always returned to a caller who passes that gate.
-- Coordinates are returned **only** when `is_parent_of(child)` OR `has_scope(child,'address.read')`,
-- and are NULL together otherwise with `state = 'withheld'`, so "no pin" is never confused with
-- "no place". `state = 'absent'` means the catalog row genuinely has no coordinates.
--
-- SOURCE IS THE CURATED CATALOG ONLY
-- `recorded_places` holds school / practice / park style places for a household. It never holds a
-- person's home, and this function does not read `locations` at all: those rows are private home
-- coordinates that feed ride pricing. A home may only ever appear as `VillagePerson.homePlaceId`,
-- gated by address access, and only once a gated home place exists to point at.
--
-- Additive, forward-only, read-only. No policy changes, no table changes.

begin;

create or replace function village_places_for_child(p_child text)
returns table (id text, kind text, label text, latitude numeric, longitude numeric, state text)
language sql
stable
security definer
set search_path = public
as $$
  with gate as (
    select
      (public.is_parent_of(p_child) or public.has_scope(p_child, 'schedule.read')) as may_see,
      (public.is_parent_of(p_child) or public.has_scope(p_child, 'address.read'))  as may_locate
  )
  select
    rp.id,
    rp.kind,
    rp.label,
    case when gate.may_locate then rp.latitude end,
    case when gate.may_locate then rp.longitude end,
    case
      when not gate.may_locate then 'withheld'
      when rp.latitude is null or rp.longitude is null then 'absent'
      else 'granted'
    end
  from recorded_places rp, gate
  where gate.may_see
    and rp.household_id in (
      select m.household_id from household_members m where m.person_id = p_child
    )
  order by rp.kind, rp.label
$$;

revoke all on function village_places_for_child(text) from public, anon;
grant execute on function village_places_for_child(text) to authenticated;

commit;
