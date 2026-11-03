-- 0087 — Orbit last-seen provenance: a recorded time is either entered by a parent or absent.
--
-- THE DEFECT. `orbit_alerts.last_seen_at` was a bare timestamp. Nothing in the row, the reader or
-- the API said where it came from, so any writer that valued it with `now()` — an ops proof, a
-- future adapter, a reset helper — produced a "last seen at 12:36 AM at Lincoln Elementary School"
-- that no person ever observed. The served build showed exactly that: a time that tracked the
-- moment the row was written, next to an activation instant that shared it.
--
-- THE RULE. Last-seen place and time are ONE unit, and the unit is provenance-or-nothing:
--   * place, time and provenance are all present, or all absent (the trigger normalises a cleared
--     place to a cleared time, so the existing reset helpers keep working without an edit);
--   * a time may only appear or change together with a recorded source; a bare `now()` is refused
--     at write time with ORBIT_LAST_SEEN_UNPROVENANCED;
--   * only `draft_orbit_share` stamps the source, and only when the parent supplied BOTH the place
--     and the time. `activate_orbit_alert` never touches it, so activation time can never become
--     last-seen time.
--
-- LEGACY ROWS. A row written before this migration carries no source, so it cannot prove the time
-- a person entered. It is not rewritten and not guessed: `orbit_share_for` stops returning the
-- place/time for it, and the UI reads "not recorded". That is the honest answer for a row whose
-- provenance was never captured.
--
-- Read gate lives in `orbit_share_for` (recreated below) because that is the single accessor the
-- resolver uses; a resolver that forgot the rule still cannot receive an unprovenanced time.
--
-- NOT APPLIED. This file is staged. 0087 is additive and forward-only; nothing in 0032-0062 is
-- edited.

begin;

-- ---------------------------------------------------------------- columns
alter table orbit_alerts add column if not exists last_seen_source text;
alter table orbit_alerts add column if not exists last_seen_recorded_by text;
alter table orbit_alerts add column if not exists last_seen_recorded_at timestamptz;

alter table orbit_alerts drop constraint if exists orbit_last_seen_source_values;
alter table orbit_alerts add constraint orbit_last_seen_source_values
  check (last_seen_source is null or last_seen_source in ('PARENT_ENTERED'));

-- ---------------------------------------------------------------- write guard
/**
 * One unit, provenance-or-nothing.
 *
 * `before insert or update` on the four columns that can define the unit. It normalises a cleared
 * place to a cleared time/source (so `reset_demo_places`, which only sets the place to null, keeps
 * working), refuses a half-specified unit, and refuses a time that appears or changes without a
 * source. A writer cannot re-introduce the defect by valuing `last_seen_at` with `now()`.
 */
create or replace function _orbit_last_seen_provenance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Refuse BEFORE normalising: a time that appears or changes must name its source. This is the
  -- check that stops any writer valuing last_seen_at with now() or with an activation instant.
  if new.last_seen_at is not null
     and new.last_seen_source is null
     and (tg_op = 'INSERT' or new.last_seen_at is distinct from old.last_seen_at) then
    raise exception 'ORBIT_LAST_SEEN_UNPROVENANCED' using errcode = '42501';
  end if;

  if new.last_seen_place_id is null then
    new.last_seen_at := null;
    new.last_seen_source := null;
    new.last_seen_recorded_by := null;
    new.last_seen_recorded_at := null;
    return new;
  end if;

  -- A recorded source needs an author. The time may be absent (a parent named the place but did
  -- not enter a time) — that is an explicit place, not an inferred time.
  if new.last_seen_source is not null
     and new.last_seen_recorded_by is null then
    raise exception 'ORBIT_LAST_SEEN_INCOMPLETE' using errcode = '22023';
  end if;

  return new;
end $$;

revoke all on function _orbit_last_seen_provenance() from public, anon;
grant execute on function _orbit_last_seen_provenance() to authenticated;

drop trigger if exists orbit_alerts_last_seen_provenance on orbit_alerts;
create trigger orbit_alerts_last_seen_provenance
  before insert or update of last_seen_place_id, last_seen_at, last_seen_source, child_id
  on orbit_alerts
  for each row execute function _orbit_last_seen_provenance();

-- ---------------------------------------------------------------- draft stamps provenance
/**
 * Same signature as 0053, two changes:
 *   1. a time without a place is refused — a bare time cannot be attached to an observation, and
 *      silently dropping it would hide the parent's input; a place without a time stays legal and
 *      stores no time at all;
 *   2. when the place is supplied, the row records WHO entered it and WHEN, so the reader can show
 *      "recorded by a parent" instead of inventing a source.
 */
