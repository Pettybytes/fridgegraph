-- 0037 — photo access, decided on EVERY request, by the database itself.
--
-- `orbit_photo_access` returns the caller's CURRENT authority for one photo: PARENT (parent/guardian
-- of the child — allowed after closure, since a parent reviewing a closed alert may still look at what
-- was shared), AUDIENCE (a frozen audience member, only while the alert is ACTIVE), or null.
--
-- The storage path is returned only when access is granted, so an unauthorised caller receives the
-- same empty answer as a nonexistent photo id — no oracle. No signed URL is ever produced.

begin;

alter table orbit_photos add column if not exists storage_path text;

create or replace function orbit_photo_access(p_photo text)
returns table (access text, storage_path text, child_id text)
language sql
stable
security definer
set search_path = public
as $$
  with ph as (
    select id, child_id, storage_path from orbit_photos where id = p_photo
  ),
  alert as (
    select al.id, al.status
      from orbit_alerts al
     where al.photo_id = p_photo
     order by al.activated_at desc nulls last, al.created_at desc
     limit 1
  ),
  lvl as (
    select case
             when (select is_parent_of(child_id) from ph) then 'PARENT'
             when (select status from alert) = 'ACTIVE'
                  and (select _orbit_is_audience_member((select id from alert))) then 'AUDIENCE'
             else null
           end as access
  )
  select lvl.access,
         case when lvl.access is not null then (select storage_path from ph) else null end,
         case when lvl.access is not null then (select child_id from ph) else null end
    from lvl
$$;

-- Upload registration: parent/guardian only, hash must be a real SHA-256, path is server-written.
create or replace function register_orbit_photo(p_child text, p_sha256 text, p_path text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_id text;
begin
  if not is_parent_of(p_child) then raise exception 'UNAUTHORIZED' using errcode = '42501'; end if;
  if p_sha256 is null or p_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'ORBIT_PHOTO_BAD_HASH' using errcode = '22023';
  end if;
  v_id := 'ph_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);
  insert into orbit_photos (id, child_id, owner_person_id, content_sha256, storage_path)
  values (v_id, p_child, current_person(), p_sha256, p_path);
  return v_id;
end $$;

grant execute on function orbit_photo_access(text) to authenticated;
grant execute on function register_orbit_photo(text, text, text) to authenticated;

commit;
