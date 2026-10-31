-- 0042 — narrow, database-enforced exception: disposal of DISPOSABLE SIMULATED Orbit records.
--
-- Ordinary UPDATE and DELETE on orbit_responses remain forbidden. Deletion becomes possible ONLY when
-- ALL of the following hold, and never otherwise:
--   1. the transaction-local GUC app.demo_reset = 'on' (marker only — never sufficient alone);
--   2. the parent alert is sandbox;
--   3. the alert is NOT tied to the consented real-call exception (its job is not a real/demo-caller job
--      and no real-call authorization references it);
--   4. every audience member's notification_outcome is SIMULATED or TEST_RESPONDER.
-- The GUC is set inside a SECURITY DEFINER function; browser callers have no EXECUTE grant and cannot
-- reach the trigger's escape branch by setting a GUC over the wire.

create table if not exists demo_reset_audit (
  id           bigserial primary key,
  actor        text not null,
  at           timestamptz not null default now(),
  removed      jsonb not null
);
revoke all on demo_reset_audit from anon, authenticated;

create or replace function _orbit_response_disposable(p_alert_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from orbit_alerts a
     where a.id = p_alert_id
       and a.sandbox is true
       -- sandbox alone is insufficient. Protect REAL-CONSENTED records by their own explicit markers.
       -- `demo_caller = true` is NOT such a marker: it means "originated in a demo session, real outreach
       -- refused", i.e. exactly the disposable case. Excluding it here inverted the guard.
       and (to_regclass('public.real_call_authorizations') is null or not exists (
             select 1 from real_call_authorizations r where r.job_id = a.job_id))
       and not exists (
             select 1 from attempts x
              where x.job_id = a.job_id and x.real_consent_authorization_id is not null)
       and not exists (
             select 1 from orbit_audience_members m
              where m.orbit_alert_id = a.id
                and coalesce(m.notification_outcome, '') not in ('SIMULATED', 'TEST_RESPONDER'))
  );
$$;

create or replace function _orbit_responses_append_only()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE'
     and current_setting('app.demo_reset', true) = 'on'
     and _orbit_response_disposable(old.orbit_alert_id) then
    return old;
  end if;
  raise exception 'ORBIT_RESPONSES_APPEND_ONLY' using errcode = '42501';
end $$;

-- The privileged path. SECURITY DEFINER, owner-executed, not reachable from a browser session.
create or replace function reset_demo_orbit(p_actor text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_removed int := 0; v_audience int := 0; v_alerts jsonb;
begin
  perform set_config('app.demo_reset', 'on', true);   -- transaction-local
  select coalesce(jsonb_agg(id), '[]'::jsonb) into v_alerts
    from orbit_alerts a
   where a.sandbox is true and _orbit_response_disposable(a.id);
  delete from orbit_responses r where r.orbit_alert_id in
    (select id from orbit_alerts a where a.sandbox is true and _orbit_response_disposable(a.id));
  get diagnostics v_removed = row_count;
  delete from orbit_audience_members m using orbit_alerts a
   where m.orbit_alert_id = a.id and a.sandbox is true and _orbit_response_disposable(a.id);
  get diagnostics v_audience = row_count;
  delete from orbit_alerts a where a.sandbox is true and _orbit_response_disposable(a.id);
  insert into demo_reset_audit (actor, removed)
  values (p_actor, jsonb_build_object('orbit_responses', v_removed, 'orbit_audience_members', v_audience,
                                      'orbit_alerts', jsonb_array_length(v_alerts), 'alerts', v_alerts));
  perform set_config('app.demo_reset', 'off', true);
  return jsonb_build_object('orbit_responses', v_removed, 'orbit_audience_members', v_audience,
                            'orbit_alerts', jsonb_array_length(v_alerts));
end $$;

revoke all on function reset_demo_orbit(text) from public, anon, authenticated;
