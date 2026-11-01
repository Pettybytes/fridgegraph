-- 0053 — Orbit recorded places (a curated place, never a typed address).
--
-- An Orbit message used to describe a child with no place at all: the design refused every place
-- word in the free-text descriptor fields, which is right, but it left the village with nothing to
-- go on. The fix is NOT to let a parent type "the park on Elm" — a kind check cannot tell a park
-- from a home address typed into a "PARK" row. So places are:
--
--   * CURATED: the only labels that can exist are the rows in recorded_place_catalog, seeded here,
--     fictional, with a check that rejects digits and street words. A caller can never supply a
--     label, because no write path accepts one;
--   * OWNED: every place belongs to a household, and the alert may only name a place in one of the
--     CHILD's own households — enforced in the action, in a trigger, and by RLS;
--   * COARSE: a label and a kind. No street address, no coordinates, no free-text note.
--
-- `_orbit_has_location()` is unchanged and still guards the description fields: the place enters the
-- message only through the curated row, never as text.

begin;

-- ---------------------------------------------------------------- curated catalog
create table if not exists recorded_place_catalog (
  label text primary key,
  constraint recorded_place_catalog_no_digits check (label !~ '[0-9]'),
  constraint recorded_place_catalog_no_address
    check (label !~* '\m(street|st\.|avenue|ave\.|road|rd\.|boulevard|blvd\.|lane|drive|highway|freeway|apartment|apt\.|suite|unit|floor|building)\M')
);

insert into recorded_place_catalog (label) values
  ('Maple Grove Park'),
  ('Riverside Park'),
  ('Cedar Hill Park'),
  ('Lincoln Elementary School'),
  ('Roosevelt Middle School'),
  ('Eastside Sports Field'),
  ('Northgate Practice Field')
on conflict (label) do nothing;

-- ---------------------------------------------------------------- places
create table if not exists recorded_places (
  id           text primary key,
  household_id text not null references households(id) on delete cascade,
  kind         text not null check (kind in ('SCHOOL_PICKUP', 'PRACTICE_FIELD', 'PARK')),
  label        text not null references recorded_place_catalog(label),
  sandbox      boolean not null default true,
  fixture      boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (household_id, label)
);

create index if not exists recorded_places_household on recorded_places (household_id);

-- Reads follow family membership. There is deliberately NO insert/update/delete policy: places are
-- written only by seeding and reset (SECURITY DEFINER helpers below), so no caller can add a place
-- and therefore no caller can introduce a label.
alter table recorded_places enable row level security;

drop policy if exists recorded_places_read on recorded_places;
create policy recorded_places_read on recorded_places for select to authenticated using (
  exists (
    select 1 from household_members me
     where me.household_id = recorded_places.household_id
       and me.person_id = current_person()
  )
);

-- RLS filters rows; the GRANT is what lets the role read the table at all. Without it every read
-- fails with 42501 instead of filtering, which would look like an outage rather than a boundary.
grant select on recorded_places to authenticated;

-- ---------------------------------------------------------------- family binding helpers
create or replace function _orbit_child_household_ids(p_child text)
returns setof text
language sql stable security definer set search_path = public
as $$
  select m.household_id
    from household_members m
   where m.person_id = p_child and m.role = 'child'
$$;

/**
 * True only when the place belongs to one of the CHILD's own households. Answering false for a
 * place that belongs to another family is the point: a place id from elsewhere must be refused, not
 * silently accepted because it exists.
 */
create or replace function _orbit_place_in_family(p_place text, p_child text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from recorded_places p
     where p.id = p_place
       and p.household_id in (select _orbit_child_household_ids(p_child))
  )
$$;

revoke all on function _orbit_child_household_ids(text) from public, anon;
revoke all on function _orbit_place_in_family(text, text) from public, anon;
grant execute on function _orbit_child_household_ids(text) to authenticated;
grant execute on function _orbit_place_in_family(text, text) to authenticated;

-- ---------------------------------------------------------------- alert fields
alter table orbit_alerts add column if not exists last_seen_place_id text
  references recorded_places(id) on delete set null;
alter table orbit_alerts add column if not exists last_seen_at timestamptz;

-- Structural, not just action-level: whatever writes the row, the place must be in the child's
-- family. A trigger catches a future write path that forgets to ask.
create or replace function _orbit_place_belongs_to_child()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.last_seen_place_id is not null
     and not _orbit_place_in_family(new.last_seen_place_id, new.child_id) then
    raise exception 'ORBIT_PLACE_NOT_YOURS' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists orbit_alerts_place_family on orbit_alerts;
