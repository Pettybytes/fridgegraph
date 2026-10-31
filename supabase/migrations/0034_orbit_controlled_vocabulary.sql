-- 0034 — Orbit share descriptors are CONTROLLED VOCABULARY, not free text.
--
-- The privacy guarantee is that audience-facing text is generated ONLY from validated vocabulary
-- values through the app-owned template. Unmapped phrases never reach the notification; Rosina asks a
-- clarifying question instead. `_orbit_has_location()` stays as defence in depth — it is NOT the
-- guarantee.
--
-- `distinctive` is retired from the audience payload, the template and the hash: arbitrary text is not
-- broadcast in this slice. The legacy column is left in place, unused, so old drafts do not lose data.

begin;

create table if not exists orbit_vocabulary (
  kind     text not null check (kind in ('WEAR_COLOR','WEAR_GARMENT','HAIR','CARRY_COLOR','CARRY_ITEM')),
  value    text not null,
  version  int  not null default 1,
  primary key (kind, value)
);

insert into orbit_vocabulary (kind, value) values
  ('WEAR_COLOR','black'),('WEAR_COLOR','white'),('WEAR_COLOR','grey'),('WEAR_COLOR','navy'),
  ('WEAR_COLOR','blue'),('WEAR_COLOR','red'),('WEAR_COLOR','green'),('WEAR_COLOR','yellow'),
  ('WEAR_COLOR','purple'),('WEAR_COLOR','pink'),('WEAR_COLOR','orange'),('WEAR_COLOR','brown'),
  ('WEAR_COLOR','tan'),('WEAR_COLOR','beige'),
  ('WEAR_GARMENT','hoodie'),('WEAR_GARMENT','raincoat'),('WEAR_GARMENT','jacket'),('WEAR_GARMENT','coat'),
  ('WEAR_GARMENT','t-shirt'),('WEAR_GARMENT','sweater'),('WEAR_GARMENT','dress'),('WEAR_GARMENT','skirt'),
  ('WEAR_GARMENT','trousers'),('WEAR_GARMENT','jeans'),('WEAR_GARMENT','shorts'),('WEAR_GARMENT','uniform'),
  ('HAIR','short'),('HAIR','long'),('HAIR','ponytail'),('HAIR','bun'),('HAIR','braids'),
  ('HAIR','curly'),('HAIR','straight'),('HAIR','buzz cut'),
  ('CARRY_COLOR','black'),('CARRY_COLOR','white'),('CARRY_COLOR','grey'),('CARRY_COLOR','navy'),
  ('CARRY_COLOR','blue'),('CARRY_COLOR','red'),('CARRY_COLOR','green'),('CARRY_COLOR','yellow'),
  ('CARRY_COLOR','purple'),('CARRY_COLOR','pink'),('CARRY_COLOR','orange'),('CARRY_COLOR','brown'),
  ('CARRY_COLOR','tan'),('CARRY_COLOR','beige'),
  ('CARRY_ITEM','backpack'),('CARRY_ITEM','school bag'),('CARRY_ITEM','lunchbox'),('CARRY_ITEM','water bottle'),
  ('CARRY_ITEM','book bag'),('CARRY_ITEM','sports bag'),('CARRY_ITEM','instrument case')
on conflict do nothing;

