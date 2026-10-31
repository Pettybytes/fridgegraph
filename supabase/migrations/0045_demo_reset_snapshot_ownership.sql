-- 0045 — the snapshot must have been written by the privileged function's own definer context.
--
-- 0043/0044 accepted any session temp table named reset_eligibility holding the alert id. A role with
-- SQL access could therefore create its own table of that name, insert an id, set app.demo_reset and
-- delete that alert's responses. Presence in a table of that name is not authority.
--
-- The trigger now additionally requires the table's OWNER to be the owner of reset_demo_orbit — i.e.
-- the definer that created it inside the privileged transaction.

create or replace function _reset_eligible(p_alert_id text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v boolean := false; v_owner oid;
begin
  select c.relowner into v_owner
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname like 'pg_temp%' and c.relname = 'reset_eligibility'
   limit 1;
  if v_owner is null then return false; end if;

  -- Only the definer's own snapshot counts; a same-named table owned by anyone else is refused.
  if v_owner <> (select p.proowner from pg_proc p where p.proname = 'reset_demo_orbit' limit 1) then
    return false;
  end if;

  execute 'select exists (select 1 from reset_eligibility where alert_id = $1)' into v using p_alert_id;
  return coalesce(v, false);
end $$;
