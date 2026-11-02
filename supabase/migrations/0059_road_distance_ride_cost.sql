-- 0059 — road distance for the ride estimate, and a store for it.
--
-- WHAT THIS FIXES
-- `_rank_and_advance` (0019) prices a paid ride as `haversine_miles(...) x $1.40`, and says so in
-- `cost_basis`. Haversine is a straight line: it ignores rivers, highways and one-way streets, so the
-- number the family is shown is not a road distance. The map/route endpoint already gets a real road
-- distance from ORS. This migration gives both paths ONE number with ONE basis.
--
-- WHAT IS TRUE, AND WHAT IS NOT
-- `locations` (0001) carries NO place id: `id, owner_type, owner_id, label, lat, lng, source,
-- captured_at`. `recorded_places` (0053) is a different, id'd table. So the ranking path cannot name
-- a place id today. This store is therefore keyed on the COORDINATE SNAPSHOT plus the routing
-- profile, and records place ids when the caller has them (the ORS proxy does). A stored result is
-- only used when its snapshot matches the coordinates EXACTLY, so a place that moves invalidates its
-- own result. The place-id columns are advisory, not the match key — pretending otherwise would be
-- the same overclaim in a different column.
--
-- FRESHNESS is a declared rule, not a vibe: `ROAD_RESULT_MAX_AGE` = 30 days. Older results are not
-- used and the basis says so.
--
-- NO AUTHORIZATION, NO GEOMETRY, NO MATH. `route_distance_miles` takes coordinates the caller
-- already resolved. It performs no authorization itself and must never be called with coordinates
-- the caller is not entitled to; the caller-side check is what protects it. When it cannot answer it
-- returns NULL, and the reason is carried in the basis string the evaluation already stores.
--
-- Forward-only: 0019 is applied and is never edited.

begin;

create table if not exists public.place_route_results (
  id               text primary key,
  profile          text not null check (profile in ('driving-car','foot-walking','cycling-regular')),
  from_place_id    text,
  to_place_id      text,
  from_lat         numeric not null,
  from_lng         numeric not null,
  to_lat           numeric not null,
  to_lng           numeric not null,
  distance_meters  numeric not null check (distance_meters >= 0),
  duration_seconds numeric,
  source           text not null default 'openrouteservice',
  computed_at      timestamptz not null default now()
);

-- One row per (profile, exact snapshot): a re-measure replaces, it does not accumulate.
create unique index if not exists place_route_results_snapshot_key
  on public.place_route_results (
    profile,
    round(from_lat, 6), round(from_lng, 6),
    round(to_lat, 6),   round(to_lng, 6)
  );

create index if not exists place_route_results_freshness
  on public.place_route_results (profile, computed_at desc);

alter table public.place_route_results enable row level security;
alter table public.place_route_results force row level security;
-- No policies: this is server-side reference data. Only SECURITY DEFINER code reads it.

revoke all on table public.place_route_results from public, anon, authenticated;

/** The declared freshness rule, in one place so the reader and the writer cannot disagree. */
create or replace function public.road_result_max_age()
returns interval language sql immutable as $$ select interval '30 days' $$;

/**
 * Stored road distance in miles for this exact snapshot, or NULL when there is no usable result.
 * Matching is on coordinates rounded to 6dp plus the profile; place ids are recorded, not matched.
 */
create or replace function public.route_distance_miles(
  p_from_lat numeric, p_from_lng numeric,
  p_to_lat   numeric, p_to_lng   numeric,
  p_profile  text
) returns numeric
language sql stable security definer set search_path = pg_catalog, public as $$
  select r.distance_meters / 1609.344
    from public.place_route_results r
   where r.profile = p_profile
     and round(r.from_lat, 6) = round(p_from_lat, 6)
     and round(r.from_lng, 6) = round(p_from_lng, 6)
     and round(r.to_lat, 6)   = round(p_to_lat, 6)
     and round(r.to_lng, 6)   = round(p_to_lng, 6)
     and r.computed_at > now() - public.road_result_max_age()
   limit 1
$$;

revoke all on function public.route_distance_miles(numeric, numeric, numeric, numeric, text) from public, anon;
grant execute on function public.route_distance_miles(numeric, numeric, numeric, numeric, text) to authenticated;

/**
 * The single decision point: road distance when a fresh stored result exists, otherwise haversine.
 * Returns the miles AND the basis text that goes straight into `cost_basis`, so the number and the
 * explanation of the number can never drift apart.
 */
create or replace function public.ride_miles_for(
  p_from_lat numeric, p_from_lng numeric,
  p_to_lat   numeric, p_to_lng   numeric
) returns table (miles numeric, basis text)
language sql stable security definer set search_path = pg_catalog, public as $$
  with road as (
    select public.route_distance_miles(p_from_lat, p_from_lng, p_to_lat, p_to_lng, 'driving-car') as m
  )
  select coalesce(road.m, haversine_miles(p_from_lat::double precision, p_from_lng::double precision,
                                          p_to_lat::double precision,   p_to_lng::double precision)),
         case when road.m is not null
              then 'FridgeGraph planning estimate: stored road distance x $1.40/mi - not a provider quote'
              else 'FridgeGraph synthetic planning estimate: haversine distance x $1.40/mi - not a provider quote'
         end
    from road
$$;

revoke all on function public.ride_miles_for(numeric, numeric, numeric, numeric) from public, anon;
grant execute on function public.ride_miles_for(numeric, numeric, numeric, numeric) to authenticated;

/**
 * The WRITER. Without this the store is permanently empty and ranking silently falls back to haversine forever,
 * which is the original defect wearing a new table. Called by the route endpoint after a REAL ORS
 * response (never on a cache hit, never on a refusal) with coordinates that endpoint already
 * authorized for this caller.
 *
 * Upsert on the snapshot key: a re-measure replaces the old row, so freshness is real.
 */
create or replace function public.store_route_result(
  p_profile text,
  p_from_place_id text,
  p_to_place_id text,
  p_from_lat numeric, p_from_lng numeric,
  p_to_lat numeric, p_to_lng numeric,
  p_distance_meters numeric,
  p_duration_seconds numeric default null
) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if p_profile not in ('driving-car','foot-walking','cycling-regular') then
    raise exception 'BAD_PROFILE';
  end if;
  if p_distance_meters is null or p_distance_meters < 0 then
    raise exception 'BAD_DISTANCE';
  end if;
  insert into public.place_route_results
    (id, profile, from_place_id, to_place_id, from_lat, from_lng, to_lat, to_lng,
     distance_meters, duration_seconds, source, computed_at)
  values
    (gen_random_uuid()::text, p_profile, p_from_place_id, p_to_place_id,
     round(p_from_lat, 6), round(p_from_lng, 6), round(p_to_lat, 6), round(p_to_lng, 6),
     p_distance_meters, p_duration_seconds, 'openrouteservice', now())
  on conflict (profile, round(from_lat, 6), round(from_lng, 6), round(to_lat, 6), round(to_lng, 6))
  do update set
    distance_meters = excluded.distance_meters,
    duration_seconds = excluded.duration_seconds,
    from_place_id = excluded.from_place_id,
    to_place_id = excluded.to_place_id,
    source = excluded.source,
    computed_at = now();
end $$;

revoke all on function public.store_route_result(text, text, text, numeric, numeric, numeric, numeric, numeric, numeric) from public, anon;
grant execute on function public.store_route_result(text, text, text, numeric, numeric, numeric, numeric, numeric, numeric) to authenticated;

commit;
