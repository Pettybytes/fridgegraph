-- 0025 — demo sandbox: trusted demo markers, refusal of real outreach from a demo session,
--        sandbox record markers, and the read-only Demo guide scope.
--
-- Group 2 / E2b + E2c. Forward-only. 0001-0024 are never edited.
--
-- TWO DIFFERENT FACTS, never conflated:
--
--   is_demo_caller()   the verified token says this session is a demo persona (app_metadata.demo).
--                      It is a property of the SESSION. Real outreach must never start from it.
--
--   sandbox            the record is fictional demo data. It is a property of the RECORD, and it is
--                      what the Demo guide may read. A sandbox job can still be the subject of the
--                      consented real-call exception (Session 3 ran on exactly such a job), so
--                      sandbox must NOT be used as a refusal condition.
--
-- REFUSAL IS RECORD-LEVEL AND CALLER-LEVEL, not UI-level:
--   * `coordination_jobs.demo_caller` is set once, at insert, from the verified session marker.
--     `attempts.demo_caller` inherits it. A service-role caller later has no JWT to inspect, so the
--     durable fact has to be on the row.
--   * A demo_caller attempt can never be rewritten to REAL_CONSENTED, can never receive a
--     RealCallAuthorization, can never consume one, and `assert_outreach_allowed` refuses it for the
--     dispatcher. The dial path therefore has nothing to dial, with or without the UI.
--   * Simulated work stays allowed: a demo session can create a sandbox job, receive
--     TEST_RESPONDER attempts, and approve as a parent. Removing that would delete the demo.
--
-- THE GUIDE: one identity, `p_demo_guide`, with `app_metadata.demo_guide = true` and no household
-- membership anywhere. It gets SELECT on sandbox rows through the policies below and no write path
-- at all (restrictive policies, §6). A non-guide token gains nothing: every added policy starts
-- with `is_demo_guide()`.
--
-- PRIVILEGED HELPERS: is_demo_caller/is_demo_guide read auth.jwt() and return a boolean; they never
-- read a table. is_sandbox_child/is_sandbox_person are SECURITY DEFINER existence checks (the same
-- shape as is_parent_of) so a policy can test membership without recursing into RLS. None of them
-- returns rows on a caller's behalf, and no service-role read is performed for a caller.
--
-- Rollback: commented at the bottom.

begin;

-- ---------------------------------------------------------------------------
-- 1. Trusted markers: verified token claims only
-- ---------------------------------------------------------------------------
create or replace function is_demo_caller() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'demo', 'false') = 'true'
$$;

create or replace function is_demo_guide() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'demo_guide', 'false') = 'true'
$$;

revoke all on function is_demo_caller() from public, anon;
revoke all on function is_demo_guide() from public, anon;
grant execute on function is_demo_caller() to authenticated, service_role;
grant execute on function is_demo_guide() to authenticated, service_role;

comment on function is_demo_caller() is
  'True only when the VERIFIED token carries app_metadata.demo = true. app_metadata is server-written; '
  'user_metadata, headers and browser flags are not consulted.';
comment on function is_demo_guide() is
  'True only when the VERIFIED token carries app_metadata.demo_guide = true (the Demo guide identity).';

-- ---------------------------------------------------------------------------
-- 2. Sandbox markers on records
-- ---------------------------------------------------------------------------
-- Every household in this project is fictional seed data, so the backfill is total. A future real
-- dataset sets sandbox = false on its own rows; nothing here infers sandbox from a token.
alter table households
  add column if not exists sandbox boolean not null default true;

update households set sandbox = true where sandbox is distinct from true;

alter table coordination_jobs
  add column if not exists sandbox      boolean not null default true,
  add column if not exists demo_caller  boolean not null default false;

update coordination_jobs set sandbox = true where sandbox is distinct from true;

alter table attempts
  add column if not exists sandbox     boolean not null default true,
  add column if not exists demo_caller boolean not null default false;

-- Every attempt that already exists belongs to a fictional job: its job's sandbox flag is the truth.
update attempts a
   set sandbox = j.sandbox,
       demo_caller = j.demo_caller
  from coordination_jobs j
 where j.id = a.job_id
   and (a.sandbox is distinct from j.sandbox or a.demo_caller is distinct from j.demo_caller);

comment on column households.sandbox is
  'Fictional demo record. The Demo guide may read sandbox rows (0025 §5) and nothing else.';