create trigger orbit_alerts_place_family
  before insert or update of last_seen_place_id, child_id on orbit_alerts
  for each row execute function _orbit_place_belongs_to_child();

-- ---------------------------------------------------------------- message + hash
-- The last-seen place and time are rendered from the curated row, so the preview still shows the
-- EXACT text a recipient will read. When the time is absent the sentence omits it rather than
-- printing an empty slot; when the place is absent there is no sentence at all.
create or replace function _orbit_message_for(p_alert orbit_alerts)
returns text
language sql stable security definer set search_path = public
as $$
  select concat_ws(' ',
    'FridgeGraph Orbit: check-in not recorded for ' || split_part(p.child_name, ' ', 1) || '.',
    case when trim(concat_ws(' ', p_alert.wear_color, p_alert.wear_garment)) <> ''
         then 'Wearing: ' || trim(concat_ws(' ', p_alert.wear_color, p_alert.wear_garment)) || '.' end,
    case when coalesce(trim(p_alert.hair_desc), '') <> ''
         then 'Hair: ' || trim(p_alert.hair_desc) || '.' end,
    case when trim(concat_ws(' ', p_alert.carry_color, p_alert.carry_item)) <> ''
         then 'Carrying: ' || trim(concat_ws(' ', p_alert.carry_color, p_alert.carry_item)) || '.' end,
    case when p_alert.last_seen_place_id is null then null
         else 'Last seen: ' || (select rp.label from recorded_places rp where rp.id = p_alert.last_seen_place_id)
              || coalesce(' at ' || to_char(p_alert.last_seen_at at time zone 'America/Detroit', 'FMHH12:MI AM'), '')
              || '.' end,
    case when p_alert.photo_id is null then null else 'Photo attached.' end,
    'Reply 1 = With me, 2 = On my way, 3 = Can''t help.'
  )
  from (select display_name as child_name from people where id = p_alert.child_id) p
$$;