create or replace function orbit_vocab_ok(p_kind text, p_value text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select p_value is null or exists (
    select 1 from orbit_vocabulary v where v.kind = p_kind and v.value = lower(p_value)
  )
$$;

grant select on orbit_vocabulary to authenticated;
grant select, insert, update, delete on orbit_vocabulary to service_role;
grant execute on function orbit_vocab_ok(text, text) to authenticated;

-- ---------------------------------------------------------------- columns
alter table orbit_alerts add column if not exists wear_color  text;
alter table orbit_alerts add column if not exists wear_garment text;
alter table orbit_alerts add column if not exists hair_desc   text;
alter table orbit_alerts add column if not exists carry_color text;
alter table orbit_alerts add column if not exists carry_item  text;

-- ---------------------------------------------------------------- template: vocabulary only
create or replace function _orbit_message_for(p_alert orbit_alerts)
returns text
language sql stable security definer set search_path = public
as $$
  select concat(
    'FridgeGraph Orbit: check-in not recorded for ', split_part(p.child_name, ' ', 1), '. ',
    'Wearing: ', coalesce(nullif(trim(concat_ws(' ', p_alert.wear_color, p_alert.wear_garment)), ''), 'not described'), '. ',
    'Hair: ', coalesce(nullif(p_alert.hair_desc, ''), 'not described'), '. ',
    'Carrying: ', coalesce(nullif(trim(concat_ws(' ', p_alert.carry_color, p_alert.carry_item)), ''), 'not described'), '. ',
    case when p_alert.photo_id is null then '' else 'Photo attached. ' end,
    'Reply WITH_ME, ON_WAY, or CANNOT_HELP.'
  )
  from (select display_name as child_name from people where id = p_alert.child_id) p
$$;

-- ---------------------------------------------------------------- hash: vocabulary values only
create or replace function _orbit_message_hash(p_alert orbit_alerts)
returns text
language sql stable security definer set search_path = public, extensions
as $$
  select encode(digest(concat_ws('|',
    p_alert.child_id,
    coalesce(p_alert.wear_color, ''), coalesce(p_alert.wear_garment, ''),
    coalesce(p_alert.hair_desc, ''), coalesce(p_alert.carry_color, ''), coalesce(p_alert.carry_item, ''),
    coalesce((select ph.content_sha256 from orbit_photos ph where ph.id = p_alert.photo_id), ''),
    (select string_agg(a.person_id, ',' order by a.notify_order) from orbit_audience_for(p_alert.child_id) a)
  ), 'sha256'), 'hex')
$$;

-- ---------------------------------------------------------------- audience list is caller-scoped
-- Only the child's parent/guardian (and the read-only guide on sandbox data) may resolve the list.
-- Everyone else gets NO ROWS — identical to a nonexistent child id, so the function cannot be used to
-- learn who is in a village or whether a child exists.
create or replace function orbit_audience_for(p_child text)
returns table (person_id text, notify_order int, eligibility_source text)
language sql
stable
security definer
set search_path = public
as $$
  with allowed as (
    select 1
     where is_parent_of(p_child)
        or (is_demo_guide() and is_sandbox_child(p_child))
  ),
  policy as (
    select hp.value
      from household_policies hp
      join household_members c on c.household_id = hp.household_id
     where c.person_id = p_child and c.role = 'child' and hp.rule = 'orbit_notify_eligible'
       and exists (select 1 from allowed)
     limit 1
  ),
  ids as (
    select trim(t.x) as id, t.ordinality::int as ord
      from policy, unnest(string_to_array(policy.value, ',')) with ordinality as t(x, ordinality)
     where trim(t.x) <> ''
  )
  select i.id, i.ord, 'POLICY:orbit_notify_eligible'::text
    from ids i
    join people p on p.id = i.id
   where i.id <> p_child
   order by i.ord
$$;

-- ---------------------------------------------------------------- draft: vocabulary args only
drop function if exists draft_orbit_share(text,text,text,text,text,text);

create or replace function draft_orbit_share(
  p_child text,
  p_wear_color text default null,
  p_wear_garment text default null,
  p_hair text default null,
  p_carry_color text default null,
  p_carry_item text default null,
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

  -- Every value must be IN the vocabulary. An unmapped phrase is not "cleaned" — it is refused, and
  -- the caller (Rosina) asks the parent for a descriptor that maps.
  if not orbit_vocab_ok('WEAR_COLOR', p_wear_color) then raise exception 'ORBIT_VALUE_NOT_IN_VOCAB' using errcode = '22023'; end if;
  if not orbit_vocab_ok('WEAR_GARMENT', p_wear_garment) then raise exception 'ORBIT_VALUE_NOT_IN_VOCAB' using errcode = '22023'; end if;
  if not orbit_vocab_ok('HAIR', p_hair) then raise exception 'ORBIT_VALUE_NOT_IN_VOCAB' using errcode = '22023'; end if;
  if not orbit_vocab_ok('CARRY_COLOR', p_carry_color) then raise exception 'ORBIT_VALUE_NOT_IN_VOCAB' using errcode = '22023'; end if;
  if not orbit_vocab_ok('CARRY_ITEM', p_carry_item) then raise exception 'ORBIT_VALUE_NOT_IN_VOCAB' using errcode = '22023'; end if;

  -- Defence in depth only: the values are already from a closed vocabulary.
  if _orbit_has_location(p_wear_color) or _orbit_has_location(p_wear_garment)
     or _orbit_has_location(p_hair) or _orbit_has_location(p_carry_color) or _orbit_has_location(p_carry_item) then
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
       set wear_color = lower(p_wear_color), wear_garment = lower(p_wear_garment),
           hair_desc = lower(p_hair), carry_color = lower(p_carry_color), carry_item = lower(p_carry_item),
           photo_id = coalesce(p_photo, photo_id), draft_version = draft_version + 1
     where id = v_alert.id returning * into v_alert;
  else
    insert into orbit_alerts (id, child_id, created_by, wear_color, wear_garment, hair_desc, carry_color, carry_item, photo_id)
    values ('oa_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12),
            p_child, current_person(), lower(p_wear_color), lower(p_wear_garment), lower(p_hair),
            lower(p_carry_color), lower(p_carry_item), p_photo)
    returning * into v_alert;
  end if;
  return v_alert;
end $$;

-- activation re-checked against the VOCABULARY fields; the retired `distinctive` column is not
-- consulted at all (it is never broadcast), so legacy text cannot silently block a valid draft.
create or replace function activate_orbit_alert(p_draft text, p_version int, p_hash text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_alert orbit_alerts; v_job text; v_hash text; v_count int;
begin
  select * into v_alert from orbit_alerts where id = p_draft for update;
  if not found then raise exception 'ORBIT_NOT_FOUND' using errcode = 'P0002'; end if;
  if not is_parent_of(v_alert.child_id) then raise exception 'UNAUTHORIZED' using errcode = '42501'; end if;
  if v_alert.status <> 'PENDING_ACTIVATION' then raise exception 'ORBIT_NOT_DRAFT' using errcode = '22023'; end if;
  if v_alert.draft_version <> p_version then raise exception 'ORBIT_DRAFT_STALE' using errcode = '40001'; end if;

  if not orbit_vocab_ok('WEAR_COLOR', v_alert.wear_color)
     or not orbit_vocab_ok('WEAR_GARMENT', v_alert.wear_garment)
     or not orbit_vocab_ok('HAIR', v_alert.hair_desc)
     or not orbit_vocab_ok('CARRY_COLOR', v_alert.carry_color)
     or not orbit_vocab_ok('CARRY_ITEM', v_alert.carry_item) then
    raise exception 'ORBIT_VALUE_NOT_IN_VOCAB' using errcode = '22023';
  end if;
  if _orbit_has_location(v_alert.wear_color) or _orbit_has_location(v_alert.wear_garment)
     or _orbit_has_location(v_alert.hair_desc) or _orbit_has_location(v_alert.carry_color)
     or _orbit_has_location(v_alert.carry_item) then
    raise exception 'ORBIT_SHARE_HAS_LOCATION' using errcode = '22023';
  end if;

  v_hash := _orbit_message_hash(v_alert);
  if v_hash <> p_hash then raise exception 'ORBIT_PREVIEW_MISMATCH' using errcode = '40001'; end if;

  select count(*)::int into v_count from orbit_audience_for(v_alert.child_id);
  if v_count = 0 then raise exception 'ORBIT_NO_AUDIENCE' using errcode = '22023'; end if;

  insert into coordination_jobs (id, idempotency_key, type, child_id, status, version)
  values ('job_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12),
          'orbit:' || v_alert.id, 'ORBIT_ALERT', v_alert.child_id, 'confirmed', 1)
  returning id into v_job;

  insert into orbit_audience_members (orbit_alert_id, person_id, notify_order, eligible, eligibility_source)
  select v_alert.id, a.person_id, a.notify_order, true, a.eligibility_source
    from orbit_audience_for(v_alert.child_id) a;

  update orbit_alerts
     set status = 'ACTIVE', activated_by = current_person(), activated_at = now(),
         job_id = v_job, minimal_message = _orbit_message_for(v_alert), message_hash = v_hash
   where id = v_alert.id returning * into v_alert;

  update orbit_audience_members
     set notified_at = now(), notification_outcome = 'SIMULATED'
   where orbit_alert_id = v_alert.id;

  return v_alert.id;
exception
  when unique_violation then
    raise exception 'ORBIT_ALREADY_ACTIVE' using errcode = '23505';
end $$;

grant execute on function draft_orbit_share(text,text,text,text,text,text,text) to authenticated;

commit;
