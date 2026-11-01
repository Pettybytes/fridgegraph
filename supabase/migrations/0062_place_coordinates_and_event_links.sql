-- 0062 — the geographic seed: coordinates on the canonical places, and explicit event→place links,
-- extended through the EXISTING seed/reset helpers rather than by editing them.
--
-- 0053, 0056, 0057 and 0061 are untouched. 0061 is still STAGED and unapplied; this migration depends
-- on it (`events.place_id`), and says so loudly rather than failing halfway through.
--
-- WHAT THIS FIXES
--   1. No migration ever wrote `recorded_places.latitude/longitude`. They were set ad hoc by
--      ops/0056-dry-run.mjs and ops/place-gate-verify.mjs, both scoped/rolled back. A fresh seed
--      therefore produced places with no geometry: every route was 409 GEOMETRY_UNAVAILABLE.
--   2. No event carried `place_id`, so every day read was `unlinked` and `linked` was never proven.
--
-- PROVENANCE OF THE NUMBERS — read this before changing them.
--   Fictional, non-residential reference points, in the same band as the approved fixtures. Two are
--   REUSED verbatim from approved fixtures and must not drift from them:
--     Lincoln Elementary School  ← src/fixtures.ts `loc_nora_school` (42.331400, -83.045800), which is
--                                  also docs/mocks/pickup-candidates.json's pickupPoint
--     Riverside Park             ← web/src/features/village-map/mockAdapter.ts (42.337, -83.049)
--   The rest are NEW fictional points chosen for the demo and recorded here only. They are not
--   addresses, not geocodes, and not derived from any event title or from `events.location`. Nothing
--   reads that free-text column to produce a place, here or anywhere downstream.
--
-- DETERMINISM
--   Place ids stay exactly what 0053 computes: 'rp_' || substr(md5(household || ':' || label), 1, 12).
--   The event links below name the same (household, label) pairs rather than hard-coding ids, so a
--   re-seed cannot point an event at a place that does not exist.

begin;

-- Fail at the top, with a legible message, if 0061 has not been applied yet.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'events' and column_name = 'place_id'
  ) then
    raise exception '0062 requires 0061 (events.place_id) — apply 0061 first';
  end if;
end $$;

-- ---------------------------------------------------------------- coordinates on the seed
--
-- Same rows, same ids, same order of authority as 0053 — now carrying geometry. ON CONFLICT keeps
-- the ids stable and restores the canonical coordinates, so a reset cannot leave a place pointing at
-- yesterday's coordinate.
create or replace function public.seed_recorded_places()
returns int
language plpgsql security definer set search_path = public
as $$
declare v_seeded int := 0;
begin
  with wanted(household_id, kind, label, latitude, longitude) as (
    values
      ('h_a',     'SCHOOL_PICKUP',  'Lincoln Elementary School', 42.331400, -83.045800),
      ('h_a',     'PARK',           'Maple Grove Park',          42.381000, -83.059000),
      ('h_a',     'PRACTICE_FIELD', 'Eastside Sports Field',     42.366000, -83.101000),
      ('h_b',     'SCHOOL_PICKUP',  'Lincoln Elementary School', 42.331400, -83.045800),
      ('h_b',     'PARK',           'Riverside Park',            42.337000, -83.049000),
      ('h_c',     'SCHOOL_PICKUP',  'Roosevelt Middle School',   42.358500, -83.070500),
      ('h_c',     'PARK',           'Cedar Hill Park',           42.312000, -83.098000),
      ('h_emma',  'SCHOOL_PICKUP',  'Roosevelt Middle School',   42.358500, -83.070500),
      ('h_malik', 'PARK',           'Maple Grove Park',          42.381000, -83.059000),
      ('h_micah', 'SCHOOL_PICKUP',  'Lincoln Elementary School', 42.331400, -83.045800),
      ('h_taylor','PRACTICE_FIELD', 'Northgate Practice Field',  42.395000, -83.082000)
  )
  insert into recorded_places (id, household_id, kind, label, latitude, longitude, sandbox, fixture)
  select 'rp_' || substr(md5(w.household_id || ':' || w.label), 1, 12),
         w.household_id, w.kind, w.label, w.latitude, w.longitude, true, true
    from wanted w
    join households h on h.id = w.household_id
  on conflict (household_id, label) do update
     set latitude  = excluded.latitude,
         longitude = excluded.longitude;
  get diagnostics v_seeded = row_count;
  return v_seeded;