comment on column coordination_jobs.demo_caller is
  'Set once at insert from app_metadata.demo of the creating session. A demo_caller job can never '
  'reach real outreach (0025 §3/§4), including from a service-role caller that has no JWT.';
comment on column attempts.demo_caller is
  'Inherited from the job. The durable refusal fact for authorize/promote/consume/dispatch.';

-- ---------------------------------------------------------------------------
-- 3. Record the demo marker when a job is created
-- ---------------------------------------------------------------------------
create or replace function _mark_demo_caller_job() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- OR, never AND: a row cannot un-mark itself, and a demo session cannot create a real job.
  if is_demo_caller() then
    new.demo_caller := true;
  end if;
  return new;
end $$;

drop trigger if exists coordination_jobs_mark_demo_caller on coordination_jobs;
create trigger coordination_jobs_mark_demo_caller
  before insert on coordination_jobs
  for each row execute function _mark_demo_caller_job();

create or replace function _inherit_attempt_markers() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_sandbox boolean; v_demo boolean;
begin
  select j.sandbox, j.demo_caller into v_sandbox, v_demo
    from coordination_jobs j where j.id = new.job_id;

  new.sandbox := coalesce(v_sandbox, true);
  new.demo_caller := coalesce(v_demo, false) or is_demo_caller();

  -- Refusal at insert: a demo session can never open a real-consented attempt.
  if new.demo_caller and new.destination_mode = 'REAL_CONSENTED' then
    raise exception 'DEMO_OUTREACH_REFUSED';
  end if;
  return new;
end $$;

drop trigger if exists attempts_inherit_markers on attempts;
create trigger attempts_inherit_markers
  before insert on attempts
  for each row execute function _inherit_attempt_markers();

-- Refusal at update: a demo_caller attempt cannot become real-consented, before and after.
create or replace function _refuse_demo_promotion() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.demo_caller or old.demo_caller then
    if new.destination_mode = 'REAL_CONSENTED' and old.destination_mode is distinct from 'REAL_CONSENTED' then
      raise exception 'DEMO_OUTREACH_REFUSED';
    end if;
    if new.real_consent_consumed_at is distinct from old.real_consent_consumed_at then
      raise exception 'DEMO_OUTREACH_REFUSED';
    end if;
    if new.real_consent_authorization_id is distinct from old.real_consent_authorization_id then
      raise exception 'DEMO_OUTREACH_REFUSED';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists attempts_refuse_demo_promotion on attempts;
create trigger attempts_refuse_demo_promotion
  before update on attempts
  for each row execute function _refuse_demo_promotion();

-- ---------------------------------------------------------------------------
-- 4. Refusal at the real-call authorization mint
-- ---------------------------------------------------------------------------
create or replace function _refuse_demo_authorization() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_demo boolean; v_sandbox boolean;
begin
  if is_demo_caller() then
    raise exception 'DEMO_OUTREACH_REFUSED';
  end if;

  select a.demo_caller, a.sandbox into v_demo, v_sandbox
    from attempts a where a.id = new.attempt_id;

  if coalesce(v_demo, false) then
    raise exception 'DEMO_OUTREACH_REFUSED';
  end if;

  -- The exception path runs on a sandbox job on purpose; only demo_caller refuses.
  perform 1 from attempts a where a.id = new.attempt_id;
  return new;
end $$;

drop trigger if exists real_call_authorizations_refuse_demo on real_call_authorizations;
create trigger real_call_authorizations_refuse_demo
  before insert on real_call_authorizations
  for each row execute function _refuse_demo_authorization();