-- The hash binds the RENDERED message plus the audience order. A place or time change necessarily
-- produces a different rendered message, hence a different hash, so a preview minted before the
-- change can no longer activate.
create or replace function _orbit_message_hash(p_alert orbit_alerts)
returns text
language sql stable security definer set search_path = public, extensions
as $$
  select encode(digest(
    _orbit_message_for(p_alert) || '|' ||
    coalesce(p_alert.last_seen_place_id, '') || '|' ||
    coalesce(to_char(p_alert.last_seen_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS'), '') || '|' ||
    coalesce((select string_agg(a.person_id, ',' order by a.notify_order)
                from orbit_audience_for(p_alert.child_id) a), '')
  , 'sha256'), 'hex')
$$;

-- ---------------------------------------------------------------- draft accepts a place
-- Replaces the 7-argument draft: two defaulted parameters would leave two overloads and make the
-- PostgREST call ambiguous, so the old signature is dropped first.
drop function if exists draft_orbit_share(text, text, text, text, text, text, text);

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
           draft_version = draft_version + 1
     where id = v_alert.id
     returning * into v_alert;
  else
    insert into orbit_alerts (id, child_id, created_by, wear_color, wear_garment, hair_desc,
                             carry_color, carry_item, photo_id, last_seen_place_id, last_seen_at)
    values ('oa_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12),
            p_child, current_person(), p_wear_color, p_wear_garment, p_hair,
            p_carry_color, p_carry_item, p_photo, v_place,
            case when v_place is null then null else p_last_seen_at end)
    returning * into v_alert;
  end if;
  return v_alert;
end $$;

-- ---------------------------------------------------------------- seeding + reset
/**
 * Idempotent: the demo families get a small, plausible set of places. Every household named here is
 * a sandbox household in the Cast v2 fixtures. Nothing is created for a household that no longer
 * exists.
 */
create or replace function seed_recorded_places()
returns int
language plpgsql security definer set search_path = public
as $$
declare v_added int := 0;
begin
  with wanted(household_id, kind, label) as (
    values
      ('h_a', 'SCHOOL_PICKUP', 'Lincoln Elementary School'),
      ('h_a', 'PARK',          'Maple Grove Park'),
      ('h_a', 'PRACTICE_FIELD','Eastside Sports Field'),
      ('h_b', 'SCHOOL_PICKUP', 'Lincoln Elementary School'),
      ('h_b', 'PARK',          'Riverside Park'),
      ('h_c', 'SCHOOL_PICKUP', 'Roosevelt Middle School'),
      ('h_c', 'PARK',          'Cedar Hill Park'),
      ('h_emma', 'SCHOOL_PICKUP', 'Roosevelt Middle School'),
      ('h_malik', 'PARK', 'Maple Grove Park'),
      ('h_micah', 'SCHOOL_PICKUP', 'Lincoln Elementary School'),
      ('h_taylor', 'PRACTICE_FIELD', 'Northgate Practice Field')
  )
  insert into recorded_places (id, household_id, kind, label, sandbox, fixture)
  select 'rp_' || substr(md5(w.household_id || ':' || w.label), 1, 12), w.household_id, w.kind, w.label, true, true
    from wanted w
    join households h on h.id = w.household_id
   where not exists (
     select 1 from recorded_places p where p.household_id = w.household_id and p.label = w.label
   );
  get diagnostics v_added = row_count;
  return v_added;
end $$;

revoke all on function seed_recorded_places() from public, anon;
grant execute on function seed_recorded_places() to authenticated;

select seed_recorded_places();

-- Reset restores the seeded places and removes any place that was not seeded: an Orbit place is
-- demo data, and a reset that left yesterday's place behind would let a stale preview still bind.
create or replace function reset_demo_places(p_actor text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_removed int := 0; v_added int := 0;
begin
  perform set_config('app.demo_reset', 'on', true);
  -- Detach any alert that referenced a place, so the delete is not blocked by the FK.
  update orbit_alerts set last_seen_place_id = null where last_seen_place_id is not null and sandbox is true;
  delete from recorded_places where sandbox is true and fixture is false;
  get diagnostics v_removed = row_count;
  v_added := seed_recorded_places();
  insert into demo_reset_audit (actor, removed)
  values (p_actor, jsonb_build_object('recorded_places_removed', v_removed, 'recorded_places_added', v_added));
  perform set_config('app.demo_reset', 'off', true);
  return jsonb_build_object('recorded_places_removed', v_removed, 'recorded_places_added', v_added);
end $$;

revoke all on function reset_demo_places(text) from public, anon;
grant execute on function reset_demo_places(text) to authenticated;

-- Both reset paths (`/__reset` and resetDemo) go through this one function, so places are restored
-- on either. Body is otherwise unchanged from 0042/0043/0044/0045.
create or replace function reset_demo_orbit(p_actor text, p_extra jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_responses int := 0; v_audience int := 0; v_alerts jsonb; v_places jsonb;
begin
  perform set_config('app.demo_reset', 'on', true);

  -- Snapshot FIRST, with all rows present.
  create temp table if not exists reset_eligibility (alert_id text primary key) on commit drop;
  delete from reset_eligibility;
  insert into reset_eligibility (alert_id)
  select a.id
    from orbit_alerts a
   where a.sandbox is true
     -- real-consented protection, by explicit markers only
     and (to_regclass('public.real_call_authorizations') is null
          or not exists (select 1 from real_call_authorizations r where r.job_id = a.job_id))
     and not exists (select 1 from attempts x
                      where x.job_id = a.job_id and x.real_consent_authorization_id is not null)
     -- every audience outcome must be a disposable one; NULL is NOT disposable
     and not exists (select 1 from orbit_audience_members m
                      where m.orbit_alert_id = a.id
                        and m.notification_outcome is distinct from 'SIMULATED'
                        and m.notification_outcome is distinct from 'TEST_RESPONDER');

  select coalesce(jsonb_agg(alert_id), '[]'::jsonb) into v_alerts from reset_eligibility;

  delete from orbit_responses r using reset_eligibility e where r.orbit_alert_id = e.alert_id;
  get diagnostics v_responses = row_count;
  delete from orbit_audience_members m using reset_eligibility e where m.orbit_alert_id = e.alert_id;
  get diagnostics v_audience = row_count;
  delete from orbit_alerts a using reset_eligibility e where a.id = e.alert_id;

  -- Places after the alerts, so nothing still references a place that is about to be replaced.
  v_places := reset_demo_places(p_actor);

  insert into demo_reset_audit (actor, removed)
  values (p_actor, jsonb_build_object('orbit_responses', v_responses,
                                      'orbit_audience_members', v_audience,
                                      'orbit_alerts', jsonb_array_length(v_alerts),
                                      'alerts', v_alerts) || v_places || coalesce(p_extra, '{}'::jsonb));
  perform set_config('app.demo_reset', 'off', true);
  return jsonb_build_object('orbit_responses', v_responses, 'orbit_audience_members', v_audience,
                            'orbit_alerts', jsonb_array_length(v_alerts)) || v_places || coalesce(p_extra, '{}'::jsonb);
end $$;

commit;
