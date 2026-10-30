-- 0019_transport_policy.sql
--
-- Transportation-policy correction. Forward-only: 0013-0018 are never edited.
--
-- What changes, and why:
--
--   1. A caregiver with their own usable transportation is NEVER checked against a cost cap.
--      Drivers are ranked on distance, which is the documented proxy for arrival feasibility
--      (pickup-job.md §5b) because this release has no pickup-deadline column.
--   2. A caregiver who is willing but has no usable transport is AVAILABLE_NO_TRANSPORT. Only
--      then is a clearly-labelled ride ESTIMATE computed and compared with the household's
--      paid-ride limit. It is never a provider quote and never presented as booked.
--   3. Paid transportation is explored only when no driver can do the pickup. Over the limit it
--      is surfaced as a flagged option requiring explicit acceptance; never arranged.
--      A ride estimate within the limit is out of scope this release: the job fails with
--      failure_reason 'no_driver_available' and Rosina reports that no driver is available.
--
-- Unchanged on purpose: parent approval, acceptance != approval, request versions, idempotency,
-- webhook security, audit history, and the explicit over-limit acceptance bit.

begin;

create or replace function _rank_and_advance(p_job text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status text; v_child text; v_created timestamptz; v_timeout int;
  v_pending int; v_cap numeric; v_school record;
  v_pick text; v_miles numeric; v_prov text;
  v_alt text; v_alt_cost numeric; v_alt_miles numeric; v_alt_prov text;
begin
  select j.status, j.child_id, j.created_at, j.discovery_timeout_seconds
    into v_status, v_child, v_created, v_timeout
    from coordination_jobs j where j.id = p_job for update;

  if v_status <> 'discovering' then return; end if;

  select count(*) into v_pending
    from candidate_evaluations
   where job_id = p_job and reason_code = 'PENDING' and available is null;

  if v_pending > 0 and now() < v_created + make_interval(secs => v_timeout) then
    return;
  end if;

  update candidate_evaluations
     set reason_code = 'UNAVAILABLE', updated_at = now()
   where job_id = p_job and reason_code = 'PENDING' and available is null;

  select lat, lng into v_school
    from locations
   where owner_type = 'CHILD' and owner_id = v_child and label = 'school'
   limit 1;

  -- DRIVERS. A caregiver with their own usable transport is never checked against a cost cap.
  -- Distance is the documented proxy for arrival feasibility (pickup-job.md §5b).
  select ce.candidate_id,
         case when v_school.lat is null then null
              else haversine_miles(v_school.lat, v_school.lng, l.lat, l.lng) end,
         l.source
    into v_pick, v_miles, v_prov
    from candidate_evaluations ce
    left join locations l on l.owner_type = 'PERSON' and l.owner_id = ce.candidate_id
   where ce.job_id = p_job
     and ce.available is true
     and ce.reason_code is null
     and exists (select 1 from capabilities c
                  where c.person_id = ce.candidate_id and c.name = 'transport.child')
     and exists (select 1 from vehicles v where v.owner_id = ce.candidate_id)
   order by coalesce(case when v_school.lat is null then null
                          else haversine_miles(v_school.lat, v_school.lng, l.lat, l.lng) end, 9999),
            ce.candidate_id
   limit 1;

  if v_pick is not null then
    update candidate_evaluations
       set reason_code = 'APPROVAL_PENDING',
           distance_miles = v_miles,
           estimated_ride_cost_usd = null,
           cost_basis = null,
           location_provenance = v_prov,
           cost_calculated_at = null,
           updated_at = now()
     where job_id = p_job and candidate_id = v_pick;

    update coordination_jobs
       set status = 'awaiting_approval', over_limit_candidate_id = null, version = version + 1
     where id = p_job;
    return;
  end if;

  -- NO DRIVER. Paid transportation is explored only now, and only for a caregiver who is willing
  -- but has no usable transport. The figure is an ESTIMATE, never a provider quote.
  select hp.value::numeric into v_cap
    from household_policies hp
   where hp.rule = 'ride_cost_cap_usd'
     and hp.household_id in (
       select hm.household_id from household_members hm
        where hm.person_id = v_child and hm.role = 'child')
   limit 1;

  select ce.candidate_id,
         case when v_school.lat is null then null
              else estimate_ride_cost_usd(haversine_miles(v_school.lat, v_school.lng, l.lat, l.lng)) end,
         case when v_school.lat is null then null
              else haversine_miles(v_school.lat, v_school.lng, l.lat, l.lng) end,
         l.source
    into v_alt, v_alt_cost, v_alt_miles, v_alt_prov
    from candidate_evaluations ce
    left join locations l on l.owner_type = 'PERSON' and l.owner_id = ce.candidate_id
   where ce.job_id = p_job
     and ce.reason_code = 'AVAILABLE_NO_TRANSPORT'
     and not exists (select 1 from vehicles v where v.owner_id = ce.candidate_id)
   order by coalesce(case when v_school.lat is null then null
                          else haversine_miles(v_school.lat, v_school.lng, l.lat, l.lng) end, 9999),
            ce.candidate_id
   limit 1;

  if v_alt is null then
    update coordination_jobs
       set status = 'failed', failure_reason = 'no_usable_candidate', version = version + 1
     where id = p_job;
    return;
  end if;

  if v_cap is not null and v_alt_cost is not null and v_alt_cost > v_cap then
    update candidate_evaluations
       set reason_code = 'OVER_POLICY',
           distance_miles = v_alt_miles,
           estimated_ride_cost_usd = v_alt_cost,
           cost_basis = 'FridgeGraph synthetic planning estimate: haversine distance x $1.40/mi - not a provider quote',
           location_provenance = v_alt_prov,
           cost_calculated_at = now(),
           updated_at = now()
     where job_id = p_job and candidate_id = v_alt;

    update coordination_jobs
       set status = 'awaiting_approval', over_limit_candidate_id = v_alt, version = version + 1
     where id = p_job;
    return;
  end if;

  -- A ride estimate within the limit is out of scope this release (pickup-job.md §5b):
  -- Rosina reports no driver available and nothing is arranged.
  update coordination_jobs
     set status = 'failed', failure_reason = 'no_driver_available', version = version + 1
   where id = p_job;
end $$;
revoke all on function _rank_and_advance(text) from public, anon, authenticated;

create or replace function approve_pickup(p_job text, p_version int, p_request_version int,
                                          p_decision text, p_reason text,
                                          p_accept_over_limit boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare v_status text; v_child text; v_as_of date; v_rv int; v_ver int;
        v_cand text; v_over text;
begin
  if current_person() is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_decision not in ('APPROVED','DECLINED') then raise exception 'BAD_DECISION'; end if;

  select j.status, j.child_id, j.as_of, j.request_version, j.version, j.over_limit_candidate_id
    into v_status, v_child, v_as_of, v_rv, v_ver, v_over
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

  if v_over is not null then
    -- An over-limit option is never approved implicitly.
    if p_accept_over_limit is not true then
      raise exception 'OVER_LIMIT_NOT_ACCEPTED';
    end if;
    -- A flagged option is a no-transport caregiver's ride estimate. A driver is never one:
    -- drivers are never cost-checked, so a vehicle here means the row is not what it claims.
    if exists (select 1 from vehicles v where v.owner_id = v_over) then
      raise exception 'OVER_LIMIT_NOT_RIDE_OPTION';
    end if;
    v_cand := v_over;
  else
    select candidate_id into v_cand
      from candidate_evaluations
     where job_id = p_job and reason_code = 'APPROVAL_PENDING';
  end if;

  if v_cand is null then raise exception 'NO_RECOMMENDATION'; end if;

  insert into confirmations (id, job_id, received_at, candidate_id, approved_by, over_limit_approved)
  values ('cf_' || substr(md5(p_job || v_cand), 1, 24), p_job, now(), v_cand, current_person(),
          v_over is not null);

  update coordination_jobs
     set status = 'confirmed', version = version + 1
   where id = p_job;

  return p_job;
end $$;
revoke all on function approve_pickup(text, int, int, text, text, boolean) from public, anon;
grant execute on function approve_pickup(text, int, int, text, text, boolean) to authenticated;

commit;

-- ---------------------------------------------------------------------------------------------
-- Rollback. Restores the 0017 bodies verbatim (extracted from that file when this one was written).
-- ---------------------------------------------------------------------------------------------
-- begin;
--
-- create or replace function _rank_and_advance(p_job text)
-- returns void language plpgsql security definer set search_path = public as $$
-- declare
--   v_status text; v_child text; v_created timestamptz; v_timeout int;
--   v_pending int; v_cap numeric; v_school record;
--   v_pick text; v_cost numeric; v_miles numeric; v_prov text;
--   v_alt text; v_alt_cost numeric; v_alt_miles numeric; v_alt_prov text;
-- begin
--   select j.status, j.child_id, j.created_at, j.discovery_timeout_seconds
--     into v_status, v_child, v_created, v_timeout
--     from coordination_jobs j where j.id = p_job for update;
--
--   if v_status <> 'discovering' then return; end if;
--
--   select count(*) into v_pending
--     from candidate_evaluations
--    where job_id = p_job and reason_code = 'PENDING' and available is null;
--
--   if v_pending > 0 and now() < v_created + make_interval(secs => v_timeout) then
--     return;
--   end if;
--
--   update candidate_evaluations
--      set reason_code = 'UNAVAILABLE', updated_at = now()
--    where job_id = p_job and reason_code = 'PENDING' and available is null;
--
--   select hp.value::numeric into v_cap
--     from household_policies hp
--    where hp.rule = 'ride_cost_cap_usd'
--      and hp.household_id in (select hm.household_id from household_members hm
--                               where hm.person_id = v_child and hm.role = 'child')
--    limit 1;
--
--   select lat, lng into v_school
--     from locations where owner_type = 'CHILD' and owner_id = v_child and label = 'school' limit 1;
--
--   -- In-policy selection: available, transport-capable, not yet coded, inside the limit.
--   with scored as (
--     select ce.candidate_id,
--            case when v_school.lat is null then null
--                 else haversine_miles(v_school.lat, v_school.lng, l.lat, l.lng) end as miles,
--            l.source as provenance
--       from candidate_evaluations ce
--       left join locations l on l.owner_type = 'PERSON' and l.owner_id = ce.candidate_id
--      where ce.job_id = p_job
--        and ce.available is true
--        and ce.reason_code is null
--        and exists (select 1 from capabilities c
--                     where c.person_id = ce.candidate_id and c.name = 'transport.child')
--        and exists (select 1 from vehicles v where v.owner_id = ce.candidate_id)
--   ), costed as (
--     select candidate_id, miles, provenance,
--            case when miles is null then null else estimate_ride_cost_usd(miles) end as cost
--       from scored
--   )
--   select candidate_id, cost, miles, provenance
--     into v_pick, v_cost, v_miles, v_prov
--     from costed
--    where (v_cap is null or cost is null or cost <= v_cap)
--    order by coalesce(miles, 9999), candidate_id
--    limit 1;
--
--   if v_pick is not null then
--     update candidate_evaluations
--        set reason_code = 'APPROVAL_PENDING',
--            distance_miles = v_miles,
--            estimated_ride_cost_usd = v_cost,
--            cost_basis = 'FridgeGraph synthetic planning estimate: haversine distance x $1.40/mi',
--            location_provenance = v_prov,
--            cost_calculated_at = now(),
--            updated_at = now()
--      where job_id = p_job and candidate_id = v_pick;
--
--     update coordination_jobs
--        set status = 'awaiting_approval', over_limit_candidate_id = null, version = version + 1
--      where id = p_job;
--     return;
--   end if;
--
--   -- No compliant option. Surface the closest over-limit candidate for an explicit decision.
--   -- It keeps OVER_POLICY; it never becomes APPROVAL_PENDING.
--   select ce.candidate_id,
--          case when v_school.lat is null then null
--               else estimate_ride_cost_usd(haversine_miles(v_school.lat, v_school.lng, l.lat, l.lng)) end,
--          case when v_school.lat is null then null
--               else haversine_miles(v_school.lat, v_school.lng, l.lat, l.lng) end,
--          l.source
--     into v_alt, v_alt_cost, v_alt_miles, v_alt_prov
--     from candidate_evaluations ce
--     left join locations l on l.owner_type = 'PERSON' and l.owner_id = ce.candidate_id
--    where ce.job_id = p_job
--      and ce.available is true
--      and exists (select 1 from capabilities c
--                   where c.person_id = ce.candidate_id and c.name = 'transport.child')
--      and exists (select 1 from vehicles v where v.owner_id = ce.candidate_id)
--    order by (case when v_alt_cost is null then 1 else 0 end),
--             coalesce(haversine_miles(v_school.lat, v_school.lng, l.lat, l.lng), 9999),
--             ce.candidate_id
--    limit 1;
--
--   if v_alt is not null then
--     update candidate_evaluations
--        set reason_code = 'OVER_POLICY',
--            distance_miles = v_alt_miles,
--            estimated_ride_cost_usd = v_alt_cost,
--            cost_basis = 'FridgeGraph synthetic planning estimate: haversine distance x $1.40/mi',
--            location_provenance = v_alt_prov,
--            cost_calculated_at = now(),
--            updated_at = now()
--      where job_id = p_job and candidate_id = v_alt;
--
--     update coordination_jobs
--        set status = 'awaiting_approval', over_limit_candidate_id = v_alt, version = version + 1
--      where id = p_job;
--     return;
--   end if;
--
--   update coordination_jobs
--      set status = 'failed', failure_reason = 'no_usable_candidate', version = version + 1
--    where id = p_job;
-- end $$;
--
-- create or replace function approve_pickup(p_job text, p_version int, p_request_version int,
--                                           p_decision text, p_reason text,
--                                           p_accept_over_limit boolean default false)
-- returns text language plpgsql security definer set search_path = public as $$
-- declare v_status text; v_child text; v_as_of date; v_rv int; v_ver int;
--         v_cand text; v_over text;
-- begin
--   if current_person() is null then raise exception 'UNAUTHENTICATED'; end if;
--   if p_decision not in ('APPROVED','DECLINED') then raise exception 'BAD_DECISION'; end if;
--
--   select j.status, j.child_id, j.as_of, j.request_version, j.version, j.over_limit_candidate_id
--     into v_status, v_child, v_as_of, v_rv, v_ver, v_over
--     from coordination_jobs j where j.id = p_job for update;
--
--   if v_status is null then raise exception 'JOB_NOT_FOUND'; end if;
--   if v_status in ('confirmed','failed') then raise exception 'JOB_TERMINAL'; end if;
--   if v_ver <> p_version then raise exception 'STALE_VERSION'; end if;
--   if v_rv <> p_request_version then raise exception 'STALE_REQUEST_VERSION'; end if;
--   if v_status <> 'awaiting_approval' then raise exception 'NOT_AWAITING_APPROVAL'; end if;
--   if not _is_approver_for(v_child, v_as_of) then raise exception 'UNAUTHORIZED'; end if;
--
--   if p_decision = 'DECLINED' then
--     update coordination_jobs
--        set status = 'failed', failure_reason = coalesce(p_reason, 'approver_declined'),
--            version = version + 1
--      where id = p_job;
--     return p_job;
--   end if;
--
--   if v_over is not null then
--     -- An over-limit option is never approved implicitly.
--     if p_accept_over_limit is not true then
--       raise exception 'OVER_LIMIT_NOT_ACCEPTED';
--     end if;
--     v_cand := v_over;
--   else
--     select candidate_id into v_cand
--       from candidate_evaluations
--      where job_id = p_job and reason_code = 'APPROVAL_PENDING';
--   end if;
--
--   if v_cand is null then raise exception 'NO_RECOMMENDATION'; end if;
--
--   insert into confirmations (id, job_id, received_at, candidate_id, approved_by, over_limit_approved)
--   values ('cf_' || substr(md5(p_job || v_cand), 1, 24), p_job, now(), v_cand, current_person(),
--           v_over is not null);
--
--   update coordination_jobs
--      set status = 'confirmed', version = version + 1
--    where id = p_job;
--
--   return p_job;
-- end $$;
--
-- commit;
