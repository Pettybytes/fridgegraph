-- 0022_real_consented_attempts.sql
--
-- Follow-up to 0021, forward-only. 0001-0021 are never edited.
--
-- Gate 2 (pickup-job.md §10) becomes a real constraint on attempt creation and consumption:
--
--   a. open_attempt() takes a destination_mode. REAL_CONSENTED is refused unless a valid,
--      unconsumed, unexpired RealCallAuthorization exists bound to that exact job + candidate +
--      intended GHL recipient. §10: the backend REFUSES to dispatch — it never silently
--      downgrades to a test responder. So this raises, it does not fall back.
--   b. consume_real_call_authorization(attempt, contact) — atomic, single-use, bound to the
--      attempt, its job, its candidate and that recipient. Refuses on reuse, expiry, or any
--      mismatch. The dispatcher must call it and succeed BEFORE any tag or enrolment.
--   c. Every row/log touching a real call is labelled: attempts carry the authorization id and
--      the time it was consumed, and webhook_events inherits the attempt's mode.
--
-- Why real_call_authorizations gains job_id/candidate_id/contact_ref and loses NOT NULL on
-- attempt_id: an authorization must be issuable BEFORE the attempt row exists (otherwise it could
-- only ever bless an attempt that was already created as TEST_RESPONDER, which is the exact silent
-- downgrade §10 forbids). Binding it to job+candidate+recipient up front, then attaching the attempt
-- id at creation, keeps "bound to the specific call attempt" true without a pre-existing row.
--
-- Rollback: commented at the bottom.

begin;

-- ---------------------------------------------------------------------------
-- 1. Authorization can be issued before its attempt exists
-- ---------------------------------------------------------------------------

alter table real_call_authorizations
  add column if not exists job_id       text references coordination_jobs(id) on delete cascade,
  add column if not exists candidate_id text references people(id) on delete cascade,
  add column if not exists contact_ref  text;

alter table real_call_authorizations alter column attempt_id drop not null;

comment on column real_call_authorizations.contact_ref is
  'The intended GHL recipient (contact id) this authorization is bound to. A call to any other '
  'recipient is refused.';

-- ---------------------------------------------------------------------------
-- 2. Real-consent labelling (c)
-- ---------------------------------------------------------------------------

alter table attempts
  add column if not exists real_consent_authorization_id text,
  add column if not exists real_consent_consumed_at      timestamptz;

alter table webhook_events
  add column if not exists destination_mode text;

comment on column attempts.real_consent_authorization_id is
  'Set only for a REAL_CONSENTED attempt; the authorization that allowed it.';

-- ---------------------------------------------------------------------------
-- 3. open_attempt(): destination_mode, and the gate that refuses
-- ---------------------------------------------------------------------------

drop function if exists open_attempt(text, text, text, text);

create or replace function open_attempt(p_job text, p_candidate text, p_channel text,
                                        p_destination text default null,
                                        p_destination_mode text default 'TEST_RESPONDER')
returns text language plpgsql security definer set search_path = public as $$
declare
  v_id text; v_prev text; v_job text; v_auth text;
begin
  if p_job is null or p_candidate is null or p_channel is null then
    raise exception 'ATTEMPT_ARGS_REQUIRED';
  end if;
  if p_destination_mode not in ('TEST_RESPONDER','REAL_CONSENTED') then
    raise exception 'BAD_DESTINATION_MODE';
  end if;

  select j.id into v_job from coordination_jobs j
   where j.id = p_job and j.status = 'discovering';
  if v_job is null then raise exception 'JOB_NOT_DISCOVERING'; end if;

  -- Gate 2. Refuse, never downgrade (pickup-job.md §10).
  if p_destination_mode = 'REAL_CONSENTED' then
    if p_destination is null or p_destination = '' then
      raise exception 'REAL_CALL_RECIPIENT_REQUIRED';
    end if;

    select a.id into v_auth
      from real_call_authorizations a
     where a.consumed_at is null
       and a.expires_at > now()
       and a.job_id = p_job
       and a.candidate_id = p_candidate
       and a.contact_ref = p_destination
     order by a.issued_at
     limit 1
     for update;

    if v_auth is null then
      raise exception 'REAL_CALL_NOT_AUTHORIZED';
    end if;
  end if;

  perform _expire_stale_attempts(p_candidate);

  insert into attempts (id, job_id, channel, at, candidate_id, destination, destination_mode,
                        real_consent_authorization_id)
  values ('att_' || substr(md5(p_job || p_candidate || clock_timestamp()::text), 1, 24),
          p_job, p_channel, now(), p_candidate, p_destination, p_destination_mode, v_auth)
  on conflict (candidate_id) where closed_at is null do nothing
  returning id into v_id;

  if v_id is null then
    select a.id into v_prev from attempts a
     where a.candidate_id = p_candidate and a.closed_at is null
     for update;
    return 'refused:' || coalesce(v_prev, 'unknown');
  end if;

  -- Attach the authorization to the attempt it now blesses.
  if v_auth is not null then
    update real_call_authorizations set attempt_id = v_id where id = v_auth;
  end if;

  return 'opened:' || v_id;
