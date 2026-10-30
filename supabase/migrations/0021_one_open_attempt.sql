-- 0021_one_open_attempt.sql
--
-- Follow-up to 0020, forward-only. 0001-0020 are never edited.
--
-- Bryan's decision D2 (level-b-plan.md / webhook.md):
--   ONE OPEN ATTEMPT PER CONTACT. A new attempt for a contact is refused while another of that
--   contact's attempts is open. An event naming an attempt that is no longer open is rejected with
--   no state change.
--
-- Bryan's decision D4:
--   No-answer is a SYSTEM-OBSERVED outcome, persisted as its own event source
--   (webhook_events.source = 'no_answer'). It is never recorded or shown as the caregiver
--   declining: record_no_answer() does not touch candidate_evaluations at all.
--
-- What changes:
--
--   1. attempts.closed_at / closed_reason. An attempt is OPEN while closed_at is null.
--      Backfill closes (a) attempts whose job has already left `discovering`, then (b) every
--      older duplicate per contact, keeping the newest. Without that backfill the new index
--      could not be created on the existing rehearsal data.
--   2. `attempts_one_open_per_contact`: a PARTIAL UNIQUE INDEX on (candidate_id) where
--      closed_at is null. This is the enforcement, not a read-then-write check. Two concurrent
--      transactions cannot both commit an open attempt for one contact: the second blocks on the
--      index entry and then fails. open_attempt() turns that into a clean 'refused:<open id>'.
--   3. open_attempt(): the single write path for opening an attempt. Returns
--      'opened:<id>' or 'refused:<id of the attempt already open>'.
--   4. close_attempt(): the single write path for closing one, idempotent.
--   5. _close_attempt_on_outcome(): AFTER UPDATE trigger on candidate_evaluations. Any
--      reason_code that is not 'PENDING' is an outcome, so the attempt for that (job, candidate)
--      closes in the same transaction, whichever function wrote it (reply, timeout, ranking,
--      over-limit fallback). This is what keeps the constraint from wedging a contact shut when a
--      discovery window expires.
--   6. accept_pickup_webhook(): rejects an attempt that is not open BEFORE claiming the event id,
--      so a stale event produces no state change and no webhook_events row (delta 0). Body is
--      otherwise identical to 0020.
--   7. record_no_answer(): new. Claims the event id with source='no_answer', closes the attempt,
--      writes nothing to candidate_evaluations.
--   8. webhook_events gains `source` (default 'reply') and its outcome set gains
--      'REJECTED_CLOSED_ATTEMPT' and 'NO_ANSWER'.
--
-- KNOWN LIMITATION (D2 correlation is a separate requirement, and these three checks do NOT
-- prove stale-event protection):
--   One open attempt narrows the window, but it does not make correlation. Nothing here compares
--   an identifier from the GHL event against an identifier stored on the attempt, so a delayed
--   event from attempt A can still be read as attempt B after the contact field changes — it can
--   only be refused while B is open if A itself is already closed AND the event names A. A
--   directly supplied closed attempt id being rejected is not stale-event protection.
--
-- Rollback: commented at the bottom.

begin;

-- ---------------------------------------------------------------------------
-- 1. Attempt lifecycle columns + backfill
-- ---------------------------------------------------------------------------

alter table attempts
  add column if not exists closed_at     timestamptz,
  add column if not exists closed_reason text,
  add column if not exists opened_by     text;

comment on column attempts.closed_at is
  'OPEN means closed_at is null. Set by close_attempt(), by the outcome trigger, by a no-answer, '
  'or by the 0021 backfill.';

-- (a) close attempts belonging to a job that is no longer discovering
update attempts a
   set closed_at = now(), closed_reason = 'BACKFILL_JOB_INACTIVE'
 where a.closed_at is null
   and not exists (select 1 from coordination_jobs j
                    where j.id = a.job_id and j.status = 'discovering');

-- (b) keep only the newest open attempt per contact
update attempts a
   set closed_at = now(), closed_reason = 'BACKFILL_SUPERSEDED'
 where a.closed_at is null
   and exists (select 1 from attempts b
                where b.candidate_id = a.candidate_id
                  and b.closed_at is null
                  and (b.at, b.id) > (a.at, a.id));

-- ---------------------------------------------------------------------------
-- 2. The enforcement
-- ---------------------------------------------------------------------------

create unique index if not exists attempts_one_open_per_contact
  on attempts (candidate_id)
  where closed_at is null;

comment on index attempts_one_open_per_contact is
  'D2: exactly one open attempt per contact. Enforced by the index, never by a read-then-write '
  'check, so two concurrent creators cannot both win.';

-- ---------------------------------------------------------------------------
-- 3. Open / close write paths
-- ---------------------------------------------------------------------------

