-- 0016 — fix accept_pickup_webhook: the location read omitted `source`.
--
-- Found by ops/station06-verify.mjs on first run, not by review:
--   record "v_origin" has no field "source"   (SQLSTATE 42703)
-- The function selected only `lat, lng` into a record and then wrote `v_origin.source` into
-- location_provenance, so every webhook reply failed at the UPDATE. The job stayed in
-- `discovering` and no outcome code was ever assigned.
--
-- This replaces the function body only. Same signature, same grants (service_role only), same
-- behaviour otherwise. No table, column, policy or other function is touched.
--
-- Rollback: re-apply the 0015 definition.

begin;

create or replace function accept_pickup_webhook(p_attempt text, p_available boolean,
                                                 p_decline text, p_request_version int)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_job text; v_candidate text; v_status text; v_rv int; v_child text;
  v_already text; v_code text; v_transport boolean; v_cap numeric;
  v_school record; v_origin record; v_miles numeric; v_cost numeric;
begin
  select a.job_id, a.candidate_id into v_job, v_candidate
    from attempts a where a.id = p_attempt for update;
  if v_job is null then raise exception 'ATTEMPT_NOT_FOUND'; end if;

  select j.status, j.request_version, j.child_id
    into v_status, v_rv, v_child
    from coordination_jobs j where j.id = v_job for update;

  if v_status in ('confirmed','failed') then raise exception 'JOB_TERMINAL'; end if;
  if v_rv <> p_request_version then raise exception 'STALE_REQUEST_VERSION'; end if;

  -- Duplicate delivery of the same reply changes nothing.
  select accepted_via into v_already
    from candidate_evaluations
   where job_id = v_job and candidate_id = v_candidate
   for update;
  if v_already is not null then return 'duplicate'; end if;

  v_transport := exists (select 1 from capabilities c
                          where c.person_id = v_candidate and c.name = 'transport.child')
             and exists (select 1 from vehicles v where v.owner_id = v_candidate);

  -- Cost is computed server-side from the documented formula; never supplied by the caller.
  select lat, lng into v_school
    from locations where owner_type = 'CHILD' and owner_id = v_child and label = 'school' limit 1;
  select lat, lng, source into v_origin
    from locations where owner_type = 'PERSON' and owner_id = v_candidate limit 1;

  if v_school.lat is not null and v_origin.lat is not null then
    v_miles := haversine_miles(v_school.lat, v_school.lng, v_origin.lat, v_origin.lng);
    v_cost  := estimate_ride_cost_usd(v_miles);
  end if;

  select hp.value::numeric into v_cap
    from household_policies hp
   where hp.rule = 'ride_cost_cap_usd'
     and hp.household_id in (select hm.household_id from household_members hm
                              where hm.person_id = v_child and hm.role = 'child')
   limit 1;

  v_code := case
              when p_available is false and p_decline = 'NO_TRANSPORT' then 'AVAILABLE_NO_TRANSPORT'
              when p_available is false then 'UNAVAILABLE'
              when p_available is true and not v_transport then 'AVAILABLE_NO_TRANSPORT'
              when p_available is true and v_cost is not null and v_cap is not null and v_cost > v_cap
                then 'OVER_POLICY'
              else null
            end;

  update candidate_evaluations
     set available = p_available,
         decline_reason = p_decline,
         accepted_via = 'WEBHOOK_CALLBACK',
         reason_code = v_code,
         distance_miles = v_miles,
         estimated_ride_cost_usd = v_cost,
         cost_basis = case when v_cost is null then null
                           else 'FridgeGraph synthetic planning estimate: haversine distance x $1.40/mi' end,
         location_provenance = v_origin.source,
         cost_calculated_at = case when v_cost is null then null else now() end,
         updated_at = now()
   where job_id = v_job and candidate_id = v_candidate;

  if v_status = 'discovering' then
    perform _rank_and_advance(v_job);
  end if;

  return 'recorded';
end $$;

revoke all on function accept_pickup_webhook(text, boolean, text, int) from public, anon, authenticated;
grant execute on function accept_pickup_webhook(text, boolean, text, int) to service_role;

commit;
