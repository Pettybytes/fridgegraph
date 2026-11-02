-- 0064 — `ride_miles_for` for the coordinate type the ranking actually has.
--
-- THE DEFECT (found by ops/0063-road-pricing-proof.mjs, not by reading)
-- `_rank_and_advance` (0060) calls
--     left join lateral public.ride_miles_for(v_school.lat, v_school.lng, l.lat, l.lng) rm on true
-- where `v_school` and `l` come from `locations` (0013), whose columns are `double precision`:
--     lat double precision not null check (lat between -90 and 90)
--     lng double precision not null check (lng between -180 and 180)
-- 0059 declared `ride_miles_for(numeric, numeric, numeric, numeric)`. PostgreSQL does not implicitly
-- cast `double precision` to `numeric` for function resolution, so the call resolves to nothing and
-- the paid-ride branch raises 42883 ("function ... does not exist") at RUNTIME — the exact branch
-- this work exists to fix, failing before it prices anything. `route_distance_miles` and
-- `store_route_result` are numeric and are called with matching types, so they were unaffected.
--
-- THE FIX
-- An overload with the types the ranking has, delegating to the numeric implementation. No body is
-- duplicated, no arithmetic is reimplemented: the single decision point stays `ride_miles_for(numeric…)`
-- and this overload is only a resolution bridge for the coordinates the database actually stores.
--
-- Why not edit 0060: it is already committed, and replacing a 150-line SECURITY DEFINER body to add
-- two casts is a larger, riskier diff than naming the missing signature. 0059/0060 are never edited.
--
-- This migration does not touch `_rank_and_advance`, the reply path (0020), or the cap decision.

begin;

create or replace function public.ride_miles_for(
  p_from_lat double precision, p_from_lng double precision,
  p_to_lat   double precision, p_to_lng   double precision
) returns table (miles numeric, basis text)
language sql stable security definer set search_path = pg_catalog, public as $$
  select *
    from public.ride_miles_for(
      p_from_lat::numeric, p_from_lng::numeric,
      p_to_lat::numeric,   p_to_lng::numeric)
$$;

revoke all on function public.ride_miles_for(double precision, double precision, double precision, double precision) from public, anon;
grant execute on function public.ride_miles_for(double precision, double precision, double precision, double precision) to authenticated, service_role;

comment on function public.ride_miles_for(double precision, double precision, double precision, double precision) is
  'Resolution bridge: `locations.lat/lng` are double precision, the implementation is numeric. '
  'Delegates, never duplicates — one decision point, one basis string.';

commit;
