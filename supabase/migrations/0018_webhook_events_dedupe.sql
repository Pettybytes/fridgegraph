-- 0018 — durable transport-level dedupe, and the atomic reply path that uses it.
--
-- Bryan's correction to the first draft: recording the event BEFORE the RPC marks a delivery
-- handled even when the state change fails, so a failure loses the reply and n8n's retry gets 409.
-- The dedupe therefore moves INSIDE accept_pickup_webhook, in the same transaction as the write.
--
-- Resulting behaviour:
--   same event id + same payload      -> 'duplicate', nothing changes (idempotent retry)
--   same event id + different payload -> EVENT_ID_CONFLICT, rejected (rolls back, previous row stays)
--   processing raises                 -> the whole transaction rolls back, so nothing is recorded as
--                                        ACCEPTED and a retry succeeds
--   concurrent duplicates             -> the unique index serialises them; exactly one transition
--   state rejections (terminal job, stale request_version) -> recorded with outcome REJECTED_STATE
--                                        in the same transaction, and no job state changes
--
-- The HMAC, timestamp, attempt/binding and request_version checks in the HTTP layer are unchanged.
--
-- Signature note: accept_pickup_webhook grows two parameters (event id + payload digest). The
-- 4-argument form is REPLACED with a guard that refuses, because a call without an event id could
-- bypass dedupe entirely. Nothing is dropped; no object is removed.
--
-- Rollback: drop the 6-argument function, restore the 0016 4-argument body, drop table webhook_events.

begin;

create table if not exists webhook_events (
  id              text primary key,                -- provider event id
  received_at     timestamptz not null default now(),
  attempt_id      text references attempts(id) on delete cascade,
  request_version int,
  payload_sha256  text not null,
  outcome         text not null check (outcome in ('ACCEPTED','REJECTED_STATE','REJECTED_BINDING'))
);

comment on table webhook_events is
  'Transport-level idempotency for coordination webhook deliveries (webhook.md §4). The primary '
  'key IS the dedupe, and rows are written inside the same transaction as the state change.';

create index if not exists webhook_events_received_at_idx on webhook_events (received_at);

alter table webhook_events enable row level security;
alter table webhook_events force  row level security;
revoke all on webhook_events from anon, authenticated;
grant all privileges on webhook_events to service_role;

-- ---------------------------------------------------------------------------
-- The atomic reply path
-- ---------------------------------------------------------------------------
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

revoke all on function accept_pickup_webhook(text, boolean, text, int, text, text) from public, anon, authenticated;
grant execute on function accept_pickup_webhook(text, boolean, text, int, text, text) to service_role;

-- The 4-argument form cannot record an event, so it must not perform the transition.
create or replace function accept_pickup_webhook(p_attempt text, p_available boolean,
                                                 p_decline text, p_request_version int)
returns text language plpgsql security definer set search_path = public as $$
begin
  raise exception 'EVENT_ID_REQUIRED';
end $$;

revoke all on function accept_pickup_webhook(text, boolean, text, int) from public, anon, authenticated;
grant execute on function accept_pickup_webhook(text, boolean, text, int) to service_role;

commit;