end $$;
revoke all on function open_attempt(text, text, text, text, text) from public, anon, authenticated;
grant execute on function open_attempt(text, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. consume_real_call_authorization(attempt, contact) — atomic, single-use
-- ---------------------------------------------------------------------------

-- The 0014 4-argument form is superseded: it could not check job or candidate, and took an
-- authorization id rather than deriving the binding from the attempt. Dropped so a caller cannot
-- pick the weaker gate by accident.
drop function if exists consume_real_call_authorization(text, text, text, int);

create or replace function consume_real_call_authorization(p_attempt text, p_contact text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_job text; v_candidate text; v_mode text; v_rv int; v_n int;
begin
  if p_attempt is null or p_contact is null or p_contact = '' then
    raise exception 'CONSUME_ARGS_REQUIRED';
  end if;

  select a.job_id, a.candidate_id, a.destination_mode, j.request_version
    into v_job, v_candidate, v_mode, v_rv
    from attempts a join coordination_jobs j on j.id = a.job_id
   where a.id = p_attempt
   for update;

  if v_job is null then raise exception 'ATTEMPT_NOT_FOUND'; end if;

  -- An attempt that is not labelled real-consented can never consume an authorization.
  if v_mode is distinct from 'REAL_CONSENTED' then
    return false;
  end if;

  -- One statement is the gate: every predicate binds this authorization to this attempt, its job,
  -- its candidate and this exact recipient. Zero rows updated means no call.
  update real_call_authorizations a
     set consumed_at = now()
   where a.attempt_id = p_attempt
     and a.job_id = v_job
     and a.candidate_id = v_candidate
     and a.contact_ref = p_contact
     and a.request_version = v_rv
     and a.consumed_at is null
     and a.expires_at > now();

  get diagnostics v_n = row_count;
  if v_n = 0 then
    return false;   -- reused, expired, wrong recipient, wrong job/candidate: no call
  end if;

  update attempts
     set real_consent_consumed_at = now()
   where id = p_attempt and real_consent_consumed_at is null;

  return true;
end $$;
revoke all on function consume_real_call_authorization(text, text) from public, anon, authenticated;
grant execute on function consume_real_call_authorization(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. webhook_events inherits the attempt's mode (c)
-- ---------------------------------------------------------------------------

create or replace function _label_webhook_event_mode()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.destination_mode is null and new.attempt_id is not null then
    select a.destination_mode into new.destination_mode from attempts a where a.id = new.attempt_id;
  end if;
  return new;
end $$;
revoke all on function _label_webhook_event_mode() from public, anon, authenticated;

drop trigger if exists webhook_events_label_mode on webhook_events;
create trigger webhook_events_label_mode
  before insert on webhook_events
  for each row execute function _label_webhook_event_mode();

commit;

-- ---------------------------------------------------------------------------------------------
-- Rollback (not run by tooling).
-- ---------------------------------------------------------------------------------------------
-- begin;
-- drop trigger if exists webhook_events_label_mode on webhook_events;
-- drop function if exists _label_webhook_event_mode();
-- alter table webhook_events drop column if exists destination_mode;
-- drop function if exists consume_real_call_authorization(text, text);
-- drop function if exists open_attempt(text, text, text, text, text);
-- alter table attempts drop column if exists real_consent_consumed_at,
--   drop column if exists real_consent_authorization_id;
-- alter table real_call_authorizations alter column attempt_id set not null;
-- alter table real_call_authorizations drop column if exists contact_ref,
--   drop column if exists candidate_id, drop column if exists job_id;
-- -- then re-apply 0021's open_attempt and 0014's consume function.
-- commit;
