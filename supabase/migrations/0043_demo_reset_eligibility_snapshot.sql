-- 0043 — eligibility is decided ONCE, before any row is removed.
--
-- 0042 re-evaluated _orbit_response_disposable() at each delete. That is wrong in two ways:
--   * deleting audience rows first makes the "every outcome is SIMULATED" test vacuously true;
--   * a cascading delete from orbit_alerts hits rows whose parent is already gone, so the predicate
--     returns false and the append-only guard fires.
-- Neither is a reason to weaken the guard: eligibility is snapshotted into a session temp table while
-- every row still exists, and the trigger accepts a delete only when the alert is IN that snapshot.
-- NULL notification_outcome stays ineligible — it is never coerced to SIMULATED.

create or replace function reset_demo_orbit(p_actor text) returns jsonb
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
  -- Only snapshot ids: a non-eligible alert is never deleted, so no cascade can reach its responses.
  delete from orbit_alerts a using reset_eligibility e where a.id = e.alert_id;

  insert into demo_reset_audit (actor, removed)
  values (p_actor, jsonb_build_object('orbit_responses', v_responses,
                                      'orbit_audience_members', v_audience,
                                      'orbit_alerts', jsonb_array_length(v_alerts),
                                      'alerts', v_alerts));
  perform set_config('app.demo_reset', 'off', true);
  return jsonb_build_object('orbit_responses', v_responses, 'orbit_audience_members', v_audience,
                            'orbit_alerts', jsonb_array_length(v_alerts));
end $$;

revoke all on function reset_demo_orbit(text) from public, anon, authenticated;

-- The trigger accepts a delete only for a snapshotted alert, and only inside the privileged path.
create or replace function _orbit_responses_append_only()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE'
     and current_setting('app.demo_reset', true) = 'on'
     and to_regclass('pg_temp.reset_eligibility') is not null
     and exists (select 1 from reset_eligibility e where e.alert_id = old.orbit_alert_id) then
    return old;
  end if;
  raise exception 'ORBIT_RESPONSES_APPEND_ONLY' using errcode = '42501';
end $$;
