-- 0023_promote_real_consented.sql
--
-- Group 1 / E0: the real-call mint path. Forward-only. 0001-0022 are never edited.
--
-- WHY: `request_pickup` mints the job and `_evaluate_candidates` opens a TEST_RESPONDER attempt for
-- every eligible candidate. `attempts` is unique on (job_id, candidate_id) for all attempts, closed
-- or not, so a REAL_CONSENTED attempt for the same candidate cannot be opened afterwards. Session 3
-- worked around this by inserting the job directly (evidence 33 §2), which is not a path we want.
--
-- THE SHAPE: mint (request_pickup) -> promote one undispatched TEST_RESPONDER attempt -> dispatch.
--
--   promote_attempt_to_real_consented(attempt, contact)
--     * VALIDATES a RealCallAuthorization bound to job + candidate + this recipient + the job's
--       request version, unconsumed and unexpired. It raises if there is none. It never downgrades.
--     * rewrites the attempt in place: destination = the GHL contact, destination_mode =
--       REAL_CONSENTED, real_consent_authorization_id = that authorization.
--     * attaches authorization.attempt_id to the attempt.
--     * DOES NOT CONSUME. Consumption stays exactly where it is today — the single atomic
--       `consume_real_call_authorization(attempt, contact)`, called by dispatch before anything
--       outbound. Promoting twice, promoting a closed attempt, or promoting another recipient's
--       authorization all raise.
--
-- Rollback: commented at the bottom.

begin;

create or replace function promote_attempt_to_real_consented(p_attempt text, p_contact text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_job text; v_candidate text; v_mode text; v_closed timestamptz;
  v_rv int; v_status text; v_auth text;
begin
  if p_attempt is null or p_attempt = '' or p_contact is null or p_contact = '' then
    raise exception 'PROMOTE_ARGS_REQUIRED';
  end if;

  select a.job_id, a.candidate_id, a.destination_mode, a.closed_at, j.request_version, j.status
    into v_job, v_candidate, v_mode, v_closed, v_rv, v_status
    from attempts a
    join coordination_jobs j on j.id = a.job_id
   where a.id = p_attempt
   for update of a;

  if v_job is null then raise exception 'ATTEMPT_NOT_FOUND'; end if;
  if v_closed is not null then raise exception 'ATTEMPT_CLOSED'; end if;
  if v_mode = 'REAL_CONSENTED' then raise exception 'ALREADY_REAL_CONSENTED'; end if;
  if v_mode is distinct from 'TEST_RESPONDER' then raise exception 'BAD_DESTINATION_MODE'; end if;
  if v_status <> 'discovering' then raise exception 'JOB_NOT_DISCOVERING'; end if;

  -- Validation only. An authorization already bound to a different attempt is not stolen.
  select a.id into v_auth
    from real_call_authorizations a
   where a.consumed_at is null
     and a.expires_at > now()
     and a.job_id = v_job
     and a.candidate_id = v_candidate
     and a.contact_ref = p_contact
     and a.request_version = v_rv
     and (a.attempt_id is null or a.attempt_id = p_attempt)
   order by a.issued_at
   limit 1
   for update;

  if v_auth is null then raise exception 'REAL_CALL_NOT_AUTHORIZED'; end if;

  update attempts
     set destination = p_contact,
         destination_mode = 'REAL_CONSENTED',
         real_consent_authorization_id = v_auth
   where id = p_attempt;

  update real_call_authorizations set attempt_id = p_attempt where id = v_auth;

  return 'promoted:' || p_attempt;
end $$;

revoke all on function promote_attempt_to_real_consented(text, text) from public, anon, authenticated;
grant execute on function promote_attempt_to_real_consented(text, text) to service_role;

comment on function promote_attempt_to_real_consented(text, text) is
  'Validates a RealCallAuthorization against a job+candidate+recipient+request_version and rewrites '
  'that undispatched TEST_RESPONDER attempt to REAL_CONSENTED. Never consumes; dispatch does.';

commit;

-- ROLLBACK (not applied):
--   drop function if exists promote_attempt_to_real_consented(text, text);
--   update attempts set destination_mode='TEST_RESPONDER', real_consent_authorization_id=null,
--          destination = (select value from contact_methods cm where cm.person_id = attempts.candidate_id and cm.verified order by cm.preferred desc limit 1)
--    where destination_mode='REAL_CONSENTED';
