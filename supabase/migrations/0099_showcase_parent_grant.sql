-- Explicit, revocable parent-level capability for the fictional Ellison showcase.
-- The guide remains its own actor. No family membership or caller identity is rewritten.
begin;
create table public.showcase_parent_grants (
 child_id text primary key references public.children(person_id),
 enabled boolean not null default true
);
alter table public.showcase_parent_grants enable row level security;
revoke all on public.showcase_parent_grants from public,anon,authenticated,service_role;
insert into public.showcase_parent_grants(child_id) values ('p_nora'),('p_max'),('p_leo');
create function public.guide_can_manage_child(p_child text) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select public.is_demo_guide() and public.is_demo_caller() and exists (
  select 1 from public.showcase_parent_grants g
  join public.household_members m on m.person_id=g.child_id and m.role='child'
  join public.households h on h.id=m.household_id
  where g.child_id=p_child and g.enabled and h.sandbox and h.id in ('h_a','h_b')
 )
$$;
revoke all on function public.guide_can_manage_child(text) from public,anon;
grant execute on function public.guide_can_manage_child(text) to authenticated,service_role;
-- This existing predicate represents parent action authority at every RPC/RLS boundary.
-- Real parent/guardian rules remain byte-for-byte equivalent in the membership arm.
create or replace function public.is_parent_of(child text) returns boolean
language sql stable security definer set search_path=public as $$
 select public.guide_can_manage_child(child) or exists (
  select 1 from household_members child_m
  join household_members caller_m on caller_m.household_id=child_m.household_id
  where child_m.person_id=child and child_m.role='child'
   and caller_m.person_id=current_person() and caller_m.role in ('parent','guardian')
 )
$$;
-- Direct table writes remain constrained on both old and new rows. All other
-- tables retain their guide-no-write policy. Definer RPCs still check parent authority.
do $$
declare t text; rule text;
begin
 foreach t in array array['goals','grants','care_plans','events','school_reports','permission_slips','coordination_jobs','conversation_state'] loop
  rule:=format('not public.is_demo_guide() or public.guide_can_manage_child(child_id)%s',case when t in ('goals','coordination_jobs') then ' and sandbox' else '' end);
  execute format('alter policy %I on public.%I with check (%s)',t||'_guide_no_insert',t,rule);
  execute format('alter policy %I on public.%I using (%s) with check (%s)',t||'_guide_no_update',t,rule,rule);
  execute format('alter policy %I on public.%I using (%s)',t||'_guide_no_delete',t,rule);
 end loop;
end $$;
-- Fridge rows did not exist when the blanket guide restrictions were introduced.
create policy fridge_notes_showcase_insert on public.fridge_notes as restrictive for insert to authenticated
 with check (not public.is_demo_guide() or (public.guide_can_manage_child(child_id) and sandbox));
create policy fridge_notes_showcase_update on public.fridge_notes as restrictive for update to authenticated
 using (not public.is_demo_guide() or (public.guide_can_manage_child(child_id) and sandbox))
 with check (not public.is_demo_guide() or (public.guide_can_manage_child(child_id) and sandbox));
create policy fridge_notes_showcase_delete on public.fridge_notes as restrictive for delete to authenticated
 using (not public.is_demo_guide() or (public.guide_can_manage_child(child_id) and sandbox));
create policy fridge_notes_showcase_read on public.fridge_notes as restrictive for select to authenticated
 using (not public.is_demo_guide() or sandbox);

create or replace function propose_school_report(
  p_child text, p_kind text, p_text text, p_ttl_seconds int default 900
) returns school_report_proposals
language plpgsql
security definer
set search_path = public
as $$
declare v_caller text; v_row school_report_proposals;
begin
  v_caller := current_person();
  if v_caller is null then raise exception 'UNAUTHENTICATED'; end if;
  if not has_scope(p_child, 'school.report') then raise exception 'UNAUTHORIZED' using errcode = '42501'; end if;
  if p_kind is null or length(trim(p_kind)) = 0 then raise exception 'SCHOOL_REPORT_KIND_REQUIRED' using errcode = '22023'; end if;
  if p_text is null or length(trim(p_text)) = 0 then raise exception 'SCHOOL_REPORT_TEXT_REQUIRED' using errcode = '22023'; end if;

  -- Re-proposing for the SAME (actor, child) replaces the prior unconfirmed draft and bumps
  -- `version`  -  mirrors draft_orbit_share (0032) exactly, so a client holding an old version
  -- number becomes stale, not silently still valid, the moment the content changes.
  select * into v_row from school_report_proposals
   where actor_id = v_caller and child_id = p_child and confirmed_report_id is null
   order by created_at desc limit 1;

  if found then
    update school_report_proposals
       set kind = p_kind, text = p_text, version = version + 1,
           expires_at = now() + make_interval(secs => greatest(p_ttl_seconds, 60))
     where id = v_row.id
     returning * into v_row;
  else
    insert into school_report_proposals (id, actor_id, child_id, kind, text, expires_at)
    values ('srp_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12),
            v_caller, p_child, p_kind, p_text, now() + make_interval(secs => greatest(p_ttl_seconds, 60)))
    returning * into v_row;
  end if;
  return v_row;