end $$;

revoke all on function public.seed_recorded_places() from public, anon;
grant execute on function public.seed_recorded_places() to authenticated, service_role;

-- ---------------------------------------------------------------- event → place links
--
-- An EXPLICIT list. Nothing derives a venue: no title match, no free-text parse, no heuristic. An
-- event that is not named here stays `unlinked`, and that is the honest answer.
--
-- Basis for each entry: a school-day event in the Cast v2 fixture, linked to the SCHOOL_PICKUP place
-- recorded for that child's household. Households whose only place is a park or a practice field
-- (h_taylor, h_malik) get NO link — there is no school place for them to point at.
create or replace function public.seed_event_place_links()
returns int
language plpgsql security definer set search_path = public
as $$
declare v_linked int := 0;
begin
  with wanted(event_id, household_id, label) as (
    values
      ('fx_event_p_nora_0',  'h_a',     'Lincoln Elementary School'),
      ('fx_event_p_nora_3',  'h_a',     'Lincoln Elementary School'),
      ('fx_event_p_nora_6',  'h_a',     'Lincoln Elementary School'),
      ('fx_event_p_jax_0',   'h_c',     'Roosevelt Middle School'),
      ('fx_event_p_jax_3',   'h_c',     'Roosevelt Middle School'),
      ('fx_event_p_jax_6',   'h_c',     'Roosevelt Middle School'),
      ('fx_event_p_emma_0',  'h_emma',  'Roosevelt Middle School'),
      ('fx_event_p_emma_3',  'h_emma',  'Roosevelt Middle School'),
      ('fx_event_p_emma_6',  'h_emma',  'Roosevelt Middle School'),
      ('fx_event_p_micah_0', 'h_micah', 'Lincoln Elementary School'),
      ('fx_event_p_micah_3', 'h_micah', 'Lincoln Elementary School'),
      ('fx_event_p_micah_6', 'h_micah', 'Lincoln Elementary School'),
      ('fx_event_p_avery_0', 'h_micah', 'Lincoln Elementary School'),
      ('fx_event_p_avery_3', 'h_micah', 'Lincoln Elementary School'),
      ('fx_event_p_avery_6', 'h_micah', 'Lincoln Elementary School')
  ), target as (
    select w.event_id,
           'rp_' || substr(md5(w.household_id || ':' || w.label), 1, 12) as place_id
      from wanted w
  )
  update public.events e
     set place_id = t.place_id
    from target t
   where e.id = t.event_id
     -- The household invariant, checked here as well as by the write guard: the place must belong to
     -- a household the EVENT's child is in. A mapping that breaks it is skipped, not forced.
     and exists (
       select 1
         from public.recorded_places rp
        where rp.id = t.place_id
          and rp.household_id in (
            select hm.household_id from public.household_members hm where hm.person_id = e.child_id
          )
     )
     and e.place_id is distinct from t.place_id;
  get diagnostics v_linked = row_count;
  return v_linked;
end $$;

revoke all on function public.seed_event_place_links() from public, anon;
grant execute on function public.seed_event_place_links() to service_role;

-- ---------------------------------------------------------------- household invariant
--
-- `event_day_places` (0061) resolves a link by joining the place's household against the CHILD's
-- households. Moving a linked place to another household would therefore invalidate links that the
-- write guard had already accepted, and would silently change what a parent sees. The invariant is
-- kept at the place, not only at the event: a place with any linked event cannot change household.
create or replace function public._place_household_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.household_id is distinct from old.household_id
     and exists (select 1 from public.events e where e.place_id = new.id) then
    raise exception 'PLACE_HOUSEHOLD_LOCKED' using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function public._place_household_guard() from public, anon, authenticated;

drop trigger if exists recorded_places_household_guard on public.recorded_places;
create trigger recorded_places_household_guard
  before update of household_id on public.recorded_places
  for each row execute function public._place_household_guard();

comment on function public._place_household_guard() is
  'A place with linked events cannot change household: 0061 resolves links through the child''s '
  'household set, so a move would silently invalidate an accepted link.';

