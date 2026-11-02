-- 0065 — the paid-ride leg is priced in the documented DIRECTION: candidate → pickup.
--
-- THE DEFECT
-- `docs/contracts/pickup-job.md` §6 models a `CandidateRouteLeg` as the caregiver's trip TO the
-- pickup point: `PickupRoute.pickupPoint` (the child's school) is the destination, and each leg's
-- `origin` is the candidate. 0060 priced the paid branch the other way round —
--     ride_miles_for(v_school.lat, v_school.lng, l.lat, l.lng)
-- i.e. school → candidate. With haversine that was invisible, because a straight line is symmetric.
-- With a STORED ROAD DISTANCE it is not: one-way streets, ramps and divided highways make
-- candidate → school and school → candidate genuinely different numbers, so the figure shown could
-- describe a trip nobody takes.
--
-- THE FIX
-- Exactly one line changes: the paid-branch lateral join now passes the candidate's coordinates as
-- the origin and the school's as the destination. Everything else in the body is byte-identical to
-- 0060 — same driver branch, same cap comparison, same stored columns, same basis. Driver ranking
-- still uses haversine on purpose (arrival-feasibility proxy, symmetric, and no cost is attached).
--
-- Direction is part of the store's identity: `place_route_results` is keyed on the ORDERED snapshot,
-- so a measurement stored in one direction never satisfies a lookup in the other. That is what makes
-- a direction mismatch fall back to haversine instead of silently pricing backwards — and it is why
-- the pre-step (src/village/ridePrewarm.ts) stores candidate → pickup too.
--
-- Forward-only: 0060 is never edited, and this body differs from it only in the line named above.

begin;

create or replace function _rank_and_advance(p_job text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status text; v_child text; v_created timestamptz; v_timeout int;
  v_pending int; v_cap numeric; v_school record;
  v_pick text; v_miles numeric; v_prov text;
  v_alt text; v_alt_cost numeric; v_alt_miles numeric; v_alt_prov text; v_alt_basis text;
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

  -- Miles and basis come from ONE function, so `distance_miles` and `cost_basis` describe each other.
  -- When the coordinates are unknown, every derived value stays NULL rather than becoming a guess.
  select ce.candidate_id,
         case when v_school.lat is null or l.lat is null then null
              else estimate_ride_cost_usd(rm.miles) end,
         case when v_school.lat is null or l.lat is null then null else rm.miles end,
         l.source,
         case when v_school.lat is null or l.lat is null then null else rm.basis end
    into v_alt, v_alt_cost, v_alt_miles, v_alt_prov, v_alt_basis
    from candidate_evaluations ce
    left join locations l on l.owner_type = 'PERSON' and l.owner_id = ce.candidate_id
    left join lateral public.ride_miles_for(l.lat, l.lng, v_school.lat, v_school.lng) rm on true
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
           cost_basis = v_alt_basis,
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

commit;