-- Returns 'opened:<attempt id>' or 'refused:<id of the attempt already open>'.
create or replace function open_attempt(p_job text, p_candidate text, p_channel text,
                                        p_destination text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_id text; v_prev text; v_job text;
begin
  if p_job is null or p_candidate is null or p_channel is null then
    raise exception 'ATTEMPT_ARGS_REQUIRED';
  end if;

  -- The job must exist and still be discovering: opening an attempt for a ranked job would
  -- immediately violate the invariant the trigger maintains.
  select j.id into v_job from coordination_jobs j
   where j.id = p_job and j.status = 'discovering';
  if v_job is null then raise exception 'JOB_NOT_DISCOVERING'; end if;

  insert into attempts (id, job_id, channel, at, candidate_id, destination, destination_mode)
  values ('att_' || substr(md5(p_job || p_candidate || clock_timestamp()::text), 1, 24),
          p_job, p_channel, now(), p_candidate, p_destination, 'TEST_RESPONDER')
  on conflict (candidate_id) where closed_at is null do nothing
  returning id into v_id;

  if v_id is null then
    select a.id into v_prev from attempts a
     where a.candidate_id = p_candidate and a.closed_at is null
     for update;
    return 'refused:' || coalesce(v_prev, 'unknown');
  end if;

  return 'opened:' || v_id;
end $$;
revoke all on function open_attempt(text, text, text, text) from public, anon, authenticated;
grant execute on function open_attempt(text, text, text, text) to service_role;

-- Idempotent. Returns true when this call closed it, false when it was already closed.
create or replace function close_attempt(p_attempt text, p_reason text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  update attempts set closed_at = now(), closed_reason = coalesce(p_reason, 'CLOSED')
   where id = p_attempt and closed_at is null;
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;
revoke all on function close_attempt(text, text) from public, anon, authenticated;
grant execute on function close_attempt(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Outcome trigger: an answer of any kind closes the attempt
-- ---------------------------------------------------------------------------

create or replace function _close_attempt_on_outcome()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- 'PENDING' is the workflow state (outreach sent, no answer yet). Anything else -- including
  -- NULL, which is what an accepted answer with no reason code writes -- is an outcome.
  if new.reason_code is distinct from 'PENDING' then
    update attempts a
       set closed_at = coalesce(a.closed_at, now()),
           closed_reason = coalesce(a.closed_reason,
                                    case when new.available is true then 'ANSWERED_YES'
                                         when new.available is false then 'ANSWERED_NO'
                                         else 'OUTCOME_RECORDED' end)
     where a.job_id = new.job_id
       and a.candidate_id = new.candidate_id
       and a.closed_at is null;
  end if;
  return new;
end $$;
revoke all on function _close_attempt_on_outcome() from public, anon, authenticated;

drop trigger if exists candidate_evaluations_close_attempt on candidate_evaluations;
create trigger candidate_evaluations_close_attempt
  after update of reason_code, available on candidate_evaluations
  for each row execute function _close_attempt_on_outcome();

-- ---------------------------------------------------------------------------
-- 5. webhook_events: source + widened outcomes
-- ---------------------------------------------------------------------------

alter table webhook_events
  add column if not exists source text not null default 'reply';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'webhook_events_source_check') then
    alter table webhook_events add constraint webhook_events_source_check
      check (source in ('reply','no_answer')) not valid;
  end if;
end $$;

alter table webhook_events drop constraint if exists webhook_events_outcome_check;
alter table webhook_events add constraint webhook_events_outcome_check
  check (outcome in ('ACCEPTED','REJECTED_STATE','REJECTED_BINDING',
                     'REJECTED_CLOSED_ATTEMPT','NO_ANSWER')) not valid;

comment on column webhook_events.source is
  'D4: a reply answers the caregiver question; no_answer is a system-observed call outcome and is '
  'never a decline.';

-- ---------------------------------------------------------------------------
-- 6. accept_pickup_webhook: reject a non-open attempt with zero state change
--    (body is 0020 otherwise)
-- ---------------------------------------------------------------------------

create or replace function accept_pickup_webhook(p_attempt text, p_available boolean, p_decline text,
                                                 p_request_version int, p_event_id text,
                                                 p_payload_sha256 text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_job text; v_candidate text; v_status text; v_rv int; v_child text;
  v_already text; v_code text; v_transport boolean; v_cap numeric;
  v_school record; v_origin record; v_miles numeric; v_cost numeric; v_prev text;
  v_closed timestamptz;
begin
  if p_event_id is null or p_event_id = '' or p_payload_sha256 is null then
    raise exception 'EVENT_ID_REQUIRED';
  end if;

  select a.job_id, a.candidate_id, a.closed_at into v_job, v_candidate, v_closed
    from attempts a where a.id = p_attempt for update;
  if v_job is null then raise exception 'ATTEMPT_NOT_FOUND'; end if;

  -- D2: an attempt that is no longer open cannot carry an event. Rejected BEFORE the event id is
  -- claimed, so webhook_events delta is 0 and no row anywhere changes.
  if v_closed is not null then
    return 'rejected_closed';
  end if;

  -- Claim the event id in THIS transaction. Concurrent duplicates serialise on the primary key.
  insert into webhook_events (id, attempt_id, request_version, payload_sha256, outcome, source)
  values (p_event_id, p_attempt, p_request_version, p_payload_sha256, 'ACCEPTED', 'reply')
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

  -- No ride estimate is computed on the reply path (0020). v_cost stays null.
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

  -- The AFTER UPDATE trigger closed the attempt here (reason_code/available just changed).

  if v_status = 'discovering' then
    perform _rank_and_advance(v_job);
  end if;

  return 'recorded';
end $$;

revoke all on function accept_pickup_webhook(text, boolean, text, int, text, text)
  from public, anon, authenticated;
grant execute on function accept_pickup_webhook(text, boolean, text, int, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 7. record_no_answer: D4, its own source, never a decline
-- ---------------------------------------------------------------------------

create or replace function record_no_answer(p_attempt text, p_event_id text, p_payload_sha256 text)
returns text language plpgsql security definer set search_path = public as $$
declare v_job text; v_closed timestamptz; v_prev text; v_status text;
begin
  if p_event_id is null or p_event_id = '' or p_payload_sha256 is null then
    raise exception 'EVENT_ID_REQUIRED';
  end if;

  select a.job_id, a.closed_at into v_job, v_closed
    from attempts a where a.id = p_attempt for update;
  if v_job is null then raise exception 'ATTEMPT_NOT_FOUND'; end if;

  -- Same rule as a reply: a non-open attempt cannot carry an event. No row, no change.
  if v_closed is not null then
    return 'rejected_closed';
  end if;

  insert into webhook_events (id, attempt_id, request_version, payload_sha256, outcome, source)
  values (p_event_id, p_attempt, null, p_payload_sha256, 'NO_ANSWER', 'no_answer')
  on conflict (id) do nothing;

  if not found then
    select payload_sha256 into v_prev from webhook_events where id = p_event_id;
    if v_prev = p_payload_sha256 then return 'duplicate'; end if;
    raise exception 'EVENT_ID_CONFLICT';
  end if;

  select j.status into v_status from coordination_jobs j where j.id = v_job for update;
  if v_status in ('confirmed','failed') then
    update webhook_events set outcome = 'REJECTED_STATE' where id = p_event_id;
    return 'rejected_state';
  end if;

  update attempts set closed_at = now(), closed_reason = 'NO_ANSWER'
   where id = p_attempt and closed_at is null;

  -- Deliberately nothing on candidate_evaluations: a call that was not answered is not a person
  -- saying no. The discovery window still decides her availability.
  return 'recorded';
end $$;
revoke all on function record_no_answer(text, text, text) from public, anon, authenticated;
grant execute on function record_no_answer(text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 8. _evaluate_candidates: tolerate a refusal instead of aborting the whole job
--    (only the attempts INSERT changes; the insert has no index target so BOTH unique
--     indexes are handled)
-- ---------------------------------------------------------------------------

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
           else 'PENDING'
         end
    from pickup_candidates_for(p_child, p_as_of) r
  on conflict (job_id, request_version, candidate_id) do nothing;

  -- D2: a candidate who already has an open attempt is refused, not duplicated. That candidate
  -- keeps her PENDING evaluation and will time out; the refusal is visible as the absent attempt.
  insert into attempts (id, job_id, channel, at, candidate_id, destination, destination_mode)
  select 'att_' || substr(md5(p_job || ce.candidate_id), 1, 24), p_job, cm.channel, now(),
         ce.candidate_id, cm.value, 'TEST_RESPONDER'
    from candidate_evaluations ce
    join lateral (
      select channel, value from contact_methods
       where person_id = ce.candidate_id and verified
       order by preferred desc, channel limit 1
    ) cm on true
   where ce.job_id = p_job and ce.reason_code = 'PENDING'
  on conflict do nothing;
end $$;
revoke all on function _evaluate_candidates(text, text, date) from public, anon, authenticated;

commit;

-- ---------------------------------------------------------------------------------------------
-- Rollback. Forward-only file; these statements are not run by any tooling.
-- ---------------------------------------------------------------------------------------------
-- begin;
-- drop trigger if exists candidate_evaluations_close_attempt on candidate_evaluations;
-- drop function if exists _close_attempt_on_outcome();
-- drop function if exists record_no_answer(text, text, text);
-- drop function if exists close_attempt(text, text);
-- drop function if exists open_attempt(text, text, text, text);
-- drop index if exists attempts_one_open_per_contact;
-- alter table attempts drop column if exists opened_by, drop column if exists closed_reason,
--   drop column if exists closed_at;
-- alter table webhook_events drop constraint if exists webhook_events_source_check;
-- alter table webhook_events drop column if exists source;
-- alter table webhook_events drop constraint if exists webhook_events_outcome_check;
-- alter table webhook_events add constraint webhook_events_outcome_check
--   check (outcome in ('ACCEPTED','REJECTED_STATE','REJECTED_BINDING'));
-- -- _evaluate_candidates and accept_pickup_webhook: re-run 0020 and 0013 bodies respectively.
-- commit;