end $$;

create or replace function confirm_school_report(p_proposal text, p_version int)
returns school_reports
language plpgsql
security definer
set search_path = public
as $$
declare v_prop school_report_proposals; v_report school_reports; v_id text; v_caller text;
begin
  v_caller := current_person();
  if v_caller is null then raise exception 'UNAUTHENTICATED'; end if;

  -- The row lock serializes concurrent confirms of the SAME proposal: whichever call gets here
  -- first proceeds to the insert below; any other call blocks until that commits, then re-reads
  -- `confirmed_report_id` already set and takes the idempotent-replay branch. Two concurrent
  -- confirms of the same proposal can therefore never create two rows.
  select * into v_prop from school_report_proposals where id = p_proposal for update;
  if not found then raise exception 'PROPOSAL_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_prop.actor_id <> v_caller then raise exception 'UNAUTHORIZED' using errcode = '42501'; end if;

  -- TRUE idempotent replay: already confirmed, by ANY earlier call (sequential retry or the loser
  -- of a concurrent race)  -  return the SAME report, never a second insert.
  if v_prop.confirmed_report_id is not null then
    select * into v_report from school_reports where id = v_prop.confirmed_report_id;
    return v_report;
  end if;

  -- Re-checked here, not just at propose time: authority is the live grant, not a snapshot.
  if not has_scope(v_prop.child_id, 'school.report') then raise exception 'UNAUTHORIZED' using errcode = '42501'; end if;
  if v_prop.expires_at < now() then raise exception 'PROPOSAL_EXPIRED' using errcode = '22023'; end if;
  if v_prop.version <> p_version then raise exception 'PROPOSAL_STALE' using errcode = '40001'; end if;

  v_id := 'sr_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);
  insert into school_reports (id, child_id, kind, text, at)
  values (v_id, v_prop.child_id, v_prop.kind, v_prop.text, local_today())
  returning * into v_report;

  update school_report_proposals set confirmed_report_id = v_id, confirmed_at = now()
   where id = p_proposal;

  return v_report;
end $$;

create or replace function propose_add_villager(
  p_child text, p_person_name text, p_scopes text[],
  p_relationship_type text default 'family_friend',
  p_valid_from date default null, p_valid_until date default null,
  p_ttl_seconds int default 900
) returns villager_proposals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller text; v_person_id text; v_match_count int; v_rel_id text; v_rel_type text;
  v_row villager_proposals;
begin
  v_caller := current_person();
  if v_caller is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if not is_parent_of(p_child) then raise exception 'UNAUTHORIZED' using errcode = '42501'; end if;

  if p_scopes is null or array_length(p_scopes, 1) is null then
    raise exception 'VILLAGER_SCOPES_REQUIRED' using errcode = '22023';
  end if;
  if not (p_scopes <@ _add_villager_allowed_scopes()) then
    raise exception 'VILLAGER_SCOPE_NOT_ALLOWED' using errcode = '22023';
  end if;

  -- Resolution is bounded to people who already have SOME relationship row to THIS child  -  the
  -- exact set the caller's own relationships(childId) query already shows them. No wider search.
  select r.from_id, r.id, r.type, count(*) over ()
    into v_person_id, v_rel_id, v_rel_type, v_match_count
    from relationships r
    join people p on p.id = r.from_id
   where r.to_id = p_child and lower(p.display_name) = lower(trim(p_person_name));

  if v_match_count is null or v_match_count = 0 then
    raise exception 'VILLAGER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_match_count > 1 then
    raise exception 'VILLAGER_NAME_AMBIGUOUS' using errcode = '22023';
  end if;

  -- Re-proposing for the SAME (proposer, child, person) replaces the prior unconfirmed draft and
  -- bumps `version`  -  mirrors propose_school_report (0071) exactly.
  select * into v_row from villager_proposals
   where proposer_id = v_caller and child_id = p_child and person_id = v_person_id
     and confirmed_relationship_id is null
   order by created_at desc limit 1;

  if found then
    update villager_proposals
       set relationship_id = v_rel_id, relationship_type = v_rel_type,
           scopes = p_scopes, valid_from = p_valid_from, valid_until = p_valid_until,
           version = version + 1, expires_at = now() + make_interval(secs => greatest(p_ttl_seconds, 60))
     where id = v_row.id
     returning * into v_row;
  else
    insert into villager_proposals
      (id, proposer_id, child_id, person_id, relationship_id, relationship_type, scopes, valid_from, valid_until, expires_at)
    values ('vp_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12),
            v_caller, p_child, v_person_id, v_rel_id, v_rel_type, p_scopes, p_valid_from, p_valid_until,
            now() + make_interval(secs => greatest(p_ttl_seconds, 60)))
    returning * into v_row;
  end if;
  return v_row;
