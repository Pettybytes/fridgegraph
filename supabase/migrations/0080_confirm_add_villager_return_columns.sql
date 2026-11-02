-- 0080 — confirm_add_villager returned one column short, so the FIRST successful confirm always failed.
--
-- EVIDENCE (2026-11-02, read-only diagnosis)
--   [access.addVillagerError] unmapped RPC error correlationId=6087639a-059c-4158-a8b8-ea12f6ca4127
--   sqlstate=42804
-- The function declares 10 result columns (…, valid_until, granted_by). Its already-confirmed early
-- return selects all 10; the FINAL return query after the inserts selected only 9, stopping at
-- valid_until. A first-time confirm therefore hit 42804 (datatype_mismatch) and plpgsql rolled the
-- whole function back — proposal vp_9c8114984df1 stayed unconfirmed, the relationship stayed
-- DISCOVERED, and no grant or approvals row was written. Nothing was corrupted; the path simply
-- never worked.
--
-- This is a one-line correction inside the function body. No table, policy or grant changes.
-- Forward-only: applied after both proof participants released.

begin;

CREATE OR REPLACE FUNCTION public.confirm_add_villager(p_proposal text, p_version integer)
 RETURNS TABLE(relationship_id text, relationship_type text, relationship_status text, person_id text, child_id text, grant_id text, scopes text[], valid_from date, valid_until date, granted_by text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_prop villager_proposals; v_caller text; v_rel relationships; v_grant grants; v_rid text; v_gid text;
begin
  v_caller := current_person();
  if v_caller is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if is_demo_guide() then raise exception 'DEMO_GUIDE_READ_ONLY' using errcode = '42501'; end if;

  select * into v_prop from villager_proposals where id = p_proposal for update;
  if not found then raise exception 'PROPOSAL_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_prop.proposer_id <> v_caller then raise exception 'UNAUTHORIZED' using errcode = '42501'; end if;

  -- TRUE idempotent replay: already confirmed — return the SAME relationship + grant, never a
  -- second write, no matter how many times (or how concurrently) this is called.
  if v_prop.confirmed_relationship_id is not null then
    select * into v_rel from relationships where id = v_prop.confirmed_relationship_id;
    select * into v_grant from grants where id = v_prop.confirmed_grant_id;
    return query select v_rel.id, v_rel.type, v_rel.status, v_grant.actor_id, v_grant.child_id,
                        v_grant.id, v_grant.scopes, v_grant.valid_from, v_grant.valid_until, v_grant.granted_by;
    return;
  end if;

  -- Re-checked here, not just at propose time: current parent authority AND household policy,
  -- live — never the proposal's own stale snapshot of who may confirm.
  if not _may_add_villager(v_prop.child_id, v_caller) then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;
  if v_prop.expires_at < now() then raise exception 'PROPOSAL_EXPIRED' using errcode = '22023'; end if;
  if v_prop.version <> p_version then raise exception 'PROPOSAL_STALE' using errcode = '40001'; end if;
  if not (v_prop.scopes <@ _add_villager_allowed_scopes()) then
    raise exception 'VILLAGER_SCOPE_NOT_ALLOWED' using errcode = '22023';
  end if;

  -- Relationship half: activate the existing row this proposal was built from, or — only if it
  -- somehow no longer exists — insert a fresh one. Never 'parent'/'guardian', ever.
  if lower(v_prop.relationship_type) in ('parent', 'guardian') then
    raise exception 'VILLAGER_RELATIONSHIP_TYPE_NOT_ALLOWED' using errcode = '22023';
  end if;

  if v_prop.relationship_id is not null then
    update relationships
       set status = 'ACTIVE',
           history = history || jsonb_build_array(jsonb_build_object(
             'at', current_date, 'event', 'ACTIVATED via Add a Villager (parent confirm)'))
     where id = v_prop.relationship_id
     returning * into v_rel;
  else
    v_rid := 'r_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);
    insert into relationships (id, from_id, to_id, type, status, created_at, history)
    values (v_rid, v_prop.person_id, v_prop.child_id, v_prop.relationship_type, 'ACTIVE', current_date,
            jsonb_build_array(jsonb_build_object('at', current_date, 'event', 'ACTIVE (Add a Villager)')))
    returning * into v_rel;
  end if;

  -- Grant half: one new grant row. Never updates or widens an existing grant for this actor —
  -- a second confirm for the same person/child (a genuinely new proposal) adds a second grant
  -- row rather than silently extending the first.
  v_gid := 'g_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);
  insert into grants (id, actor_id, child_id, scopes, valid_from, valid_until, granted_by)
  values (v_gid, v_prop.person_id, v_prop.child_id, v_prop.scopes, v_prop.valid_from, v_prop.valid_until, v_caller)
  returning * into v_grant;

  -- The audit row: access already owns `approvals` for grantAccess; this is the same write.
  insert into approvals (id, approver_id, subject_type, subject_id, decision, at)
  values ('ap_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12),
          v_caller, 'Grant', v_gid, 'GRANTED', current_date);

  update villager_proposals
     set confirmed_relationship_id = v_rel.id, confirmed_grant_id = v_gid, confirmed_at = now()
   where id = p_proposal;

  return query select v_rel.id, v_rel.type, v_rel.status, v_grant.actor_id, v_grant.child_id,
                      v_grant.id, v_grant.scopes, v_grant.valid_from, v_grant.valid_until,
                      v_grant.granted_by;
end $function$;

commit;
