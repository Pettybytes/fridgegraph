-- 0050 — DEMO decisions reset; REAL decisions never do.
--
-- 0047 made a consent decision unique per slip, so the first demo visitor who approves a sandbox slip
-- locks it for every later visitor ("already approved"). Reset has to clear that — but it must never
-- touch a real decision.
--
-- Two independent conditions, both required:
--   1. the approval was made by a DEMO caller (`demo_caller`, set server-side from the verified token,
--      never from client input — the same trusted marker 0025 already uses for attempts), AND
--   2. the approval's SUBJECT is a sandbox record (a sandbox child's slip/grant/holiday arrangement, or
--      a relationship into a sandbox person).
-- A non-demo caller's approval, or any approval on a non-sandbox subject, is untouched.

alter table approvals add column if not exists demo_caller boolean not null default false;

/** The marker is derived from the verified token, so a client cannot forge it. */
create or replace function approvals_mark_demo_caller() returns trigger
language plpgsql as $$
begin
  new.demo_caller := is_demo_caller();
  return new;
end $$;

drop trigger if exists approvals_mark_demo_caller on approvals;
create trigger approvals_mark_demo_caller before insert on approvals
  for each row execute function approvals_mark_demo_caller();

/** Is this approval's subject a sandbox record? Unknown subject types are never sandbox. */
create or replace function is_sandbox_approval_subject(p_type text, p_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select case p_type
    when 'permission_slip' then exists (
      select 1 from permission_slips s where s.id = p_id and is_sandbox_child(s.child_id))
    when 'Grant' then exists (
      select 1 from grants g where g.id = p_id and is_sandbox_child(g.child_id))
    when 'Relationship' then exists (
      select 1 from relationships r where r.id = p_id and is_sandbox_person(r.to_id))
    when 'HolidayArrangement' then exists (
      select 1 from holiday_arrangements h where h.id = p_id and is_sandbox_child(h.child_id))
    else false
  end
$$;

revoke all on function is_sandbox_approval_subject(text, text) from public, anon;
grant execute on function is_sandbox_approval_subject(text, text) to authenticated, service_role;

/**
 * Clears demo decisions and puts their subject back to its seed state. Returns the number cleared.
 * Runs inside reset's transaction and advisory lock; it never deletes a real decision.
 */
create or replace function reset_demo_decisions() returns integer
language plpgsql security definer set search_path = public as $$
declare v_cleared int := 0;
begin
  with cleared as (
    delete from approvals a
     where a.demo_caller is true
       and is_sandbox_approval_subject(a.subject_type, a.subject_id)
    returning 1
  )
  select count(*) into v_cleared from cleared;

  -- The slip's own state goes back to the seed: unsigned when no decision remains on it.
  update permission_slips s
     set signed = false
   where s.signed is true
     and is_sandbox_child(s.child_id)
     and not exists (
       select 1 from approvals a
        where a.subject_type = 'permission_slip' and a.subject_id = s.id);

  return v_cleared;
end $$;

revoke all on function reset_demo_decisions() from public, anon, authenticated;
grant execute on function reset_demo_decisions() to service_role;

-- The SINGLE audit row per reset now carries the cleared-decision count too, so the trace stays one
-- row per reset and holds counts only (no ids, no names).
drop function if exists reset_demo_orbit(text);

create function reset_demo_orbit(p_actor text, p_extra jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_responses int := 0; v_audience int := 0; v_alerts jsonb;
begin
  perform set_config('app.demo_reset', 'on', true);

  -- Snapshot FIRST, with all rows present.
  create temp table if not exists reset_eligibility (alert_id text primary key) on commit drop;
  delete from reset_eligibility;
  insert into reset_eligibility (alert_id)
  select a.id
    from orbit_alerts a
   where a.sandbox is true
     -- real-consented protection, by explicit markers only
     and (to_regclass('public.real_call_authorizations') is null
          or not exists (select 1 from real_call_authorizations r where r.job_id = a.job_id))
     and not exists (select 1 from attempts x
                      where x.job_id = a.job_id and x.real_consent_authorization_id is not null)
     -- every audience outcome must be a disposable one; NULL is NOT disposable
     and not exists (select 1 from orbit_audience_members m
                      where m.orbit_alert_id = a.id
                        and m.notification_outcome is distinct from 'SIMULATED'
                        and m.notification_outcome is distinct from 'TEST_RESPONDER');

  select coalesce(jsonb_agg(alert_id), '[]'::jsonb) into v_alerts from reset_eligibility;

  delete from orbit_responses r using reset_eligibility e where r.orbit_alert_id = e.alert_id;
  get diagnostics v_responses = row_count;
  delete from orbit_audience_members m using reset_eligibility e where m.orbit_alert_id = e.alert_id;
  get diagnostics v_audience = row_count;
  delete from orbit_alerts a using reset_eligibility e where a.id = e.alert_id;

  insert into demo_reset_audit (actor, removed)
  values (p_actor, jsonb_build_object('orbit_responses', v_responses,
                                      'orbit_audience_members', v_audience,
                                      'orbit_alerts', jsonb_array_length(v_alerts),
                                      'alerts', v_alerts) || coalesce(p_extra, '{}'::jsonb));
  perform set_config('app.demo_reset', 'off', true);
  return jsonb_build_object('orbit_responses', v_responses, 'orbit_audience_members', v_audience,
                            'orbit_alerts', jsonb_array_length(v_alerts)) || coalesce(p_extra, '{}'::jsonb);
end $$;

revoke all on function reset_demo_orbit(text, jsonb) from public, anon, authenticated;