-- ---------------------------------------------------------------------------
-- 5. Refusal inside the functions that mint, promote and consume
-- ---------------------------------------------------------------------------
-- Bodies are the 0022/0023 versions verbatim plus the guard. Nothing else changes.
create or replace function promote_attempt_to_real_consented(p_attempt text, p_contact text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_job text; v_candidate text; v_mode text; v_closed timestamptz;
  v_rv int; v_status text; v_auth text; v_demo boolean;
begin
  if p_attempt is null or p_attempt = '' or p_contact is null or p_contact = '' then
    raise exception 'PROMOTE_ARGS_REQUIRED';
  end if;

  select a.job_id, a.candidate_id, a.destination_mode, a.closed_at, a.demo_caller,
         j.request_version, j.status
    into v_job, v_candidate, v_mode, v_closed, v_demo, v_rv, v_status
    from attempts a
    join coordination_jobs j on j.id = a.job_id
   where a.id = p_attempt
   for update of a;

  if v_job is null then raise exception 'ATTEMPT_NOT_FOUND'; end if;

  -- E2b: a demo session, or an attempt created by one, never reaches a real recipient.
  if is_demo_caller() or coalesce(v_demo, false) then
    raise exception 'DEMO_OUTREACH_REFUSED';
  end if;

  if v_closed is not null then raise exception 'ATTEMPT_CLOSED'; end if;
  if v_mode = 'REAL_CONSENTED' then raise exception 'ALREADY_REAL_CONSENTED'; end if;
  if v_mode is distinct from 'TEST_RESPONDER' then raise exception 'BAD_DESTINATION_MODE'; end if;
  if v_status <> 'discovering' then raise exception 'JOB_NOT_DISCOVERING'; end if;

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

create or replace function consume_real_call_authorization(p_attempt text, p_contact text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_job text; v_candidate text; v_mode text; v_rv int; v_n int; v_demo boolean;
begin
  if p_attempt is null or p_contact is null or p_contact = '' then
    raise exception 'CONSUME_ARGS_REQUIRED';
  end if;

  select a.job_id, a.candidate_id, a.destination_mode, a.demo_caller, j.request_version
    into v_job, v_candidate, v_mode, v_demo, v_rv
    from attempts a join coordination_jobs j on j.id = a.job_id
   where a.id = p_attempt
   for update;

  if v_job is null then raise exception 'ATTEMPT_NOT_FOUND'; end if;

  if is_demo_caller() or coalesce(v_demo, false) then
    raise exception 'DEMO_OUTREACH_REFUSED';
  end if;

  if v_mode is distinct from 'REAL_CONSENTED' then
    return false;
  end if;

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
    return false;
  end if;

  update attempts
     set real_consent_consumed_at = now()
   where id = p_attempt and real_consent_consumed_at is null;

  return true;
end $$;

revoke all on function consume_real_call_authorization(text, text) from public, anon, authenticated;
grant execute on function consume_real_call_authorization(text, text) to service_role;

-- The dispatcher's single pre-flight gate. Returns void or raises; it never returns a row.
create or replace function assert_outreach_allowed(p_attempt text)
returns void language plpgsql security definer set search_path = public as $$
declare v_demo boolean; v_mode text;
begin
  select a.demo_caller, a.destination_mode into v_demo, v_mode
    from attempts a where a.id = p_attempt;

  if not found then
    raise exception 'ATTEMPT_NOT_FOUND';
  end if;
  if is_demo_caller() or coalesce(v_demo, false) then
    raise exception 'DEMO_OUTREACH_REFUSED';
  end if;
  if v_mode = 'REAL_CONSENTED' then
    -- Real outreach additionally requires a consumable authorization. The dispatcher consumes it
    -- immediately before the POST; this gate only refuses the obviously-unusable attempt.
    raise exception 'REAL_CONSENTED_NEEDS_CONSUME';
  end if;
end $$;

revoke all on function assert_outreach_allowed(text) from public, anon, authenticated;
grant execute on function assert_outreach_allowed(text) to service_role;

comment on function assert_outreach_allowed(text) is
  'Pre-flight gate for anything outbound: refuses a demo_caller attempt. Called by ops/dispatcher.mjs '
  'before the webhook POST; service_role only, never a client RPC.';

-- ---------------------------------------------------------------------------
-- 6. Demo guide: read sandbox rows, write nothing
-- ---------------------------------------------------------------------------
-- Existence helpers, same shape as is_parent_of: a boolean, never rows.
create or replace function is_sandbox_child(p_child text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from household_members m
      join households h on h.id = m.household_id
     where m.person_id = p_child and m.role = 'child' and h.sandbox
  )
$$;

create or replace function is_sandbox_person(p_person text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from household_members m
      join households h on h.id = m.household_id
     where m.person_id = p_person and h.sandbox
  )
$$;

revoke all on function is_sandbox_child(text) from public, anon;
revoke all on function is_sandbox_person(text) from public, anon;
grant execute on function is_sandbox_child(text) to authenticated, service_role;
grant execute on function is_sandbox_person(text) to authenticated, service_role;

-- The guide identity itself. A person row is required because identity_map.person_id is a foreign
-- key; it is a label, not a family member, and it belongs to no household.
insert into people (id, display_name, birth_date)
values ('p_demo_guide', 'Demo Guide', '1990-01-01')
on conflict (id) do nothing;

-- ---- 6a. read policies: every one starts with is_demo_guide() ----
drop policy if exists demo_guide_households on households;
create policy demo_guide_households on households for select to authenticated
  using (is_demo_guide() and sandbox);

drop policy if exists demo_guide_household_members on household_members;
create policy demo_guide_household_members on household_members for select to authenticated
  using (
    is_demo_guide()
    and exists (select 1 from households h where h.id = household_members.household_id and h.sandbox)
  );

drop policy if exists demo_guide_children on children;
create policy demo_guide_children on children for select to authenticated
  using (is_demo_guide() and is_sandbox_child(children.person_id));

drop policy if exists demo_guide_household_policies on household_policies;
create policy demo_guide_household_policies on household_policies for select to authenticated
  using (
    is_demo_guide()
    and exists (select 1 from households h where h.id = household_policies.household_id and h.sandbox)
  );

drop policy if exists demo_guide_grants on grants;
create policy demo_guide_grants on grants for select to authenticated
  using (is_demo_guide() and is_sandbox_child(grants.child_id));

drop policy if exists demo_guide_approvals on approvals;
create policy demo_guide_approvals on approvals for select to authenticated
  using (
    is_demo_guide()
    and exists (
      select 1 from grants g where g.id = approvals.subject_id and is_sandbox_child(g.child_id)
    )
  );

drop policy if exists demo_guide_parenting_schedules on parenting_schedules;
create policy demo_guide_parenting_schedules on parenting_schedules for select to authenticated
  using (is_demo_guide() and is_sandbox_child(parenting_schedules.child_id));

drop policy if exists demo_guide_events on events;
create policy demo_guide_events on events for select to authenticated
  using (is_demo_guide() and is_sandbox_child(events.child_id));

drop policy if exists demo_guide_village_event on village_event;
create policy demo_guide_village_event on village_event for select to authenticated
  using (is_demo_guide() and is_sandbox_child(village_event.subject_id::text));

drop policy if exists demo_guide_care_plans on care_plans;
create policy demo_guide_care_plans on care_plans for select to authenticated
  using (is_demo_guide() and is_sandbox_child(care_plans.child_id));

drop policy if exists demo_guide_goals on goals;
create policy demo_guide_goals on goals for select to authenticated
  using (is_demo_guide() and is_sandbox_child(goals.child_id));

drop policy if exists demo_guide_school_reports on school_reports;
create policy demo_guide_school_reports on school_reports for select to authenticated
  using (is_demo_guide() and is_sandbox_child(school_reports.child_id));

drop policy if exists demo_guide_permission_slips on permission_slips;
create policy demo_guide_permission_slips on permission_slips for select to authenticated
  using (is_demo_guide() and is_sandbox_child(permission_slips.child_id));

drop policy if exists demo_guide_bus_rosters on bus_rosters;
create policy demo_guide_bus_rosters on bus_rosters for select to authenticated
  using (is_demo_guide() and is_sandbox_child(bus_rosters.child_id));

drop policy if exists demo_guide_locations on locations;
create policy demo_guide_locations on locations for select to authenticated
  using (
    is_demo_guide()
    and (
      (owner_type = 'CHILD'  and is_sandbox_child(owner_id))
      or (owner_type = 'PERSON' and is_sandbox_person(owner_id))
    )
  );

drop policy if exists demo_guide_relationships on relationships;
create policy demo_guide_relationships on relationships for select to authenticated
  using (is_demo_guide() and is_sandbox_person(relationships.to_id));

drop policy if exists demo_guide_vehicles on vehicles;
create policy demo_guide_vehicles on vehicles for select to authenticated
  using (is_demo_guide() and is_sandbox_person(vehicles.owner_id));

drop policy if exists demo_guide_contact_methods on contact_methods;
create policy demo_guide_contact_methods on contact_methods for select to authenticated
  using (is_demo_guide() and is_sandbox_person(contact_methods.person_id));

drop policy if exists demo_guide_practices on practices;
create policy demo_guide_practices on practices for select to authenticated
  using (
    is_demo_guide()
    and exists (
      select 1 from memberships m
       where m.group_id = practices.group_id and is_sandbox_person(m.person_id)
    )
  );

drop policy if exists demo_guide_coordination_jobs on coordination_jobs;
create policy demo_guide_coordination_jobs on coordination_jobs for select to authenticated
  using (is_demo_guide() and sandbox);

drop policy if exists demo_guide_attempts on attempts;
create policy demo_guide_attempts on attempts for select to authenticated
  using (
    is_demo_guide()
    and exists (select 1 from coordination_jobs j where j.id = attempts.job_id and j.sandbox)
  );

drop policy if exists demo_guide_candidate_evaluations on candidate_evaluations;
create policy demo_guide_candidate_evaluations on candidate_evaluations for select to authenticated
  using (
    is_demo_guide()
    and exists (select 1 from coordination_jobs j where j.id = candidate_evaluations.job_id and j.sandbox)
  );

drop policy if exists demo_guide_confirmations on confirmations;
create policy demo_guide_confirmations on confirmations for select to authenticated
  using (
    is_demo_guide()
    and exists (select 1 from coordination_jobs j where j.id = confirmations.job_id and j.sandbox)
  );

drop policy if exists demo_guide_information_requests on information_requests;
create policy demo_guide_information_requests on information_requests for select to authenticated
  using (
    is_demo_guide()
    and exists (select 1 from coordination_jobs j where j.id = information_requests.job_id and j.sandbox)
  );

drop policy if exists demo_guide_conversation_state on conversation_state;
create policy demo_guide_conversation_state on conversation_state for select to authenticated
  using (is_demo_guide() and is_sandbox_child(conversation_state.child_id));

-- ---- 6b. no write path for the guide, on every table, in one place ----
-- RESTRICTIVE policies AND with every permissive policy, so a table that gains a new permissive
-- write policy later still refuses the guide. Separate per command: a restrictive SELECT would
-- block the reads above.
do $$
declare
  t text;
  tables text[] := array[
    'approvals','attempts','bus_rosters','candidate_evaluations','capabilities','care_plans',
    'children','confirmations','contact_methods','conversation_state','coordination_jobs','events',
    'goals','grants','groups','household_members','household_policies','households',
    'information_requests','locations','memberships','parenting_schedules','people',
    'permission_slips','practices','relationships','school_reports','vehicles','village_event',
    'villages','real_call_authorizations','webhook_events'
  ];
begin
  foreach t in array tables loop
    execute format('drop policy if exists %I on %I', t || '_guide_no_insert', t);
    execute format('drop policy if exists %I on %I', t || '_guide_no_update', t);
    execute format('drop policy if exists %I on %I', t || '_guide_no_delete', t);

    execute format(
      'create policy %I on %I as restrictive for insert to authenticated with check (not is_demo_guide())',
      t || '_guide_no_insert', t);
    execute format(
      'create policy %I on %I as restrictive for update to authenticated using (not is_demo_guide()) with check (not is_demo_guide())',
      t || '_guide_no_update', t);
    execute format(
      'create policy %I on %I as restrictive for delete to authenticated using (not is_demo_guide())',
      t || '_guide_no_delete', t);
  end loop;
end $$;

commit;

-- ROLLBACK (not applied):
--   drop trigger if exists coordination_jobs_mark_demo_caller on coordination_jobs;
--   drop trigger if exists attempts_inherit_markers on attempts;
--   drop trigger if exists attempts_refuse_demo_promotion on attempts;
--   drop trigger if exists real_call_authorizations_refuse_demo on real_call_authorizations;
--   drop function if exists _mark_demo_caller_job(), _inherit_attempt_markers(),
--     _refuse_demo_promotion(), _refuse_demo_authorization();
--   restore promote_attempt_to_real_consented / consume_real_call_authorization from 0023/0022;
--   drop function if exists assert_outreach_allowed(text);
--   drop the demo_guide_* policies and the *_guide_no_* restrictive policies (loop above);
--   alter table households drop column if exists sandbox;
--   alter table coordination_jobs drop column if exists sandbox, drop column if exists demo_caller;
--   alter table attempts drop column if exists sandbox, drop column if exists demo_caller;
--   delete from people where id = 'p_demo_guide';
--   drop function if exists is_demo_caller(), is_demo_guide(),
--     is_sandbox_child(text), is_sandbox_person(text);
