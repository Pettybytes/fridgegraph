-- 0013 — Station 06: coordination schema + the ONLY write paths for the pickup job.
--
-- Source of truth: docs/contracts/pickup-job.md (Rev 3), docs/contracts/webhook.md at ad188f2.
--
-- SECURITY MODEL (read this before changing anything here):
--   * `authenticated` gets SELECT only on the coordination tables. There is NO insert/update/delete
--     grant to `authenticated` anywhere in this file. A signed-in user therefore cannot write
--     candidate_evaluations, cannot set her own reason_code, cannot set a job to `confirmed`, and
--     cannot insert a confirmation — the Data API has no privilege to attempt it.
--   * Every state transition lives in a SECURITY DEFINER function below. Each one:
--       - resolves the caller with current_person() and checks the contract's rule for that action,
--       - derives every reason code from data (grants, contact_methods, capabilities, vehicles,
--         household policy) — never from a caller-supplied argument,
--       - performs its transition atomically under SELECT ... FOR UPDATE,
--       - pins search_path,
--       - has EXECUTE revoked from PUBLIC and anon, granted to authenticated (0012 posture).
--   * RLS stays exactly as shipped: the coordination tables keep ENABLE + FORCE from 0003. This
--     migration does not weaken, drop or replace any existing policy.
--   * NOTE ON EXECUTION: these functions are owned by the migration role. They are the only writer,
--     so they must run with the owner's privileges (the standard Supabase migration role bypasses
--     RLS). The first-apply smoke test proves this: if a parent cannot create a job, stop and
--     report — do not "fix" it by relaxing RLS.
--
-- ADDITIVE: no drops, no renames, no type changes on existing columns. New checks are NOT VALID.

begin;

-- ---------------------------------------------------------------------------
-- 1. Existing tables: nullable additions
-- ---------------------------------------------------------------------------

alter table coordination_jobs
  add column if not exists request_version            int  not null default 1,
  add column if not exists discovery_timeout_seconds  int  not null default 60,
  add column if not exists approval_timeout_seconds   int  not null default 120,
  add column if not exists failure_reason             text,
  add column if not exists as_of                      date,
  add column if not exists created_at                 timestamptz not null default now();

alter table attempts
  add column if not exists candidate_id        text references people(id) on delete cascade,
  add column if not exists destination         text,
  add column if not exists destination_mode    text not null default 'TEST_RESPONDER',
  add column if not exists provider_message_id text,
  add column if not exists late_reply          boolean not null default false;

alter table confirmations
  add column if not exists candidate_id text references people(id) on delete cascade,
  add column if not exists approved_by  text references people(id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'coordination_jobs_status_check') then
    alter table coordination_jobs add constraint coordination_jobs_status_check
      check (status in ('pending','discovering','awaiting_approval','confirmed','failed')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'attempts_destination_mode_check') then
    alter table attempts add constraint attempts_destination_mode_check
      check (destination_mode in ('TEST_RESPONDER','REAL_CONSENTED')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'attempts_channel_check') then
    alter table attempts add constraint attempts_channel_check
      check (channel in ('SMS','CALL')) not valid;
  end if;
end $$;

-- One attempt per candidate per job, and exactly one approved caregiver per job.
create unique index if not exists attempts_job_candidate_uq on attempts (job_id, candidate_id);
create unique index if not exists confirmations_one_per_job on confirmations (job_id);

-- ---------------------------------------------------------------------------
-- 2. New tables
-- ---------------------------------------------------------------------------

create table if not exists candidate_evaluations (
  id                  text primary key,
  job_id              text not null references coordination_jobs(id) on delete cascade,
  request_version     int  not null default 1,
  candidate_id        text not null references people(id) on delete cascade,
  -- NULL means "determination pending": the person was asked and has not answered, and no gate has
  -- failed yet. It is NOT a ninth code — the contract's eight codes are the only values written.
  reason_code         text check (reason_code in (
                        'UNAUTHORIZED','NO_VERIFIED_CONTACT_METHOD','UNREACHABLE','UNAVAILABLE',
                        'AVAILABLE_NO_TRANSPORT','OVER_POLICY','RECOMMENDED','APPROVAL_PENDING')),
  available           boolean,        -- null = UNKNOWN; set only by a human response
  decline_reason      text check (decline_reason in ('BUSY','NO_TRANSPORT','OTHER')),
  accepted_via        text check (accepted_via in ('WEBHOOK_CALLBACK','CANDIDATE_JWT')),
  estimated_ride_cost_usd numeric(10,2),
  cost_basis          text,
  distance_miles      numeric(6,2),
  location_provenance text check (location_provenance in ('SUPPLIED','ESTIMATED','VERIFIED')),
  cost_calculated_at  timestamptz,
  late_reply          boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (job_id, request_version, candidate_id)
);

