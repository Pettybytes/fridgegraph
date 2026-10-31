-- 0033 — Orbit hardening: SHA-256 binding, photo identity binding, caller-scoped helpers.
--
-- 1. message_hash is SHA-256 over the share fields, the photo's CONTENT hash and the frozen audience.
--    It binds the parent's confirmation to the exact preview they saw.
-- 2. A photo is accepted only when it belongs to THIS child and THIS parent and its bytes are
--    immutable (content hash stored at upload; the row cannot be re-pointed at different bytes).
-- 3. The RLS helpers answer only about the CALLER's own access. A direct RPC call with somebody
--    else's ids returns false; it never reveals an alert's existence or another person's membership.

begin;

-- ---------------------------------------------------------------- photo identity
create table if not exists orbit_photos (
  id              text primary key,
  child_id        text not null references children(person_id) on delete cascade,
  owner_person_id text not null references people(id) on delete cascade,
  content_sha256  text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  created_at      timestamptz not null default now(),
  fixture         boolean not null default false
);

create or replace function _orbit_photos_immutable()
returns trigger language plpgsql as $$
begin
  if new.content_sha256 is distinct from old.content_sha256
     or new.child_id is distinct from old.child_id
     or new.owner_person_id is distinct from old.owner_person_id then
    raise exception 'ORBIT_PHOTO_IMMUTABLE' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists orbit_photos_immutable on orbit_photos;
create trigger orbit_photos_immutable before update on orbit_photos
  for each row execute function _orbit_photos_immutable();

alter table orbit_photos enable row level security;
drop policy if exists orbit_photos_owner on orbit_photos;
create policy orbit_photos_owner on orbit_photos for select to authenticated
  using (owner_person_id = current_person() or is_parent_of(child_id));

grant select on orbit_photos to authenticated;
grant select, insert, update, delete on orbit_photos to service_role;

-- ---------------------------------------------------------------- sha256 binding
create or replace function _orbit_message_hash(p_alert orbit_alerts)
returns text
language sql
stable
security definer
set search_path = public, extensions
as $$
  select encode(digest(concat_ws('|',
    p_alert.child_id,
    coalesce(p_alert.wearing, ''), coalesce(p_alert.hair, ''),
    coalesce(p_alert.carrying, ''), coalesce(p_alert.distinctive, ''),
    coalesce((select ph.content_sha256 from orbit_photos ph where ph.id = p_alert.photo_id), ''),
    -- The RESOLVED audience from policy, not the frozen table: a draft has no audience rows yet,
    -- so hashing those would make every draft bind an empty list and an audience change invisible.
    (select string_agg(a.person_id, ',' order by a.notify_order)
       from orbit_audience_for(p_alert.child_id) a)
  ), 'sha256'), 'hex')
$$;

-- A photo id is only usable by the parent who uploaded it, for that parent's child.
create or replace function draft_orbit_share(
  p_child text,
  p_wearing text default null,
  p_hair text default null,
  p_carrying text default null,
  p_distinctive text default null,
  p_photo text default null
) returns orbit_alerts
language plpgsql
security definer
set search_path = public
as $$
declare v_alert orbit_alerts;
begin
  if not is_parent_of(p_child) then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;
  if _orbit_has_location(p_wearing) or _orbit_has_location(p_hair)
     or _orbit_has_location(p_carrying) or _orbit_has_location(p_distinctive) then
    raise exception 'ORBIT_SHARE_HAS_LOCATION' using errcode = '22023';
  end if;
  if p_photo is not null and not exists (
    select 1 from orbit_photos ph
     where ph.id = p_photo and ph.child_id = p_child and ph.owner_person_id = current_person()
  ) then
    raise exception 'ORBIT_PHOTO_NOT_YOURS' using errcode = '42501';
  end if;

  select * into v_alert from orbit_alerts
   where child_id = p_child and status = 'PENDING_ACTIVATION' and created_by = current_person()
   order by created_at desc limit 1;

  if found then
    update orbit_alerts
       set wearing = p_wearing, hair = p_hair, carrying = p_carrying,
           distinctive = p_distinctive, photo_id = coalesce(p_photo, photo_id),
           draft_version = draft_version + 1
     where id = v_alert.id
     returning * into v_alert;
  else
    insert into orbit_alerts (id, child_id, created_by, wearing, hair, carrying, distinctive, photo_id)
    values ('oa_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12),
            p_child, current_person(), p_wearing, p_hair, p_carrying, p_distinctive, p_photo)
    returning * into v_alert;
  end if;
  return v_alert;
end $$;

-- ---------------------------------------------------------------- caller-scoped helpers
-- Each answers ONLY about current_person(). A direct RPC with another child/alert/person returns
-- false; it cannot reveal that an alert exists or that somebody else is in an audience.
create or replace function _orbit_can_see_alert(p_alert text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from orbit_alerts a
     where a.id = p_alert
       and (
         is_parent_of(a.child_id)
         or (a.status = 'ACTIVE' and _orbit_is_audience_member(p_alert))
         or (is_demo_guide() and a.sandbox)
       )
  )
$$;

create or replace function _orbit_is_parent_of_alert(p_alert text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from orbit_alerts a where a.id = p_alert and is_parent_of(a.child_id))
$$;

-- The 0032 policy depends on _orbit_is_active, so the policy must go FIRST; otherwise the drop
-- fails with 2BP01 (dependent objects). It is recreated below on the caller-scoped helper.
drop policy if exists orbit_audience_own on orbit_audience_members;
revoke all on function _orbit_is_active(text) from public, anon, authenticated;
drop function if exists _orbit_is_active(text);

revoke all on function _orbit_can_see_alert(text) from public, anon;
revoke all on function _orbit_is_parent_of_alert(text) from public, anon;
revoke all on function _orbit_is_audience_member(text) from public, anon;
grant execute on function _orbit_can_see_alert(text) to authenticated;
grant execute on function _orbit_is_parent_of_alert(text) to authenticated;
grant execute on function _orbit_is_audience_member(text) to authenticated;

create policy orbit_audience_own on orbit_audience_members for select to authenticated
  using (person_id = current_person() and _orbit_can_see_alert(orbit_alert_id));

drop policy if exists orbit_audience_parent on orbit_audience_members;
create policy orbit_audience_parent on orbit_audience_members for select to authenticated
  using (_orbit_is_parent_of_alert(orbit_alert_id));

drop policy if exists orbit_responses_parent on orbit_responses;
create policy orbit_responses_parent on orbit_responses for select to authenticated
  using (_orbit_is_parent_of_alert(orbit_alert_id));

grant execute on function draft_orbit_share(text,text,text,text,text,text) to authenticated;
grant execute on function preview_orbit_share(text) to authenticated;
grant execute on function activate_orbit_alert(text,int,text) to authenticated;

commit;
