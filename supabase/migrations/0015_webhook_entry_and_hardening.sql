-- 0015 — the trusted-handler entry point for replies, plus three hardening fixes.
--
-- Boundary this function sits behind (webhook.md §5/§6a):
--   public endpoint → verify raw-body HMAC + timestamp + event id (duplicate-safe) + attempt +
--   recipient + request version → trusted FridgeGraph handler → accept_pickup_webhook (service role)
-- The service-role key never leaves the backend: not to GHL, not to n8n, not to the public endpoint.
--
-- Called by the HMAC webhook path (primary) and by the voice-turn path (documented weaker boundary).
-- Both reach the SAME function, so neither can diverge in what it is allowed to do: record
-- availability. It cannot approve, cannot create a confirmation, and cannot act as a parent.
--
-- 1. accept_pickup_webhook
--    - SECURITY DEFINER, EXECUTE to service_role ONLY (revoked from public/anon/authenticated)
--    - the candidate is DERIVED from the Attempt — never accepted as an argument
--    - rejects a terminal job and a stale request_version
--    - idempotent: a duplicate delivery of the same reply changes nothing
--    - availability only; writes the same outcome codes accept_pickup does
-- 2. revoke the Supabase-default REFERENCES / TRIGGER / TRUNCATE from authenticated on the
--    coordination tables. TRUNCATE is not reachable through PostgREST, but it should not be held.
-- 3. correct the reason_code column comment to describe PENDING (the column is right; the comment
--    written in 0013 still described the pre-decision nullable behaviour).
--
-- Additive and non-destructive: one new function, one COMMENT, one set of REVOKEs. No table,
-- column, policy or existing function is altered.

begin;

-- ---------------------------------------------------------------------------
-- 1. accept_pickup_webhook
-- ---------------------------------------------------------------------------
create or replace function accept_pickup_webhook(p_attempt text, p_available boolean,
                                                 p_decline text, p_request_version int)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_job text; v_candidate text; v_status text; v_rv int; v_child text; v_as_of date;
  v_already text; v_code text; v_transport boolean; v_cap numeric; v_school record;
  v_origin record; v_miles numeric; v_cost numeric;
begin
  select a.job_id, a.candidate_id into v_job, v_candidate
    from attempts a where a.id = p_attempt for update;
  if v_job is null then raise exception 'ATTEMPT_NOT_FOUND'; end if;

  select j.status, j.request_version, j.child_id, j.as_of
    into v_status, v_rv, v_child, v_as_of
    from coordination_jobs j where j.id = v_job for update;

  if v_status in ('confirmed','failed') then raise exception 'JOB_TERMINAL'; end if;
  if v_rv <> p_request_version then raise exception 'STALE_REQUEST_VERSION'; end if;

  -- Duplicate delivery: the reply was already recorded, so this changes nothing.
  select accepted_via into v_already
    from candidate_evaluations
   where job_id = v_job and candidate_id = v_candidate
   for update;
  if v_already is not null then
    return 'duplicate';
  end if;

  v_transport := exists (select 1 from capabilities c
                          where c.person_id = v_candidate and c.name = 'transport.child')
             and exists (select 1 from vehicles v where v.owner_id = v_candidate);

  -- Cost is computed here, server-side, from the documented formula; never passed in.
  select lat, lng into v_school
    from locations where owner_type = 'CHILD' and owner_id = v_child and label = 'school' limit 1;
  select lat, lng into v_origin
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
              -- said yes, has transport, but the cap is exceeded: still a candidate, flagged.
              when p_available is true and v_cost is not null and v_cap is not null and v_cost > v_cap
                then 'OVER_POLICY'
              else null   -- available, transport-capable, inside the cap: in the pool for ranking
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
         location_provenance = case when v_origin.lat is null then null else v_origin.source end,
         cost_calculated_at = case when v_cost is null then null else now() end,
         updated_at = now()
   where job_id = v_job and candidate_id = v_candidate;

  -- Close discovery if every contacted candidate has now been heard from.
  if v_status = 'discovering' then
    perform _rank_and_advance(v_job);
  end if;

  return 'recorded';
end $$;

revoke all on function accept_pickup_webhook(text, boolean, text, int) from public, anon, authenticated;
grant execute on function accept_pickup_webhook(text, boolean, text, int) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Drop the Supabase-default privileges authenticated never needed
-- ---------------------------------------------------------------------------
revoke references, trigger, truncate on
  coordination_jobs, attempts, confirmations, information_requests,
  candidate_evaluations, locations
from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 3. Correct the column comment to match the decided semantics
-- ---------------------------------------------------------------------------
comment on column candidate_evaluations.reason_code is
  'Nine values. PENDING is a workflow state: outreach sent, no reply yet (available stays NULL until '
  'a human answers). The other eight are outcomes assigned by deterministic policy code.';

commit;

-- Rollback:
--   drop function if exists accept_pickup_webhook(text, boolean, text, int);
--   grant references, trigger, truncate on coordination_jobs, attempts, confirmations,
--     information_requests, candidate_evaluations, locations to authenticated;
--   comment on column candidate_evaluations.reason_code is null;