create unique index if not exists candidate_evaluations_one_active_recommendation
  on candidate_evaluations (job_id, request_version)
  where reason_code in ('RECOMMENDED','APPROVAL_PENDING');

-- Gate 2 of the real-call exception. Server-side only; no policy, no grant to authenticated.
create table if not exists real_call_authorizations (
  id             text primary key,
  attempt_id     text not null references attempts(id) on delete cascade,
  request_version int not null default 1,
  recipient_ref  text not null,           -- a GHL-side identifier; never a literal phone number
  issued_at      timestamptz not null default now(),
  expires_at     timestamptz not null,
  consumed_at    timestamptz,
  constraint real_call_authorizations_expiry_after_issue check (expires_at > issued_at)
);

-- The canonical Location model (pickup-job.md §6).
--
-- Linkage and readership:
--   owner_type = 'CHILD'  -> owner_id is a child; the child's own places (school, home, practice).
--                            Readable by that child's parents, or by a holder of address.read for
--                            that child. These are the only rows a child-grant can ever reach.
--   owner_type = 'PERSON' -> owner_id is a person, used ONLY for a candidate's own origin point.
--                            Readable by that person and nobody else. A parent, an address.read
--                            holder, or any other signed-in user gets zero rows. Distances from
--                            these rows are computed server-side inside the ranking function and
--                            only the derived number is surfaced — a candidate's home address is
--                            never returned to a parent or the approver.
--   owner_type = 'PLACE'  -> reserved; no policy, so service-role only. Not used in this milestone.
--
-- What `source` means (no real GPS exists in this milestone):
--   SUPPLIED  — an address a person typed in.
--   ESTIMATED — a modelled/placeholder coordinate (all demo coordinates are this).
--   VERIFIED  — a location a human explicitly confirmed through a trusted process (e.g. confirming
--               it on a call). It NEVER means device GPS; no device location is captured anywhere
--               in Station 06, and nothing may label a coordinate VERIFIED without that confirmation.
create table if not exists locations (
  id          text primary key,
  owner_type  text not null check (owner_type in ('CHILD','PERSON','PLACE')),
  owner_id    text not null,
  label       text,
  lat         double precision not null check (lat between -90 and 90),
  lng         double precision not null check (lng between -180 and 180),
  source      text not null check (source in ('SUPPLIED','ESTIMATED','VERIFIED')),
  captured_at timestamptz not null
);

-- ---------------------------------------------------------------------------
-- 3. RLS on the new tables (existing policies untouched)
-- ---------------------------------------------------------------------------

alter table candidate_evaluations    enable row level security;
alter table candidate_evaluations    force  row level security;
alter table real_call_authorizations enable row level security;
alter table real_call_authorizations force  row level security;
alter table locations                enable row level security;
alter table locations                force  row level security;

create policy candidate_evaluations_read on candidate_evaluations for select to authenticated
  using (
    candidate_id = current_person()
    or exists (select 1 from coordination_jobs j
                where j.id = candidate_evaluations.job_id and is_parent_of(j.child_id))
  );

create policy locations_read on locations for select to authenticated
  using (
    (owner_type = 'CHILD'  and (is_parent_of(owner_id) or has_scope(owner_id, 'address.read')))
    or (owner_type = 'PERSON' and owner_id = current_person())
  );

-- real_call_authorizations: deliberately NO policy (service-role only, like identity_map).

-- ---------------------------------------------------------------------------
-- 4. Grants: SELECT only for authenticated. No writes.
-- ---------------------------------------------------------------------------

revoke all on candidate_evaluations    from anon;
revoke all on locations                from anon;
revoke all on real_call_authorizations from anon, authenticated;