-- ---------------------------------------------------------------- reset
--
-- The authorized reset path stays `reset_demo_places` (0053) — it is extended here, not replaced by a
-- broad deletion list. Order matters:
--   1. detach the FK dependents that point at places about to be deleted (orbit alerts already did
--      this; events do too, and without it the delete fails or strands a link);
--   2. delete only NON-FIXTURE sandbox places (unchanged rule);
--   3. re-seed the canonical places WITH coordinates;
--   4. restore the canonical links, and clear links on cast fixture events that are not canonical,
--      so a test that re-pointed an event cannot survive a reset.
-- Protected rows (fixture = true) and other households are never deleted.
create or replace function public.reset_demo_places(p_actor text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_removed int := 0;
  v_seeded int := 0;
  v_linked int := 0;
  v_unlinked int := 0;
begin
  perform set_config('app.demo_reset', 'on', true);

  -- 1. Detach every dependent of a place that is about to disappear.
  update orbit_alerts
     set last_seen_place_id = null
   where last_seen_place_id in (
     select id from public.recorded_places where sandbox is true and fixture is false
   );

  update public.events
     set place_id = null
   where place_id in (
     select id from public.recorded_places where sandbox is true and fixture is false
   );

  -- 2. Disposable places only.
  delete from public.recorded_places where sandbox is true and fixture is false;
  get diagnostics v_removed = row_count;

  -- 3. Canonical places, with their coordinates.
  v_seeded := public.seed_recorded_places();

  -- 4. Canonical links; then remove any NON-canonical link left on a cast fixture event.
  v_linked := public.seed_event_place_links();

  with wanted(event_id) as (
    values
      ('fx_event_p_nora_0'), ('fx_event_p_nora_3'), ('fx_event_p_nora_6'),
      ('fx_event_p_jax_0'), ('fx_event_p_jax_3'), ('fx_event_p_jax_6'),
      ('fx_event_p_emma_0'), ('fx_event_p_emma_3'), ('fx_event_p_emma_6'),
      ('fx_event_p_micah_0'), ('fx_event_p_micah_3'), ('fx_event_p_micah_6'),
      ('fx_event_p_avery_0'), ('fx_event_p_avery_3'), ('fx_event_p_avery_6')
  )
  update public.events e
     set place_id = null
   where e.place_id is not null
     and e.id like 'fx_event_%'
     and not exists (select 1 from wanted w where w.event_id = e.id);
  get diagnostics v_unlinked = row_count;

  insert into public.demo_reset_audit (actor, removed)
  values (p_actor, jsonb_build_object(
    'recorded_places_removed', v_removed,
    'recorded_places_seeded', v_seeded,
    'event_place_linked', v_linked,
    'event_place_unlinked', v_unlinked
  ));

  perform set_config('app.demo_reset', 'off', true);
  return jsonb_build_object(
    'recorded_places_removed', v_removed,
    'recorded_places_seeded', v_seeded,
    'event_place_linked', v_linked,
    'event_place_unlinked', v_unlinked
  );
end $$;

revoke all on function public.reset_demo_places(text) from public, anon;
grant execute on function public.reset_demo_places(text) to authenticated, service_role;

-- ---------------------------------------------------------------- state semantics (0061)
--
-- `linked` means the event→place LINKAGE IS READABLE. It does not mean the caller may locate the
-- place: coordinates stay behind `place_route_geometry_for` (0058) and its own parent/`address.read`
-- gate, and this reader exposes no coordinate field.
--
-- `withheld` is RESERVED / DEFENSIVE. With 0061's write guard AND the household guard above, there is
-- no legitimate producer of a withheld link today: a link can only be created inside the child's
-- household, and a linked place can no longer move out of it. `withheld` therefore remains in the
-- accessor and in the client contract as the fail-safe for drift (a manually migrated row, a future
-- household-merge path), and NO check may claim a live withheld case passed. If a real producer is
-- ever added, it belongs in 0061's successor, with its own proof.
comment on function public.seed_event_place_links() is
  'Explicit canonical event→place links. Never derived from title or events.location; unlisted events '
  'stay unlinked (place_id NULL).';

commit;
