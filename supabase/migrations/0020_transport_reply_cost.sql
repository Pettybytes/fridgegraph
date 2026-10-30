-- 0020_transport_reply_cost.sql
--
-- Follow-up to 0019, forward-only. 0013-0019 are never edited.
--
-- Why this exists: the reply path (0018) computed a synthetic cost for EVERY candidate and wrote
-- it to the row, and could mark a DRIVER as OVER_POLICY at reply time when that cost exceeded the
-- household cap. 0019 fixed the ranking; this fixes the second write site.
--
-- What changes (Bryan's decision, option 2):
--
--   1. NO ride estimate is computed at reply time, for anyone — including a caregiver who is
--      willing but has no usable transport. AVAILABLE_NO_TRANSPORT carries no cost.
--   2. A ride estimate is computed ONLY on the paid-ride path: when no driver can do the pickup.
--      That computation lives in _rank_and_advance (0019) and nowhere else.
--   3. A reply is never OVER_POLICY. Over-limit exists only as a flagged option produced by the
--      ranking, requiring an explicit acceptOverLimit at approval.
--
-- Unchanged: event-id dedupe and conflict handling, attempt/recipient binding, REJECTED_STATE
-- recording, the already-answered check, distance_miles, and the _rank_and_advance call.

begin;

create or replace function accept_pickup_webhook(p_attempt text, p_available boolean, p_decline text,
                                                 p_request_version int, p_event_id text,
                                                 p_payload_sha256 text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_job text; v_candidate text; v_status text; v_rv int; v_child text;
  v_already text; v_code text; v_transport boolean; v_cap numeric;
  v_school record; v_origin record; v_miles numeric; v_cost numeric; v_prev text;
begin
  if p_event_id is null or p_event_id = '' or p_payload_sha256 is null then
    raise exception 'EVENT_ID_REQUIRED';
  end if;

  select a.job_id, a.candidate_id into v_job, v_candidate
    from attempts a where a.id = p_attempt for update;
  if v_job is null then raise exception 'ATTEMPT_NOT_FOUND'; end if;

  -- Claim the event id in THIS transaction. Concurrent duplicates serialise on the primary key.
  insert into webhook_events (id, attempt_id, request_version, payload_sha256, outcome)
  values (p_event_id, p_attempt, p_request_version, p_payload_sha256, 'ACCEPTED')
  on conflict (id) do nothing;

  if not found then
    select payload_sha256 into v_prev from webhook_events where id = p_event_id;
    if v_prev = p_payload_sha256 then
      return 'duplicate';                       -- idempotent: nothing changes
    end if;
    raise exception 'EVENT_ID_CONFLICT';        -- same id, different body
  end if;

  select j.status, j.request_version, j.child_id
    into v_status, v_rv, v_child
    from coordination_jobs j where j.id = v_job for update;

  -- State rejections are recorded, with their own outcome, and change no job state.
  if v_status in ('confirmed','failed') or v_rv <> p_request_version then
    update webhook_events set outcome = 'REJECTED_STATE' where id = p_event_id;
    return 'rejected_state';
  end if;

  select accepted_via into v_already
    from candidate_evaluations
   where job_id = v_job and candidate_id = v_candidate
   for update;
  if v_already is not null then
    return 'duplicate';                         -- already answered; nothing changes
  end if;

  v_transport := exists (select 1 from capabilities c
                          where c.person_id = v_candidate and c.name = 'transport.child')
             and exists (select 1 from vehicles v where v.owner_id = v_candidate);

  select lat, lng into v_school
    from locations where owner_type = 'CHILD' and owner_id = v_child and label = 'school' limit 1;
  select lat, lng, source into v_origin
    from locations where owner_type = 'PERSON' and owner_id = v_candidate limit 1;

  if v_school.lat is not null and v_origin.lat is not null then
    v_miles := haversine_miles(v_school.lat, v_school.lng, v_origin.lat, v_origin.lng);
  end if;

  v_code := case
              when p_available is false and p_decline = 'NO_TRANSPORT' then 'AVAILABLE_NO_TRANSPORT'
              when p_available is false then 'UNAVAILABLE'
              when p_available is true and not v_transport then 'AVAILABLE_NO_TRANSPORT'
              else null
            end;

  -- No ride estimate is computed on the reply path. An estimate exists only when paid transport is
  -- explored (no driver can do the pickup), and only the ranking writes it. v_cost stays null.
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

revoke all on function accept_pickup_webhook(text, boolean, text, int, text, text) from public, anon, authenticated;
grant execute on function accept_pickup_webhook(text, boolean, text, int, text, text) to service_role;

commit;

-- ---------------------------------------------------------------------------------------------
-- Rollback. Restores the 0018 body verbatim.
-- ---------------------------------------------------------------------------------------------
-- begin;
--
-- create or replace function accept_pickup_webhook(p_attempt text, p_available boolean, p_decline text,
--                                                  p_request_version int, p_event_id text,
--                                                  p_payload_sha256 text)
-- returns text language plpgsql security definer set search_path = public as $$
-- declare
--   v_job text; v_candidate text; v_status text; v_rv int; v_child text;
--   v_already text; v_code text; v_transport boolean; v_cap numeric;
--   v_school record; v_origin record; v_miles numeric; v_cost numeric; v_prev text;
-- begin
--   if p_event_id is null or p_event_id = '' or p_payload_sha256 is null then
--     raise exception 'EVENT_ID_REQUIRED';
--   end if;
--
--   select a.job_id, a.candidate_id into v_job, v_candidate
--     from attempts a where a.id = p_attempt for update;
--   if v_job is null then raise exception 'ATTEMPT_NOT_FOUND'; end if;
--
--   -- Claim the event id in THIS transaction. Concurrent duplicates serialise on the primary key.
--   insert into webhook_events (id, attempt_id, request_version, payload_sha256, outcome)
--   values (p_event_id, p_attempt, p_request_version, p_payload_sha256, 'ACCEPTED')
--   on conflict (id) do nothing;
--
--   if not found then
--     select payload_sha256 into v_prev from webhook_events where id = p_event_id;
--     if v_prev = p_payload_sha256 then
--       return 'duplicate';                       -- idempotent: nothing changes
--     end if;
--     raise exception 'EVENT_ID_CONFLICT';        -- same id, different body
--   end if;
--
--   select j.status, j.request_version, j.child_id
--     into v_status, v_rv, v_child
--     from coordination_jobs j where j.id = v_job for update;
--
--   -- State rejections are recorded, with their own outcome, and change no job state.
--   if v_status in ('confirmed','failed') or v_rv <> p_request_version then
--     update webhook_events set outcome = 'REJECTED_STATE' where id = p_event_id;
--     return 'rejected_state';
--   end if;
--
--   select accepted_via into v_already
--     from candidate_evaluations
--    where job_id = v_job and candidate_id = v_candidate
--    for update;
--   if v_already is not null then
--     return 'duplicate';                         -- already answered; nothing changes
--   end if;
--
--   v_transport := exists (select 1 from capabilities c
--                           where c.person_id = v_candidate and c.name = 'transport.child')
--              and exists (select 1 from vehicles v where v.owner_id = v_candidate);
--
--   select lat, lng into v_school
--     from locations where owner_type = 'CHILD' and owner_id = v_child and label = 'school' limit 1;
--   select lat, lng, source into v_origin
--     from locations where owner_type = 'PERSON' and owner_id = v_candidate limit 1;
--
--   if v_school.lat is not null and v_origin.lat is not null then
--     v_miles := haversine_miles(v_school.lat, v_school.lng, v_origin.lat, v_origin.lng);
--     v_cost  := estimate_ride_cost_usd(v_miles);
--   end if;
--
--   select hp.value::numeric into v_cap
--     from household_policies hp
--    where hp.rule = 'ride_cost_cap_usd'
--      and hp.household_id in (select hm.household_id from household_members hm
--                               where hm.person_id = v_child and hm.role = 'child')
--    limit 1;
--
--   v_code := case
--               when p_available is false and p_decline = 'NO_TRANSPORT' then 'AVAILABLE_NO_TRANSPORT'
--               when p_available is false then 'UNAVAILABLE'
--               when p_available is true and not v_transport then 'AVAILABLE_NO_TRANSPORT'
--               when p_available is true and v_cost is not null and v_cap is not null and v_cost > v_cap
--                 then 'OVER_POLICY'
--               else null
--             end;
--
--   update candidate_evaluations
--      set available = p_available,
--          decline_reason = p_decline,
--          accepted_via = 'WEBHOOK_CALLBACK',
--          reason_code = v_code,
--          distance_miles = v_miles,
--          estimated_ride_cost_usd = v_cost,
--          cost_basis = case when v_cost is null then null
--                            else 'FridgeGraph synthetic planning estimate: haversine distance x $1.40/mi' end,
--          location_provenance = v_origin.source,
--          cost_calculated_at = case when v_cost is null then null else now() end,
--          updated_at = now()
--    where job_id = v_job and candidate_id = v_candidate;
--
--   if v_status = 'discovering' then
--     perform _rank_and_advance(v_job);
--   end if;
--
--   return 'recorded';
-- end $$;
--
-- commit;
