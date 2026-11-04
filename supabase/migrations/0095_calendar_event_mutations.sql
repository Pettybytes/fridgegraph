-- 0095 — parent calendar editing: add/edit/delete events, with a recorded activity trail.
--
-- WHY
-- Until now `events` (the calendar) was read-only over GraphQL. Parents need to add, edit and
-- delete their child's events. Storage for two parent-chosen fields was missing — `notes` and a
-- `color` the parent picks in the form — so this adds them, plus three SECURITY DEFINER functions
-- that are the ONLY write path. Each one checks is_parent_of() first (so a caregiver's schedule.read
-- grant, a demo guide, or any non-parent is refused inside the database too, not only in the
-- resolver), writes the row, and records the change in `village_event` so it surfaces in Activity
-- for everyone who shares the child. A written row is read back by the existing childEvents query,
-- so it propagates to every parent and schedule.read grantee (and to Rosina, which reads childEvents)
-- with no extra plumbing.
--
-- FORWARD-ONLY. 0094 is already applied and is never edited. The commented "down" at the end is a
-- record of how to reverse by hand; it is never run by the tool.
--
-- REHEARSAL (Bentley): apply on a branch/rehearsal DB first, then verify as a parent (Kendra):
--   select * from create_calendar_event('p_nora','Dentist','2026-11-12T15:00:00','2026-11-12T15:45:00','Maple Dental','bring insurance card','#2f9e8f','confirmed');
--   select id,title,notes,color from events where child_id='p_nora' and title='Dentist';
--   select kind,source,payload->>'title' from village_event where subject_id='p_nora' order by occurred_at desc limit 1;
-- Then as a NON-parent (a schedule.read caregiver) the same call must raise FORBIDDEN. Do NOT apply
-- to the shared demo DB from an agent; Bentley applies after rehearsal.

begin;

-- ---------------------------------------------------------------- 1. parent-chosen fields
alter table events add column if not exists notes text;
alter table events add column if not exists color text;

-- ---------------------------------------------------------------- 2. helpers shared by the writers
-- Refuse any caller who is not a parent of the child. SECURITY DEFINER functions bypass RLS, so this
-- guard is what keeps a non-parent (including a demo guide, who is never a parent) from writing.
create or replace function assert_calendar_parent(p_child text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_parent_of(p_child) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
end $$;

-- Append-only record of a calendar change, visible in Activity to everyone who shares the child.
create or replace function record_calendar_activity(p_child text, p_kind text, p_event_id text, p_title text, p_start timestamp) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into village_event (id, occurred_at, actor_id, subject_id, kind, source, payload)
  values (
    've-' || replace(gen_random_uuid()::text, '-', ''),
    now(), current_person(), p_child, p_kind, 'LIVE',
    jsonb_build_object('eventId', p_event_id, 'title', p_title, 'start', to_char(p_start, 'YYYY-MM-DD"T"HH24:MI:SS'))
  );
end $$;

-- ---------------------------------------------------------------- 3. create / update / delete
create or replace function create_calendar_event(
  p_child text, p_title text, p_start timestamp, p_end timestamp,
  p_location text default null, p_notes text default null, p_color text default null,
  p_status text default 'confirmed'
) returns events
language plpgsql security definer set search_path = public as $$
declare
  v events;
begin
  perform assert_calendar_parent(p_child);
  if p_end <= p_start then raise exception 'INVALID_RANGE' using errcode = '22023'; end if;
  insert into events (id, child_id, title, start_at, end_at, location, status, notes, color, fixture)
  values ('ev-' || replace(gen_random_uuid()::text, '-', ''), p_child, p_title, p_start, p_end,
          p_location, coalesce(p_status, 'confirmed'), p_notes, p_color, false)
  returning * into v;
  perform record_calendar_activity(p_child, 'CALENDAR_EVENT_CREATED', v.id, v.title, v.start_at);
  return v;
end $$;

create or replace function update_calendar_event(
  p_id text, p_title text, p_start timestamp, p_end timestamp,
  p_location text default null, p_notes text default null, p_color text default null,
  p_status text default 'confirmed'
) returns events
language plpgsql security definer set search_path = public as $$
declare
  v events;
  v_child text;
begin
  select child_id into v_child from events where id = p_id;
  if v_child is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform assert_calendar_parent(v_child);
  if p_end <= p_start then raise exception 'INVALID_RANGE' using errcode = '22023'; end if;
  update events
     set title = p_title, start_at = p_start, end_at = p_end, location = p_location,
         notes = p_notes, color = p_color, status = coalesce(p_status, 'confirmed')
   where id = p_id
  returning * into v;
  perform record_calendar_activity(v_child, 'CALENDAR_EVENT_UPDATED', v.id, v.title, v.start_at);
  return v;
end $$;

create or replace function delete_calendar_event(p_id text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_child text;
  v_title text;
  v_start timestamp;
begin
  select child_id, title, start_at into v_child, v_title, v_start from events where id = p_id;
  if v_child is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform assert_calendar_parent(v_child);
  delete from events where id = p_id;
  perform record_calendar_activity(v_child, 'CALENDAR_EVENT_DELETED', p_id, v_title, v_start);
  return p_id;
end $$;

-- ---------------------------------------------------------------- 4. execute grants
-- Writers are callable by any authenticated caller; the is_parent_of guard inside each one decides.
-- The two helpers are internal and stay off the public/authenticated grant.
revoke all on function assert_calendar_parent(text) from public;
revoke all on function record_calendar_activity(text, text, text, text, timestamp) from public;
revoke all on function create_calendar_event(text, text, timestamp, timestamp, text, text, text, text) from public;
revoke all on function update_calendar_event(text, text, timestamp, timestamp, text, text, text, text) from public;
revoke all on function delete_calendar_event(text) from public;
grant execute on function create_calendar_event(text, text, timestamp, timestamp, text, text, text, text) to authenticated;
grant execute on function update_calendar_event(text, text, timestamp, timestamp, text, text, text, text) to authenticated;
grant execute on function delete_calendar_event(text) to authenticated;

commit;

-- DOWN (never run by the tool; forward-only history):
--   drop function if exists delete_calendar_event(text);
--   drop function if exists update_calendar_event(text, text, timestamp, timestamp, text, text, text, text);
--   drop function if exists create_calendar_event(text, text, timestamp, timestamp, text, text, text, text);
--   drop function if exists record_calendar_activity(text, text, text, text, timestamp);
--   drop function if exists assert_calendar_parent(text);
--   alter table events drop column if exists color;
--   alter table events drop column if exists notes;