grant select on candidate_evaluations to authenticated;
grant select on locations             to authenticated;

grant all privileges on all tables in schema public to service_role;

-- ---------------------------------------------------------------------------
-- 5. Pure helpers (no table access beyond their own inputs)
-- ---------------------------------------------------------------------------

create or replace function haversine_miles(lat1 double precision, lng1 double precision,
                                          lat2 double precision, lng2 double precision)
returns numeric language sql immutable set search_path = pg_catalog as $$
  select round((2 * 3958.8 * asin(sqrt(
           power(sin(radians(lat2 - lat1) / 2), 2)
         + cos(radians(lat1)) * cos(radians(lat2))
           * power(sin(radians(lng2 - lng1) / 2), 2)
         )))::numeric, 2)
$$;

-- pickup-job.md §6a: haversine straight-line x $1.40/mi. Never a fare, quote or routed distance.
create or replace function estimate_ride_cost_usd(miles numeric)
returns numeric language sql immutable set search_path = pg_catalog as $$
  select round(miles * 1.40, 2)
$$;

revoke all on function haversine_miles(double precision, double precision, double precision, double precision) from public, anon;
revoke all on function estimate_ride_cost_usd(numeric) from public, anon;
grant execute on function haversine_miles(double precision, double precision, double precision, double precision) to authenticated;
grant execute on function estimate_ride_cost_usd(numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Internal helpers (not granted to authenticated; reached only from the functions below)
-- ---------------------------------------------------------------------------

-- The contract's approver rule: the parent scheduled for that date.
create or replace function _is_approver_for(p_child text, p_as_of date)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from parenting_schedules ps
     where ps.child_id = p_child
       and ps.parent_id = current_person()
       and upper(to_char(p_as_of, 'DY')) = any (ps.weekdays)
  )
$$;
revoke all on function _is_approver_for(text, date) from public, anon, authenticated;

-- Write one evaluation per related person, with the gate order from pickup-job.md §5.
-- Reason codes are computed here from data only.
create or replace function _evaluate_candidates(p_job text, p_child text, p_as_of date)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into candidate_evaluations (id, job_id, request_version, candidate_id, reason_code)
  select 'ce_' || substr(md5(p_job || r.from_id), 1, 24), p_job, 1, r.from_id,
         case
           when not exists (
             select 1 from grants g
              where g.actor_id = r.from_id and g.child_id = p_child
                and 'pickup.request' = any (g.scopes)
                and (g.valid_from  is null or p_as_of >= g.valid_from)
                and (g.valid_until is null or p_as_of <= g.valid_until)
           ) then 'UNAUTHORIZED'
           when not exists (
             select 1 from contact_methods cm where cm.person_id = r.from_id and cm.verified
           ) then 'NO_VERIFIED_CONTACT_METHOD'
           else null
         end
    from pickup_candidates_for(p_child, p_as_of) r
  on conflict (job_id, request_version, candidate_id) do nothing;

  -- Dispatch only to people who passed the first two gates.
  insert into attempts (id, job_id, channel, at, candidate_id, destination, destination_mode)
  select 'att_' || substr(md5(p_job || ce.candidate_id), 1, 24), p_job, cm.channel, now(),
         ce.candidate_id, cm.value, 'TEST_RESPONDER'
    from candidate_evaluations ce
    join lateral (
      select channel, value from contact_methods
       where person_id = ce.candidate_id and verified
       order by preferred desc, channel limit 1
    ) cm on true
   where ce.job_id = p_job and ce.reason_code is null
  on conflict (job_id, candidate_id) do nothing;
end $$;
revoke all on function _evaluate_candidates(text, text, date) from public, anon, authenticated;

