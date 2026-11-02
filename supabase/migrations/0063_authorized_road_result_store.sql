-- 0063 — the pricing pre-step writes through an AUTHORIZED function.
--
-- WHAT WAS WRONG
-- 0059's `store_route_result` is granted to `authenticated` and takes arbitrary coordinates plus an
-- arbitrary distance. Anything signed in could therefore write a row with a made-up snapshot and a
-- made-up distance, and the paid-ride price reads exactly that store. The route endpoint was the
-- only intended caller, but nothing in the database said so.
--
-- WHAT THIS DOES
--   * the RAW writer is no longer executable by `authenticated` — server/ops only (`service_role`);
--   * measurements go through `store_route_result_authorized(child, …)`, which
--       - requires a verified caller who is a parent of that child or holds `address.read` on it
--         (the same gate coordinates already have in 0056/0058),
--       - requires BOTH endpoints to be REAL place rows for that child — the child's own `locations`
--         row (the school), a candidate person's `locations` row, or a `recorded_places` row in one
--         of the child's households — matched on the exact 6dp snapshot,
--       - bounds the distance (0 < d ≤ 500 km) and the coordinates, and rejects a non-finite value.
--
-- WHAT THIS DOES NOT DO
-- No HTTP, no ORS call, no ranking, no cost maths. `_rank_and_advance` (0060) is untouched, and
-- 0020's reply path still writes no cost. The pre-step that CALLS ORS lives in the server
-- (src/village/ridePrewarm.ts), because a database must not make outbound HTTP requests during a
-- request path.
--
-- Forward-only: 0059 is applied and is never edited.

begin;

revoke all on function public.store_route_result(
  text, text, text, numeric, numeric, numeric, numeric, numeric, numeric
) from public, anon, authenticated;
grant execute on function public.store_route_result(
  text, text, text, numeric, numeric, numeric, numeric, numeric, numeric
) to service_role;

/**
 * The only path a request-handling caller may use to store a road measurement.
 *
 * Returns true when the row was written. Raises 42501 for an unauthorized caller or an endpoint
 * that is not a real place for this child — a refusal, not a silent no-op, so a probe cannot tell
 * which of the two it hit by watching the table.
 */
create or replace function public.store_route_result_authorized(
  p_child            text,
  p_profile          text,
  p_from_place_id    text,
  p_to_place_id      text,
  p_from_lat         numeric,
  p_from_lng         numeric,
  p_to_lat           numeric,
  p_to_lng           numeric,
  p_distance_meters  numeric,
  p_duration_seconds numeric default null
) returns boolean
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_caller text := public.current_person();
begin
  if v_caller is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;

  -- The same authority that releases coordinates: a parent, or an address.read holder.
  if not (public.is_parent_of(p_child) or public.has_scope(p_child, 'address.read')) then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;

  if p_profile is null or p_profile not in ('driving-car','foot-walking','cycling-regular') then
    raise exception 'BAD_PROFILE' using errcode = '22023';
  end if;

  -- Bounds, not maths: a measurement that is absent, negative or absurd is not stored at all.
  if p_distance_meters is null
     or p_distance_meters <= 0
     or p_distance_meters > 500000
     or p_from_lat is null or p_from_lng is null or p_to_lat is null or p_to_lng is null
     or p_from_lat < -90 or p_from_lat > 90 or p_to_lat < -90 or p_to_lat > 90
     or p_from_lng < -180 or p_from_lng > 180 or p_to_lng < -180 or p_to_lng > 180
     or (p_duration_seconds is not null and (p_duration_seconds < 0 or p_duration_seconds > 86400)) then
    raise exception 'BAD_MEASUREMENT' using errcode = '22023';
  end if;

  /**
   * A snapshot may only name a place that actually exists for this child. Two sources, because the
   * two callers legitimately use different ones: the pricing path resolves `locations` rows (the
   * child's school, a candidate's recorded point) and the route proxy resolves `recorded_places`.
   * Anything else is an invention and is refused.
   */
  if not exists (
      select 1 from public.locations l
       where round(l.lat::numeric, 6) = round(p_from_lat, 6)
         and round(l.lng::numeric, 6) = round(p_from_lng, 6)
         and (
           (l.owner_type = 'CHILD' and l.owner_id = p_child)
           or (l.owner_type = 'PERSON' and exists (
                 select 1
                   from public.candidate_evaluations ce
                   join public.coordination_jobs j on j.id = ce.job_id
                  where j.child_id = p_child
                    and ce.candidate_id = l.owner_id))
         )
    )
    and not exists (
      select 1 from public.recorded_places rp
       where round(rp.latitude, 6) = round(p_from_lat, 6)
         and round(rp.longitude, 6) = round(p_from_lng, 6)
         and rp.household_id in (
           select hm.household_id from public.household_members hm where hm.person_id = p_child)
    ) then
    raise exception 'SNAPSHOT_NOT_AUTHORIZED' using errcode = '42501';
  end if;

  if not exists (
      select 1 from public.locations l
       where round(l.lat::numeric, 6) = round(p_to_lat, 6)
         and round(l.lng::numeric, 6) = round(p_to_lng, 6)
         and (
           (l.owner_type = 'CHILD' and l.owner_id = p_child)
           or (l.owner_type = 'PERSON' and exists (
                 select 1
                   from public.candidate_evaluations ce
                   join public.coordination_jobs j on j.id = ce.job_id
                  where j.child_id = p_child
                    and ce.candidate_id = l.owner_id))
         )
    )
    and not exists (
      select 1 from public.recorded_places rp
       where round(rp.latitude, 6) = round(p_to_lat, 6)
         and round(rp.longitude, 6) = round(p_to_lng, 6)
         and rp.household_id in (
           select hm.household_id from public.household_members hm where hm.person_id = p_child)
    ) then
    raise exception 'SNAPSHOT_NOT_AUTHORIZED' using errcode = '42501';
  end if;

  perform public.store_route_result(
    p_profile, p_from_place_id, p_to_place_id,
    p_from_lat, p_from_lng, p_to_lat, p_to_lng,
    p_distance_meters, p_duration_seconds);

  return true;
end $$;

revoke all on function public.store_route_result_authorized(
  text, text, text, text, numeric, numeric, numeric, numeric, numeric, numeric
) from public, anon;
grant execute on function public.store_route_result_authorized(
  text, text, text, text, numeric, numeric, numeric, numeric, numeric, numeric
) to authenticated, service_role;

comment on function public.store_route_result_authorized is
  'Caller-authorized road-measurement write for one child. Both endpoints must be real place rows '
  'for that child; distance is bounded. The raw store_route_result is service_role-only.';

commit;