create or replace function draft_orbit_share(
  p_child text,
  p_wear_color text default null,
  p_wear_garment text default null,
  p_hair text default null,
  p_carry_color text default null,
  p_carry_item text default null,
  p_photo text default null,
  p_last_seen_place text default null,
  p_last_seen_at timestamptz default null
) returns orbit_alerts
language plpgsql security definer set search_path = public
as $$
declare v_alert orbit_alerts; v_place text := nullif(btrim(coalesce(p_last_seen_place, '')), '');
begin
  if not is_parent_of(p_child) then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;
  if _orbit_has_location(p_wear_color) or _orbit_has_location(p_wear_garment)
     or _orbit_has_location(p_hair) or _orbit_has_location(p_carry_color)
     or _orbit_has_location(p_carry_item) then
    raise exception 'ORBIT_SHARE_HAS_LOCATION' using errcode = '22023';
  end if;
  if p_photo is not null and not exists (
    select 1 from orbit_photos ph
     where ph.id = p_photo and ph.child_id = p_child and ph.owner_person_id = current_person()
  ) then
    raise exception 'ORBIT_PHOTO_NOT_YOURS' using errcode = '42501';
  end if;
  -- A place from another family is refused; an unknown place is refused the same way, so the
  -- refusal is not an oracle for "that id exists somewhere".
  if v_place is not null and not _orbit_place_in_family(v_place, p_child) then
    raise exception 'ORBIT_PLACE_NOT_YOURS' using errcode = '42501';
  end if;

  -- A time with no place cannot be attached to an observation. (A place with no time is allowed
  -- and stores no time; the message then names the place and omits the clock.)
  if v_place is null and p_last_seen_at is not null then
    raise exception 'ORBIT_LAST_SEEN_INCOMPLETE' using errcode = '22023';
  end if;

  select * into v_alert from orbit_alerts
   where child_id = p_child and status = 'PENDING_ACTIVATION' and created_by = current_person()
   order by created_at desc limit 1;

  if found then
    update orbit_alerts
       set wear_color = p_wear_color, wear_garment = p_wear_garment, hair_desc = p_hair,
           carry_color = p_carry_color, carry_item = p_carry_item,
           photo_id = coalesce(p_photo, photo_id),
           last_seen_place_id = v_place,
           last_seen_at = case when v_place is null then null else p_last_seen_at end,
           last_seen_source = case when v_place is null then null else 'PARENT_ENTERED' end,
           last_seen_recorded_by = case when v_place is null then null else current_person() end,
           last_seen_recorded_at = case when v_place is null then null else now() end,
           draft_version = draft_version + 1
     where id = v_alert.id
     returning * into v_alert;
  else
    insert into orbit_alerts (id, child_id, created_by, wear_color, wear_garment, hair_desc,
                             carry_color, carry_item, photo_id, last_seen_place_id, last_seen_at,
                             last_seen_source, last_seen_recorded_by, last_seen_recorded_at)
    values ('oa_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12),
            p_child, current_person(), p_wear_color, p_wear_garment, p_hair,
            p_carry_color, p_carry_item, p_photo, v_place,
            case when v_place is null then null else p_last_seen_at end,
            case when v_place is null then null else 'PARENT_ENTERED' end,
            case when v_place is null then null else current_person() end,
            case when v_place is null then null else now() end)
    returning * into v_alert;
  end if;
  return v_alert;
end $$;

revoke all on function draft_orbit_share(text, text, text, text, text, text, text, text, timestamptz) from public, anon;
grant execute on function draft_orbit_share(text, text, text, text, text, text, text, text, timestamptz) to authenticated;

-- ---------------------------------------------------------------- read gate
/**
 * The sensitive accessor. Two changes from 0055:
 *   1. the place/time pair is returned ONLY when a recorded source exists — a legacy or synthetic
 *      timestamp reads as absent instead of as an observation;
 *   2. `last_seen_source` is returned so the resolver can say how the time was recorded.
 *
 * The access rule itself is unchanged: parent/guardian always, a frozen audience member only while
 * the alert is ACTIVE, nobody else.
 */
drop function if exists public.orbit_share_for(text);

create or replace function public.orbit_share_for(p_alert text)
returns table (
  wear_color        text,
  wear_garment      text,
  hair_desc         text,
  carry_color       text,
  carry_item        text,
  photo_id          text,
  minimal_message   text,
  last_seen_place_id text,
  last_seen_at      timestamptz,
  last_seen_source  text,
  place_kind        text,
  place_label       text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select a.wear_color, a.wear_garment, a.hair_desc, a.carry_color, a.carry_item,
         a.photo_id, a.minimal_message,
         case when a.last_seen_source is null then null else a.last_seen_place_id end,
         case when a.last_seen_source is null then null else a.last_seen_at end,
         a.last_seen_source,
         case when a.last_seen_source is null then null else rp.kind end,
         case when a.last_seen_source is null then null else rp.label end
    from public.orbit_alerts a
    left join public.recorded_places rp on rp.id = a.last_seen_place_id
   where a.id = p_alert
     and (
       public.is_parent_of(a.child_id)
       or (a.status = 'ACTIVE' and public._orbit_is_audience_member(a.id))
     )
$$;

revoke all on function public.orbit_share_for(text) from public, anon;
grant execute on function public.orbit_share_for(text) to authenticated;

comment on function public.orbit_share_for(text) is
  'Descriptors, stored message, photo reference and last-seen place/time for one alert. The '
  'place/time pair is returned only with a recorded provenance source; a legacy or synthetic '
  'timestamp reads as absent. Answers a parent/guardian always, a frozen audience member only '
  'while ACTIVE, and nobody else.';

commit;

-- ROLLBACK (staged; not applied):
--   drop trigger if exists orbit_alerts_last_seen_provenance on orbit_alerts;
--   drop function if exists _orbit_last_seen_provenance();
--   drop function if exists draft_orbit_share(text, text, text, text, text, text, text, text, timestamptz);
--   (recreate 0053's draft and 0055's orbit_share_for from those files)
--   alter table orbit_alerts drop constraint if exists orbit_last_seen_source_values;
--   alter table orbit_alerts
--     drop column if exists last_seen_source,
--     drop column if exists last_seen_recorded_by,
--     drop column if exists last_seen_recorded_at;