end $$;

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

  select * into v_prop from villager_proposals where id = p_proposal for update;
  if not found then raise exception 'PROPOSAL_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_prop.proposer_id <> v_caller then raise exception 'UNAUTHORIZED' using errcode = '42501'; end if;

  -- TRUE idempotent replay: already confirmed  -  return the SAME relationship + grant, never a
  -- second write, no matter how many times (or how concurrently) this is called.
  if v_prop.confirmed_relationship_id is not null then
    select * into v_rel from relationships where id = v_prop.confirmed_relationship_id;
    select * into v_grant from grants where id = v_prop.confirmed_grant_id;
    return query select v_rel.id, v_rel.type, v_rel.status, v_grant.actor_id, v_grant.child_id,
                        v_grant.id, v_grant.scopes, v_grant.valid_from, v_grant.valid_until, v_grant.granted_by;
    return;
  end if;

  -- Re-checked here, not just at propose time: current parent authority AND household policy,
  -- live  -  never the proposal's own stale snapshot of who may confirm.
  if not _may_add_villager(v_prop.child_id, v_caller) then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;
  if v_prop.expires_at < now() then raise exception 'PROPOSAL_EXPIRED' using errcode = '22023'; end if;
  if v_prop.version <> p_version then raise exception 'PROPOSAL_STALE' using errcode = '40001'; end if;
  if not (v_prop.scopes <@ _add_villager_allowed_scopes()) then
    raise exception 'VILLAGER_SCOPE_NOT_ALLOWED' using errcode = '22023';
  end if;

  -- Relationship half: activate the existing row this proposal was built from, or  -  only if it
  -- somehow no longer exists  -  insert a fresh one. Never 'parent'/'guardian', ever.
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

  -- Grant half: one new grant row. Never updates or widens an existing grant for this actor  - 
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

grant insert,update on public.care_plans to authenticated;
create policy care_plans_parent_write on public.care_plans for all to authenticated
 using (public.is_parent_of(child_id)) with check (public.is_parent_of(child_id));

-- A durable cap includes writes made inside security-definer RPCs. Rollback also
-- rolls back the counter; only committed work consumes the per-minute allowance.
create table public.showcase_write_windows (
 actor text not null, window_start timestamptz not null, writes integer not null,
 primary key(actor,window_start)
);
alter table public.showcase_write_windows enable row level security;
revoke all on public.showcase_write_windows from public,anon,authenticated,service_role;
create function public.guard_showcase_write() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r jsonb; c text; n int;
begin
 if not public.is_demo_guide() then
  if tg_op='DELETE' then return old; else return new; end if;
 end if;
 -- Check both sides of an update, including child reassignment and sandbox provenance.
 foreach r in array case when tg_op='UPDATE' then array[to_jsonb(old),to_jsonb(new)]
  when tg_op='DELETE' then array[to_jsonb(old)] else array[to_jsonb(new)] end loop
  c:=r->>'child_id';
  if c is null or not public.guide_can_manage_child(c) or r->>'sandbox'='false' then
   raise exception 'SHOWCASE_WRITE_REFUSED' using errcode='42501';
  end if;
 end loop;
 insert into public.showcase_write_windows(actor,window_start,writes)
 values(public.current_person(),date_trunc('minute',clock_timestamp()),1)
 on conflict(actor,window_start) do update set writes=showcase_write_windows.writes+1
 returning writes into n;
 if n>120 then raise exception 'SHOWCASE_RATE_LIMITED' using errcode='P0001'; end if;
 if tg_op='DELETE' then return old; else return new; end if;
end $$;
revoke all on function public.guard_showcase_write() from public,anon,authenticated,service_role;
do $$
declare t text;
begin
 foreach t in array array['goals','care_plans','events','school_reports','permission_slips',
  'coordination_jobs','conversation_state','fridge_notes','fridge_item_preferences',
  'school_report_proposals','villager_proposals','orbit_alerts','grants'] loop
  execute format('create trigger showcase_write_guard before insert or update or delete on public.%I for each row execute function public.guard_showcase_write()',t);
 end loop;
end $$;
commit;
