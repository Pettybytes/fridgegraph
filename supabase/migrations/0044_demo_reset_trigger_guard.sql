-- 0044 — the trigger must not reference the temp table directly.
--
-- PL/pgSQL resolves relations at plan time, so `exists (select 1 from reset_eligibility ...)` raises
-- "relation does not exist" whenever the temp table is absent — even behind a to_regclass short-circuit.
-- Resolution goes through a dynamic query instead, which is safe when the table is missing.

create or replace function _reset_eligible(p_alert_id text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v boolean := false;
begin
  if to_regclass('pg_temp.reset_eligibility') is null then return false; end if;
  execute 'select exists (select 1 from reset_eligibility where alert_id = $1)' into v using p_alert_id;
  return coalesce(v, false);
end $$;

create or replace function _orbit_responses_append_only()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE'
     and current_setting('app.demo_reset', true) = 'on'
     and _reset_eligible(old.orbit_alert_id) then
    return old;
  end if;
  raise exception 'ORBIT_RESPONSES_APPEND_ONLY' using errcode = '42501';
end $$;
