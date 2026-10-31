-- 0032 — Orbit Alert, minimal slice (no location of any kind).
--
-- FLOW: a draft (PENDING_ACTIVATION) -> parent previews the exact message -> parent confirms ->
-- ACTIVE with a FROZEN audience -> responses append -> a parent/guardian closes it.
-- States: PENDING_ACTIVATION -> ACTIVE -> CLOSED only.
--
-- NO LOCATION EXISTS: there is no location column, no coordinate, no place field. Share fields are
-- descriptive only, and `_orbit_has_location()` rejects place-like content server-side so a model
-- cannot smuggle it in. Parent confirmation never overrides that rule.
--
-- PICKUP ISOLATION: an ORBIT_ALERT job is created here and is never seen by pickupCandidate
-- evaluation/ranking/dispatch/approval, all of which filter on type = 'PICKUP'.

begin;

-- ---------------------------------------------------------------- audience (policy, frozen at activation)
create or replace function orbit_audience_for(p_child text)
returns table (person_id text, notify_order int, eligibility_source text)
language sql
stable
security definer
set search_path = public
as $$
  with policy as (
    select hp.value
      from household_policies hp
      join household_members c on c.household_id = hp.household_id
     where c.person_id = p_child and c.role = 'child' and hp.rule = 'orbit_notify_eligible'
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

-- ---------------------------------------------------------------- location refusal (server-side)
create or replace function _orbit_has_location(p_text text)
returns boolean
language sql
immutable
as $$
  select p_text is not null and p_text ~* (
    '\m(street|st\.|avenue|ave\.|road|rd\.|boulevard|blvd|lane|drive|highway|freeway|park|playground|school|elementary|middle|academy|college|university|preschool|daycare|campus|library|church|chapel|mosque|temple|mall|plaza|center|centre|station|depot|hospital|clinic|pharmacy|market|grocery|cafe|restaurant|field|court|corner|intersection|block|apartment|apt\.|suite|zip|near|nearby|usually near|last seen|across from|next to|downtown)\M'
  )
$$;

-- ---------------------------------------------------------------- tables
create table if not exists orbit_alerts (
  id             text primary key,
  job_id         text references coordination_jobs(id) on delete set null,
  child_id       text not null references children(person_id) on delete cascade,
  created_by     text not null references people(id),
  created_at     timestamptz not null default now(),
  activated_by   text references people(id),
  activated_at   timestamptz,
  status         text not null default 'PENDING_ACTIVATION'
                 check (status in ('PENDING_ACTIVATION','ACTIVE','CLOSED')),
  closed_by      text references people(id),
  closed_at      timestamptz,
  minimal_message text,
  message_hash   text,
  draft_version  int not null default 1,
  wearing        text check (wearing is null or char_length(wearing) <= 80),
  hair           text check (hair is null or char_length(hair) <= 40),
  carrying       text check (carrying is null or char_length(carrying) <= 60),
  distinctive    text check (distinctive is null or char_length(distinctive) <= 80),
  photo_id       text,
  sandbox        boolean not null default true,
  fixture        boolean not null default false,
  constraint orbit_active_consistency check (
    status <> 'ACTIVE' or (activated_at is not null and minimal_message is not null and message_hash is not null)
  ),
  constraint orbit_closed_consistency check (
    status <> 'CLOSED' or (closed_at is not null and closed_by is not null)
  )
);

create unique index if not exists orbit_one_active_per_child
  on orbit_alerts (child_id) where status = 'ACTIVE';

create table if not exists orbit_audience_members (
  orbit_alert_id      text not null references orbit_alerts(id) on delete cascade,
  person_id           text not null references people(id) on delete cascade,
  notify_order        int not null,
  notified_at         timestamptz,
  notification_outcome text,
  eligible            boolean not null default true,
  eligibility_source  text,
  primary key (orbit_alert_id, person_id)
);

create table if not exists orbit_responses (
  id              text primary key,
  orbit_alert_id  text not null references orbit_alerts(id) on delete cascade,
  person_id       text not null references people(id) on delete cascade,
  responded_at    timestamptz not null default now(),
  response        text not null check (response in ('WITH_ME','ON_WAY','CANNOT_HELP'))
);

-- Append-only: history is never rewritten. The current response is the latest row per person.
create or replace function _orbit_responses_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'ORBIT_RESPONSES_APPEND_ONLY' using errcode = '42501';
end $$;

drop trigger if exists orbit_responses_no_update on orbit_responses;
create trigger orbit_responses_no_update before update on orbit_responses
  for each row execute function _orbit_responses_append_only();
drop trigger if exists orbit_responses_no_delete on orbit_responses;
create trigger orbit_responses_no_delete before delete on orbit_responses
  for each row execute function _orbit_responses_append_only();

-- ---------------------------------------------------------------- message + hash
create or replace function _orbit_message_for(p_alert orbit_alerts)
returns text
language sql
stable
set search_path = public
as $$
  select concat(
    'FridgeGraph Orbit: check-in not recorded for ', split_part(p.child_name, ' ', 1), '. ',
    'Wearing: ', coalesce(nullif(p_alert.wearing, ''), 'not described'), '. ',
    'Hair: ', coalesce(nullif(p_alert.hair, ''), 'not described'), '. ',
    'Carrying: ', coalesce(nullif(p_alert.carrying, ''), 'not described'), '. ',
    'Distinctive: ', coalesce(nullif(p_alert.distinctive, ''), 'not described'), '. ',
    case when p_alert.photo_id is null then '' else 'Photo attached. ' end,
    'Reply WITH_ME, ON_WAY, or CANNOT_HELP.'
  )
  from (select display_name as child_name from people where id = p_alert.child_id) p
$$;

create or replace function _orbit_message_hash(p_alert orbit_alerts)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select md5(concat_ws('|',
    p_alert.child_id,
    coalesce(p_alert.wearing, ''), coalesce(p_alert.hair, ''),
    coalesce(p_alert.carrying, ''), coalesce(p_alert.distinctive, ''),
    coalesce(p_alert.photo_id, ''),
    (select string_agg(a.person_id, ',' order by a.notify_order)
       from orbit_audience_members a where a.orbit_alert_id = p_alert.id)
  ))
$$;

-- ---------------------------------------------------------------- actions
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

create or replace function preview_orbit_share(p_draft text)
returns table (alert_id text, draft_version int, message text, message_hash text, audience_size int)
language plpgsql
security definer
set search_path = public
as $$
declare v_alert orbit_alerts;
begin
  select * into v_alert from orbit_alerts where id = p_draft;
  if not found then raise exception 'ORBIT_NOT_FOUND' using errcode = 'P0002'; end if;
  if not is_parent_of(v_alert.child_id) then raise exception 'UNAUTHORIZED' using errcode = '42501'; end if;
  if v_alert.status <> 'PENDING_ACTIVATION' then raise exception 'ORBIT_NOT_DRAFT' using errcode = '22023'; end if;

  return query select v_alert.id, v_alert.draft_version, _orbit_message_for(v_alert),
                      _orbit_message_hash(v_alert),
                      (select count(*)::int from orbit_audience_for(v_alert.child_id));
end $$;

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
  if v_alert.draft_version <> p_version then
    raise exception 'ORBIT_DRAFT_STALE' using errcode = '40001';
  end if;
  if _orbit_has_location(v_alert.wearing) or _orbit_has_location(v_alert.hair)
     or _orbit_has_location(v_alert.carrying) or _orbit_has_location(v_alert.distinctive) then
    raise exception 'ORBIT_SHARE_HAS_LOCATION' using errcode = '22023';
  end if;

  v_hash := _orbit_message_hash(v_alert);
  if v_hash <> p_hash then
    raise exception 'ORBIT_PREVIEW_MISMATCH' using errcode = '40001';
  end if;

  select count(*)::int into v_count from orbit_audience_for(v_alert.child_id);
  if v_count = 0 then raise exception 'ORBIT_NO_AUDIENCE' using errcode = '22023'; end if;

  insert into coordination_jobs (id, idempotency_key, type, child_id, status, version)
  values ('job_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12),
          'orbit:' || v_alert.id, 'ORBIT_ALERT', v_alert.child_id, 'confirmed', 1)
  returning id into v_job;

  update coordination_jobs set fixture = false where id = v_job;

  insert into orbit_audience_members (orbit_alert_id, person_id, notify_order, eligible, eligibility_source)
  select v_alert.id, a.person_id, a.notify_order, true, a.eligibility_source
    from orbit_audience_for(v_alert.child_id) a;

  update orbit_alerts
     set status = 'ACTIVE', activated_by = current_person(), activated_at = now(),
         job_id = v_job, minimal_message = _orbit_message_for(v_alert), message_hash = v_hash
   where id = v_alert.id
   returning * into v_alert;

  -- SIMULATED broadcast: outcome is recorded as SIMULATED, never as delivery proof.
  update orbit_audience_members
     set notified_at = now(), notification_outcome = 'SIMULATED'
   where orbit_alert_id = v_alert.id;

  return v_alert.id;
exception
  when unique_violation then
    raise exception 'ORBIT_ALREADY_ACTIVE' using errcode = '23505';
end $$;

create or replace function respond_to_orbit_alert(p_alert text, p_response text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_alert orbit_alerts; v_id text;
begin
  if p_response not in ('WITH_ME','ON_WAY','CANNOT_HELP') then
    raise exception 'ORBIT_BAD_RESPONSE' using errcode = '22023';
  end if;
  select * into v_alert from orbit_alerts where id = p_alert;
  if not found then raise exception 'ORBIT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_alert.status <> 'ACTIVE' then raise exception 'ORBIT_NOT_ACTIVE' using errcode = '22023'; end if;
  if not exists (select 1 from orbit_audience_members m
                  where m.orbit_alert_id = p_alert and m.person_id = current_person()) then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;

  v_id := 'or_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);
  insert into orbit_responses (id, orbit_alert_id, person_id, response)
  values (v_id, p_alert, current_person(), p_response);
  return v_id;
end $$;

create or replace function close_orbit_alert(p_alert text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_alert orbit_alerts;
begin
  select * into v_alert from orbit_alerts where id = p_alert for update;
  if not found then raise exception 'ORBIT_NOT_FOUND' using errcode = 'P0002'; end if;
  if not is_parent_of(v_alert.child_id) then raise exception 'UNAUTHORIZED' using errcode = '42501'; end if;
  if v_alert.status = 'CLOSED' then return v_alert.id; end if;
  if v_alert.status <> 'ACTIVE' then raise exception 'ORBIT_NOT_ACTIVE' using errcode = '22023'; end if;

  update orbit_alerts set status = 'CLOSED', closed_by = current_person(), closed_at = now()
   where id = p_alert;
  return p_alert;
end $$;

-- ---------------------------------------------------------------- RLS helpers (break policy recursion)
-- A policy on orbit_alerts that reads orbit_audience_members, and a policy on orbit_audience_members
-- that reads orbit_alerts, recurse: Postgres raises 42P17. Both checks therefore go through
-- SECURITY DEFINER helpers, which are evaluated once and do not re-enter RLS.
create or replace function _orbit_is_audience_member(p_alert text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from orbit_audience_members m
     where m.orbit_alert_id = p_alert and m.person_id = current_person()
  )
$$;

create or replace function _orbit_is_active(p_alert text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from orbit_alerts a where a.id = p_alert and a.status = 'ACTIVE')
$$;

create or replace function _orbit_parent_of_alert(p_alert text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from orbit_alerts a where a.id = p_alert and is_parent_of(a.child_id))
$$;

-- Revoked from public/anon, GRANTED to authenticated: a policy is evaluated with the caller's
-- privileges, so a revoked helper makes every row fail closed with 42501 instead of filtering.
revoke all on function _orbit_is_audience_member(text) from public, anon;
revoke all on function _orbit_is_active(text) from public, anon;
revoke all on function _orbit_parent_of_alert(text) from public, anon;
grant execute on function _orbit_is_audience_member(text) to authenticated;
grant execute on function _orbit_is_active(text) to authenticated;
grant execute on function _orbit_parent_of_alert(text) to authenticated;

-- ---------------------------------------------------------------- RLS
alter table orbit_alerts enable row level security;
alter table orbit_audience_members enable row level security;
alter table orbit_responses enable row level security;

drop policy if exists orbit_alerts_parent on orbit_alerts;
create policy orbit_alerts_parent on orbit_alerts for select to authenticated
  using (is_parent_of(child_id));

drop policy if exists orbit_alerts_audience on orbit_alerts;
create policy orbit_alerts_audience on orbit_alerts for select to authenticated
  using (status = 'ACTIVE' and _orbit_is_audience_member(id));

drop policy if exists demo_guide_orbit_alerts on orbit_alerts;
create policy demo_guide_orbit_alerts on orbit_alerts for select to authenticated
  using (is_demo_guide() and sandbox);

drop policy if exists orbit_audience_own on orbit_audience_members;
create policy orbit_audience_own on orbit_audience_members for select to authenticated
  using (person_id = current_person() and _orbit_is_active(orbit_alert_id));

drop policy if exists orbit_audience_parent on orbit_audience_members;
create policy orbit_audience_parent on orbit_audience_members for select to authenticated
  using (_orbit_parent_of_alert(orbit_alert_id));

drop policy if exists orbit_responses_own on orbit_responses;
create policy orbit_responses_own on orbit_responses for select to authenticated
  using (person_id = current_person());

drop policy if exists orbit_responses_parent on orbit_responses;
create policy orbit_responses_parent on orbit_responses for select to authenticated
  using (_orbit_parent_of_alert(orbit_alert_id));

-- No write policy for authenticated at all: every write goes through the SECURITY DEFINER actions.
grant select on orbit_alerts, orbit_audience_members, orbit_responses to authenticated;
grant select, insert, update, delete on orbit_alerts, orbit_audience_members, orbit_responses to service_role;
grant execute on function orbit_audience_for(text) to authenticated;
grant execute on function draft_orbit_share(text,text,text,text,text,text) to authenticated;
grant execute on function preview_orbit_share(text) to authenticated;
grant execute on function activate_orbit_alert(text,int,text) to authenticated;
grant execute on function respond_to_orbit_alert(text,text) to authenticated;
grant execute on function close_orbit_alert(text) to authenticated;

commit;