-- Close out anyone who never answered, then select exactly one candidate.
-- Ranking (pickup-job.md §5b): in-policy first, then distance, then resolver order.
create or replace function _rank_and_advance(p_job text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status text; v_child text; v_as_of date; v_created timestamptz; v_timeout int;
  v_pending int; v_cap numeric; v_household text; v_school record; v_pick text; v_cost numeric;
begin
  select j.status, j.child_id, j.as_of, j.created_at, j.discovery_timeout_seconds
    into v_status, v_child, v_as_of, v_created, v_timeout
    from coordination_jobs j where j.id = p_job for update;

  if v_status <> 'discovering' then return; end if;

  select count(*) into v_pending
    from candidate_evaluations
   where job_id = p_job and reason_code is null and available is null;

  if v_pending > 0 and now() < v_created + make_interval(secs => v_timeout) then
    return;  -- still inside the discovery window
  end if;

  -- Whoever never answered is UNAVAILABLE (same code as an explicit no, per §5).
  update candidate_evaluations
     set reason_code = 'UNAVAILABLE', updated_at = now()
   where job_id = p_job and reason_code is null and available is null;

  select hp.value::numeric into v_cap
    from household_policies hp
   where hp.rule = 'ride_cost_cap_usd'
     and hp.household_id in (
       select hm.household_id from household_members hm
        where hm.person_id = v_child and hm.role = 'child')
   limit 1;

  select lat, lng, source into v_school
    from locations
   where owner_type = 'CHILD' and owner_id = v_child and label = 'school'
   limit 1;

  -- Cost and distance are computed here, server-side, and only the numbers are stored.
  with scored as (
    select ce.candidate_id,
           case when v_school.lat is null then null
                else haversine_miles(v_school.lat, v_school.lng, l.lat, l.lng) end as miles,
           l.source as provenance
      from candidate_evaluations ce
      left join locations l
        on l.owner_type = 'PERSON' and l.owner_id = ce.candidate_id
     where ce.job_id = p_job
       and ce.available is true
       and ce.reason_code is null
       and exists (select 1 from capabilities c
                    where c.person_id = ce.candidate_id and c.name = 'transport.child')
       and exists (select 1 from vehicles v where v.owner_id = ce.candidate_id)
  ), costed as (
    select candidate_id, miles, provenance,
           case when miles is null then null else estimate_ride_cost_usd(miles) end as cost
      from scored
  )
  select candidate_id, cost into v_pick, v_cost
    from costed
   order by (case when cost is null then 1 when v_cap is null then 0 when cost <= v_cap then 0 else 1 end),
            coalesce(miles, 9999), candidate_id
   limit 1;

  if v_pick is null then
    update coordination_jobs
       set status = 'failed', failure_reason = 'no_usable_candidate', version = version + 1
     where id = p_job;
    return;
  end if;

  update candidate_evaluations
     set reason_code = 'APPROVAL_PENDING',
         distance_miles = (select haversine_miles(v_school.lat, v_school.lng, l.lat, l.lng)
                             from locations l where l.owner_type='PERSON' and l.owner_id = v_pick),
         estimated_ride_cost_usd = v_cost,
         cost_basis = 'FridgeGraph synthetic planning estimate: haversine distance x $1.40/mi',
         location_provenance = (select l.source from locations l
                                 where l.owner_type='PERSON' and l.owner_id = v_pick),
         cost_calculated_at = now(),
         updated_at = now()
   where job_id = p_job and request_version = 1 and candidate_id = v_pick;

  update coordination_jobs
     set status = 'awaiting_approval', version = version + 1
   where id = p_job;
end $$;
revoke all on function _rank_and_advance(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. The three public transitions
-- ---------------------------------------------------------------------------

-- Creates the job and dispatches, atomically. Caller must be a parent of the child.
create or replace function request_pickup(p_child text, p_as_of date, p_window text)
returns text language plpgsql security definer set search_path = public as $$
declare v_key text; v_job text; v_status text;
begin
  if current_person() is null then raise exception 'UNAUTHENTICATED'; end if;
  if not is_parent_of(p_child) then raise exception 'UNAUTHORIZED'; end if;

  v_key := format('pickup:%s:%s:%s', p_child, p_as_of, coalesce(p_window, 'afternoon'));

  select id, status into v_job, v_status from coordination_jobs where idempotency_key = v_key;
  if v_job is not null then return v_job; end if;   -- idempotent: same key, same job

  v_job := 'job_' || replace(gen_random_uuid()::text, '-', '');

  insert into coordination_jobs
    (id, idempotency_key, type, child_id, status, version, request_version, as_of)
  values (v_job, v_key, 'PICKUP', p_child, 'pending', 1, 1, p_as_of)
  on conflict (idempotency_key) do nothing;

  if not found then
    select id into v_job from coordination_jobs where idempotency_key = v_key;
    return v_job;                                   -- lost a race; still one job
  end if;

  perform _evaluate_candidates(v_job, p_child, p_as_of);

  update coordination_jobs set status = 'discovering', version = version + 1 where id = v_job;
  return v_job;
end $$;

revoke all on function request_pickup(text, date, text) from public, anon;
grant execute on function request_pickup(text, date, text) to authenticated;

-- Records availability only, for the candidate the attempt belongs to. Never permission.
create or replace function accept_pickup(p_attempt text, p_available boolean, p_decline text,
                                         p_entry text, p_request_version int)
returns text language plpgsql security definer set search_path = public as $$
declare v_job text; v_candidate text; v_status text; v_rv int; v_code text; v_transport boolean;
begin
  if current_person() is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_entry is null or p_entry not in ('WEBHOOK_CALLBACK','CANDIDATE_JWT') then
    raise exception 'BAD_ENTRY_POINT';
  end if;

  select a.job_id, a.candidate_id into v_job, v_candidate
    from attempts a where a.id = p_attempt for update;
  if v_job is null then raise exception 'ATTEMPT_NOT_FOUND'; end if;

  -- A caller may only answer for herself. The webhook path resolves the same identity from the
  -- Attempt's recipient + provider metadata before calling this function.
  if v_candidate is distinct from current_person() then raise exception 'UNAUTHORIZED'; end if;

  select j.status, j.request_version into v_status, v_rv
    from coordination_jobs j where j.id = v_job for update;

  if v_rv <> p_request_version then raise exception 'STALE_REQUEST_VERSION'; end if;
  if v_status in ('confirmed','failed') then raise exception 'JOB_TERMINAL'; end if;

  -- Late reply: recorded for audit, changes nothing (pickup-job.md §7).
  if v_status <> 'discovering' then
    update candidate_evaluations
       set available = p_available, decline_reason = p_decline, accepted_via = p_entry,
           late_reply = true, updated_at = now()
     where job_id = v_job and candidate_id = v_candidate;
    return 'late';
  end if;

  v_transport := exists (select 1 from capabilities c
                          where c.person_id = v_candidate and c.name = 'transport.child')
             and exists (select 1 from vehicles v where v.owner_id = v_candidate);

  v_code := case
              when p_available is false and p_decline = 'NO_TRANSPORT' then 'AVAILABLE_NO_TRANSPORT'
              when p_available is false then 'UNAVAILABLE'
              when p_available is true and not v_transport then 'AVAILABLE_NO_TRANSPORT'
              else null
            end;

  update candidate_evaluations
     set available = p_available,
         decline_reason = p_decline,
         accepted_via = p_entry,
         reason_code = coalesce(v_code, reason_code),
         updated_at = now()
   where job_id = v_job and candidate_id = v_candidate;

  perform _rank_and_advance(v_job);
  return 'recorded';
end $$;

revoke all on function accept_pickup(text, boolean, text, text, int) from public, anon;
grant execute on function accept_pickup(text, boolean, text, text, int) to authenticated;

-- Writes the one Confirmation. Only the date's approverFor parent, only a live request_version.
create or replace function approve_pickup(p_job text, p_version int, p_request_version int,
                                          p_decision text, p_reason text)
returns text language plpgsql security definer set search_path = public as $$
declare v_status text; v_child text; v_as_of date; v_rv int; v_ver int; v_cand text;
begin
  if current_person() is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_decision not in ('APPROVED','DECLINED') then raise exception 'BAD_DECISION'; end if;

  select j.status, j.child_id, j.as_of, j.request_version, j.version
    into v_status, v_child, v_as_of, v_rv, v_ver
    from coordination_jobs j where j.id = p_job for update;

  if v_status is null then raise exception 'JOB_NOT_FOUND'; end if;
  if v_status in ('confirmed','failed') then raise exception 'JOB_TERMINAL'; end if;
  if v_ver <> p_version then raise exception 'STALE_VERSION'; end if;
  if v_rv <> p_request_version then raise exception 'STALE_REQUEST_VERSION'; end if;
  if v_status <> 'awaiting_approval' then raise exception 'NOT_AWAITING_APPROVAL'; end if;
  if not _is_approver_for(v_child, v_as_of) then raise exception 'UNAUTHORIZED'; end if;

  if p_decision = 'DECLINED' then
    update coordination_jobs
       set status = 'failed', failure_reason = coalesce(p_reason, 'approver_declined'),
           version = version + 1
     where id = p_job;
    return p_job;
  end if;

  select candidate_id into v_cand
    from candidate_evaluations
   where job_id = p_job and reason_code = 'APPROVAL_PENDING';
  if v_cand is null then raise exception 'NO_RECOMMENDATION'; end if;

  insert into confirmations (id, job_id, received_at, candidate_id, approved_by)
  values ('cf_' || substr(md5(p_job || v_cand), 1, 24), p_job, now(), v_cand, current_person());

  update coordination_jobs
     set status = 'confirmed', version = version + 1
   where id = p_job;

  return p_job;
end $$;

revoke all on function approve_pickup(text, int, int, text, text) from public, anon;
grant execute on function approve_pickup(text, int, int, text, text) to authenticated;

-- Timeout path: no user action triggers it, so service_role only.
create or replace function close_discovery(p_job text)
returns text language plpgsql security definer set search_path = public as $$
begin
  perform _rank_and_advance(p_job);
  return p_job;
end $$;
revoke all on function close_discovery(text) from public, anon, authenticated;
grant execute on function close_discovery(text) to service_role;

-- Gate 2 consume: one statement, every predicate, no read-then-write window.
create or replace function consume_real_call_authorization(p_id text, p_attempt text,
                                                          p_recipient text, p_request_version int)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_requested int; v_ok boolean := false;
begin
  if current_person() is null then raise exception 'UNAUTHENTICATED'; end if;

  select j.request_version into v_requested
    from attempts a join coordination_jobs j on j.id = a.job_id
   where a.id = p_attempt and is_parent_of(j.child_id);
  if v_requested is null or v_requested <> p_request_version then return false; end if;

  update real_call_authorizations
     set consumed_at = now()
   where id = p_id
     and attempt_id = p_attempt
     and recipient_ref = p_recipient
     and request_version = p_request_version
     and consumed_at is null
     and expires_at > now();

  get diagnostics v_ok = row_count;
  return coalesce(v_ok, false);
end $$;

revoke all on function consume_real_call_authorization(text, text, text, int) from public, anon, authenticated;
grant execute on function consume_real_call_authorization(text, text, text, int) to service_role;

commit;

-- ---------------------------------------------------------------------------
-- Rollback (exact; requires Bryan's approval and a database you may change)
-- ---------------------------------------------------------------------------
-- begin;
--   drop function if exists consume_real_call_authorization(text, text, text, int);
--   drop function if exists close_discovery(text);
--   drop function if exists approve_pickup(text, int, int, text, text);
--   drop function if exists accept_pickup(text, boolean, text, text, int);
--   drop function if exists request_pickup(text, date, text);
--   drop function if exists _rank_and_advance(text);
--   drop function if exists _evaluate_candidates(text, text, date);
--   drop function if exists _is_approver_for(text, date);
--   drop function if exists estimate_ride_cost_usd(numeric);
--   drop function if exists haversine_miles(double precision, double precision, double precision, double precision);
--   drop table if exists real_call_authorizations;
--   drop index if exists candidate_evaluations_one_active_recommendation;
--   drop table if exists candidate_evaluations;
--   drop table if exists locations;
--   drop index if exists confirmations_one_per_job;
--   drop index if exists attempts_job_candidate_uq;
--   alter table confirmations drop column if exists approved_by, drop column if exists candidate_id;
--   alter table attempts drop constraint if exists attempts_channel_check;
--   alter table attempts drop constraint if exists attempts_destination_mode_check;
--   alter table attempts drop column if exists late_reply, drop column if exists provider_message_id,
--                       drop column if exists destination_mode, drop column if exists destination,
--                       drop column if exists candidate_id;
--   alter table coordination_jobs drop constraint if exists coordination_jobs_status_check;
--   alter table coordination_jobs drop column if exists created_at, drop column if exists as_of,
--                                drop column if exists failure_reason,
--                                drop column if exists approval_timeout_seconds,
--                                drop column if exists discovery_timeout_seconds,
--                                drop column if exists request_version;
-- commit;
