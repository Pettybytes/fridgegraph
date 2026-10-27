-- 0003 — Row Level Security.
-- Every table is RLS-enabled AND forced. Deny-by-default: a table with no policy returns nothing.
-- Policies answer "who is calling?" from auth.uid() -> identity_map -> person_id. No headers.

-- ---------------------------------------------------------------- helpers
create or replace function current_person() returns text
language sql stable security definer set search_path = public as $$
  select person_id from identity_map where user_id = auth.uid()
$$;

create or replace function is_parent_of(child text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from household_members child_m
    join household_members caller_m on caller_m.household_id = child_m.household_id
    where child_m.person_id = child and child_m.role = 'child'
      and caller_m.person_id = current_person() and caller_m.role = 'parent'
  )
$$;

create or replace function has_scope(child text, scope text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from grants g
    where g.actor_id = current_person()
      and g.child_id = child
      and scope = any(g.scopes)
      and (g.valid_from  is null or current_date >= g.valid_from)
      and (g.valid_until is null or current_date <= g.valid_until)
  )
$$;

-- ---------------------------------------------------------------- enable + force
do $$
declare t text;
begin
  foreach t in array array[
    'people','children','villages','households','household_members','relationships','contact_methods',
    'capabilities','groups','memberships','goals','care_plans','grants','approvals','household_policies',
    'parenting_schedules','events','school_reports','permission_slips','bus_rosters','vehicles','practices',
    'coordination_jobs','attempts','information_requests','confirmations','conversation_state','identity_map'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- identity (basics)
create policy people_read on people for select to authenticated
  using (current_person() is not null);
create policy children_read on children for select to authenticated
  using (current_person() is not null);
create policy villages_read on villages for select to authenticated
  using (current_person() is not null);
create policy households_read on households for select to authenticated
  using (current_person() is not null);
create policy groups_read on groups for select to authenticated
  using (current_person() is not null);
create policy capabilities_read on capabilities for select to authenticated
  using (current_person() is not null);
create policy memberships_read on memberships for select to authenticated
  using (current_person() is not null);

create policy household_members_read on household_members for select to authenticated
  using (
    person_id = current_person()
    or household_id in (select household_id from household_members where person_id = current_person())
  );

-- parents see the relationship list for their child; nobody else does
create policy relationships_read on relationships for select to authenticated
  using (is_parent_of(to_id));

create policy relationships_parent_update on relationships for update to authenticated
  using (is_parent_of(to_id)) with check (is_parent_of(to_id));

-- own contacts always; someone else's only if they are an active relation of my child
create policy contact_methods_read on contact_methods for select to authenticated
  using (
    person_id = current_person()
    or exists (
      select 1 from relationships r
      where r.from_id = contact_methods.person_id and r.status = 'ACTIVE' and is_parent_of(r.to_id)
    )
  );

-- approved goals only for grant holders; parents see everything
create policy goals_read on goals for select to authenticated
  using (is_parent_of(child_id) or (has_scope(child_id, 'goals.read') and status = 'APPROVED'));

create policy goals_parent_write on goals for all to authenticated
  using (is_parent_of(child_id)) with check (is_parent_of(child_id));

create policy care_plans_read on care_plans for select to authenticated
  using (is_parent_of(child_id) or has_scope(child_id, 'careplan.read'));

-- ---------------------------------------------------------------- access
create policy grants_read on grants for select to authenticated
  using (actor_id = current_person() or is_parent_of(child_id));

create policy grants_parent_write on grants for all to authenticated
  using (is_parent_of(child_id)) with check (is_parent_of(child_id));

create policy approvals_read on approvals for select to authenticated
  using (
    approver_id = current_person()
    or exists (select 1 from grants g where g.id = approvals.subject_id and is_parent_of(g.child_id))
    or exists (select 1 from relationships r where r.id = approvals.subject_id and is_parent_of(r.to_id))
  );

create policy approvals_insert on approvals for insert to authenticated
  with check (approver_id = current_person());

create policy household_policies_read on household_policies for select to authenticated
  using (
    exists (
      select 1 from household_members m
      where m.household_id = household_policies.household_id and m.role = 'child' and is_parent_of(m.person_id)
    )
    or exists (
      select 1 from household_members m
      where m.household_id = household_policies.household_id and m.person_id = current_person()
    )
  );

create policy parenting_schedules_read on parenting_schedules for select to authenticated
  using (is_parent_of(child_id) or has_scope(child_id, 'schedule.read'));

-- ---------------------------------------------------------------- schedule / school / transport / activities
create policy events_read on events for select to authenticated
  using (is_parent_of(child_id) or has_scope(child_id, 'schedule.read'));

create policy school_reports_read on school_reports for select to authenticated
  using (is_parent_of(child_id) or has_scope(child_id, 'school.read'));

create policy permission_slips_read on permission_slips for select to authenticated
  using (is_parent_of(child_id) or has_scope(child_id, 'school.read'));

create policy bus_rosters_read on bus_rosters for select to authenticated
  using (is_parent_of(child_id) or has_scope(child_id, 'transport.read'));

-- own vehicle, or the vehicle of someone cleared to collect my child
create policy vehicles_read on vehicles for select to authenticated
  using (
    owner_id = current_person()
    or exists (
      select 1
      from relationships r
      join capabilities c on c.person_id = r.from_id and c.name = 'transport.child'
      where r.from_id = vehicles.owner_id and r.status = 'ACTIVE' and has_scope(r.to_id, 'pickup.verify')
    )
  );

create policy practices_read on practices for select to authenticated
  using (
    exists (
      select 1 from memberships m
      where m.group_id = practices.group_id and m.role = 'player'
        and (is_parent_of(m.person_id) or has_scope(m.person_id, 'schedule.read'))
    )
  );

-- ---------------------------------------------------------------- coordination / conversation (empty)
create policy coordination_jobs_read on coordination_jobs for select to authenticated
  using (is_parent_of(child_id));

create policy attempts_read on attempts for select to authenticated
  using (exists (select 1 from coordination_jobs j where j.id = attempts.job_id and is_parent_of(j.child_id)));

create policy info_requests_read on information_requests for select to authenticated
  using (exists (select 1 from coordination_jobs j where j.id = information_requests.job_id and is_parent_of(j.child_id)));

create policy confirmations_read on confirmations for select to authenticated
  using (exists (select 1 from coordination_jobs j where j.id = confirmations.job_id and is_parent_of(j.child_id)));

create policy conversation_state_read on conversation_state for select to authenticated
  using (person_id = current_person() or is_parent_of(child_id));

-- identity_map: no policy at all -> nobody but the service role can read it
