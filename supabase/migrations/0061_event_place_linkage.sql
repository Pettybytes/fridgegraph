-- 0061 — a calendar event may name a place, and the linkage is persisted.
--
-- WHAT WAS MISSING
-- `events` (0001) has `id, child_id, title, start_at, end_at, location, status, fixture`. `location`
-- is FREE TEXT — a venue someone typed. Nothing ties an event to a `recorded_places` row, so the map
-- cannot honestly answer "where is everyone on Saturday": it can only echo a string or parse one.
--
-- This adds the linkage the contract describes (`place_id` on the event relation) and a gated read.
-- It does NOT parse `location` and does NOT invent a venue from a title. The 91 existing events keep
-- `place_id = NULL` — unlinked, not guessed.
--
-- GATING. A place label is location data, so it follows the same rule as every other place read: a
-- caller may see the EVENT, but receives `place_id`/`place_label` only when they may LOCATE places
-- for that child (parent, or an `address.read` holder). Otherwise both come back NULL and the event
-- still renders. Same shape as `place_route_geometry_for` (0058): the row exists, the geometry is
-- withheld.

begin;

alter table public.events
  add column if not exists place_id text references public.recorded_places (id);

-- One place per event is the contract; a second link would need a join table and is out of scope.
comment on column public.events.place_id is
  'Optional link to recorded_places. NULL means "not linked" — never inferred from title or location text.';

create index if not exists events_place_id_idx on public.events (place_id);

/** Same family rule as 0056/0058: another family's place answers like a missing one. */
create or replace function public._event_place_in_family(p_child text, p_place text)
returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (
    select 1
      from public.recorded_places rp
     where rp.id = p_place
       and rp.household_id in (
         select hm.household_id from public.household_members hm where hm.person_id = p_child
       )
  )
$$;

revoke all on function public._event_place_in_family(text, text) from public, anon, authenticated;

/**
 * A rejected link must be rejected at write time, not filtered later: an event pointing at another
 * family's place is a data defect that would surface as a confusing empty map.
 */
create or replace function public._events_place_guard()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.place_id is not null
     and not public._event_place_in_family(new.child_id, new.place_id) then
    raise exception 'EVENT_PLACE_NOT_IN_FAMILY' using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function public._events_place_guard() from public, anon, authenticated;

drop trigger if exists events_place_guard on public.events;
create trigger events_place_guard
  before insert or update of place_id, child_id on public.events
  for each row execute function public._events_place_guard();

/**
 * A day's events with the linked place, gated. `may_locate` decides whether the place columns are
 * populated; the event rows themselves are visible to anyone who can see the child's calendar.
 * An event with no link and an event whose place is withheld are DIFFERENT states, and the caller can
 * tell them apart: `linked` is true for a link the caller may see.
 */
create or replace function public.event_day_places(p_child text, p_day date)
returns table (
  event_id    text,
  title       text,
  start_at    timestamp,
  linked      boolean,
  place_id    text,
  place_label text
)
language sql stable security definer set search_path = pg_catalog, public as $$
  with gate as (
    select (public.is_parent_of(p_child) or public.has_scope(p_child, 'address.read')) as may_locate,
           (public.is_parent_of(p_child) or exists (
              select 1 from public.grants g
               where g.actor_id = public.current_person()
                 and g.child_id = p_child
                 and (g.valid_from is null or current_date >= g.valid_from)
                 and (g.valid_until is null or current_date <= g.valid_until)
           )) as may_see
  )
  select e.id,
         e.title,
         e.start_at,
         (e.place_id is not null) as linked,
         case when gate.may_locate then e.place_id end,
         case when gate.may_locate then rp.label end
    from public.events e
    cross join gate
    left join public.recorded_places rp on rp.id = e.place_id
   where e.child_id = p_child
     and e.start_at::date = p_day
     and gate.may_see
   order by e.start_at, e.id
$$;

revoke all on function public.event_day_places(text, date) from public, anon;
grant execute on function public.event_day_places(text, date) to authenticated;

commit;
