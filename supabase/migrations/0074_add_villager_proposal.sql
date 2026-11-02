-- 0074 — Add a Villager: PROPOSE (stage, model-callable) / CONFIRM (commit, parent-only).
--
-- Same shape as the school-report and Orbit propose/confirm pairs (0032, 0071): a server-side row
-- holds the exact reviewed person/relationship/scopes/window, a version counter bumps on edit, and
-- a parent's own deliberate confirm is the only path that ever touches `relationships` or `grants`.
--
-- SECOND intentional cross-table write (see data-model.md §2 for the first — `approveRelationship`
-- writing `approvals`): `confirm_add_villager` writes both `relationships` (village-owned) and
-- `grants` (access-owned) in ONE transaction, inside a single SECURITY DEFINER function — not one
-- subgraph's app code reaching into the other's table. Recorded here and in data-model.md.
--
-- `propose_add_villager` resolves a NAME to a person the caller can already see: only someone who
-- already has SOME relationship row to this exact child (any status, including DISCOVERED) — the
-- same visibility the caller's own `relationships(childId)` query already grants. It never creates
-- a new person, and never searches outside this one child's existing relationships — there is no
-- village-wide directory here or anywhere else in this codebase. A genuinely new person is out of
-- scope (see the PR).
--
-- `confirm_add_villager` NEVER makes the villager a parent/guardian (role is never written, and the
-- relationship type is never one of 'parent'/'guardian'), and NEVER touches `household_members` —
-- the two families' households are never linked by this flow.
--
-- ERRCODE discipline (learned live from school-report's 0071, see evidence 65 and the fix in
-- src/subgraphs/school.ts's addVillagerError-equivalent): the TS layer maps these RPC failures by
-- SQLSTATE as a documented fallback behind message-substring matching, because a deployed
-- PostgREST's `message` field has no guaranteed-verbatim contract — `code` does. Every RAISE
-- EXCEPTION below gets an explicit ERRCODE for exactly that reason, chosen so the fallback map
-- stays small and each code's CLIENT-FACING meaning collapses only where that is actually fine:
-- UNAUTHENTICATED=28000; UNAUTHORIZED+DEMO_GUIDE_READ_ONLY=42501 (both "insufficient privilege",
-- collapsing is no-oracle-friendly); VILLAGER_NOT_FOUND+PROPOSAL_NOT_FOUND=P0002 (both "nothing
-- resolvable"); PROPOSAL_STALE=40001; VILLAGER_SCOPES_REQUIRED+VILLAGER_SCOPE_NOT_ALLOWED+
-- VILLAGER_NAME_AMBIGUOUS+VILLAGER_RELATIONSHIP_TYPE_NOT_ALLOWED+PROPOSAL_EXPIRED=22023 (all
-- "this proposal/input needs fixing or redoing" by SQLSTATE alone; message-matching, tried first,
-- still tells these apart whenever the deployment's message is reliable).

begin;

create table if not exists villager_proposals (
  id                text primary key,
  proposer_id       text not null references people(id),
  child_id          text not null references children(person_id) on delete cascade,
  person_id         text not null references people(id),
  relationship_id   text references relationships(id),
  relationship_type text not null,
  scopes            text[] not null,
  valid_from        date,
  valid_until       date,
  version           int not null default 1,
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null,
  confirmed_relationship_id text references relationships(id),
  confirmed_grant_id        text references grants(id),
  confirmed_at              timestamptz
);

alter table villager_proposals enable row level security;
alter table villager_proposals force row level security;

create policy villager_proposals_read on villager_proposals for select to authenticated
  using (proposer_id = current_person());

-- No INSERT/UPDATE grant to `authenticated` at all — every write goes through the two functions
-- below, same as school_report_proposals (0071) and orbit_alerts (0032).

-- Only scopes this flow may ever grant. Deliberately excludes pickup.verify, careplan.read,
-- contacts.read, goals.read and anything address-shaped — "schedule.read" must be named
-- explicitly by the caller, never implied, and nothing beyond this list is ever accepted,
-- regardless of what a model asks for.
create or replace function _add_villager_allowed_scopes()
returns text[] language sql immutable as $$
  select array['pickup.request', 'schedule.read']
$$;

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
  if is_demo_guide() then raise exception 'DEMO_GUIDE_READ_ONLY' using errcode = '42501'; end if;
  if not is_parent_of(p_child) then raise exception 'UNAUTHORIZED' using errcode = '42501'; end if;

  if p_scopes is null or array_length(p_scopes, 1) is null then
    raise exception 'VILLAGER_SCOPES_REQUIRED' using errcode = '22023';
  end if;
  if not (p_scopes <@ _add_villager_allowed_scopes()) then
    raise exception 'VILLAGER_SCOPE_NOT_ALLOWED' using errcode = '22023';
  end if;

  -- Resolution is bounded to people who already have SOME relationship row to THIS child — the
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
  -- bumps `version` — mirrors propose_school_report (0071) exactly.
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

revoke all on function propose_add_villager(text, text, text[], text, date, date, int) from public, anon;
grant execute on function propose_add_villager(text, text, text[], text, date, date, int) to authenticated;

-- Household authority, re-read live: 'caregiver_approval' names either ANY_PARENT (the documented
-- default — any parent/guardian of the child) or one specific person id, exactly like
-- consent_approval's mayApproveConsent (src/subgraphs/school.ts). More than one named approver
-- across the child's households is an ambiguous configuration and refuses everyone, on purpose.
create or replace function _may_add_villager(p_child text, p_caller text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_named text[];
begin
  select array_agg(distinct hp.value) into v_named
    from household_policies hp
    join household_members hm on hm.household_id = hp.household_id
   where hm.person_id = p_child and hm.role = 'child' and hp.rule = 'caregiver_approval'
     and hp.value <> 'ANY_PARENT' and hp.value <> '';
  if v_named is not null and array_length(v_named, 1) > 1 then return false; end if;
  if v_named is not null and array_length(v_named, 1) = 1 then return v_named[1] = p_caller; end if;
  return is_parent_of(p_child);
end $$;

create or replace function confirm_add_villager(p_proposal text, p_version int)
returns table (
  relationship_id text, relationship_type text, relationship_status text,
  person_id text, child_id text,
  grant_id text, scopes text[], valid_from date, valid_until date, granted_by text
)
language plpgsql
security definer
set search_path = public
as $$
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
                      v_grant.id, v_grant.scopes, v_grant.valid_from, v_grant.valid_until;
end $$;

revoke all on function confirm_add_villager(text, int) from public, anon;
grant execute on function confirm_add_villager(text, int) to authenticated;

commit;
