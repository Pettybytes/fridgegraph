-- Forward-only calendar care records. Existing policies and parent confirmation are unchanged.
begin;
alter table public.parenting_schedules
  add column handoff_time time,
  add column handoff_location text;

-- PostgreSQL requires recreation to extend OUT columns. No CASCADE: unexpected dependencies
-- fail the migration rather than silently removing them. Existing three columns retain meaning.
drop function public.effective_schedule_for(text,date);
create function effective_schedule_for(p_child text, p_day date)
returns table (parent_id text, source text, arrangement_id text, handoff_time time, handoff_location text)
language sql stable security definer set search_path = public
as $$
  with approved as (
    select a.id, a.assigned_parent_id
      from holiday_arrangements a
     where a.child_id = p_child
       and a.status = 'APPROVED'
       and p_day between a.date_start and a.date_end      -- INCLUSIVE
     order by a.date_start, a.id                          -- deterministic; overlaps are reported
     limit 1
  )
  select coalesce(
           (select assigned_parent_id from approved),
           (select ps.parent_id from parenting_schedules ps
             where ps.child_id = p_child
               and upper(to_char(p_day, 'DY')) = any (ps.weekdays)
             order by ps.parent_id
             limit 1)
         ) as parent_id,
         case when exists (select 1 from approved) then 'ARRANGEMENT' else 'WEEKLY' end as source,
         (select id from approved) as arrangement_id,
         case when not exists (select 1 from approved) then
           (select ps.handoff_time from parenting_schedules ps where ps.child_id = p_child
             and upper(to_char(p_day, 'DY')) = any(ps.weekdays) order by ps.parent_id limit 1)
         end as handoff_time,
         case when not exists (select 1 from approved) then
           (select ps.handoff_location from parenting_schedules ps where ps.child_id = p_child
             and upper(to_char(p_day, 'DY')) = any(ps.weekdays) order by ps.parent_id limit 1)
         end as handoff_location
$$;

revoke all on function public.effective_schedule_for(text,date) from public, anon;
grant execute on function public.effective_schedule_for(text,date) to authenticated, service_role;

-- Add composite-key care rows to the existing owner-only atomic restore. All cleanup,
-- receipt/idempotency, audit and permission restrictions remain unchanged.
create or replace function public.restore_demo_snapshot(p_actor text, p_run_id uuid, p_fixtures jsonb, p_cast jsonb)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  sandbox_tables constant text[] := array['coordination_jobs','attempts','holidays','routines','adult_availability','holiday_arrangements','expected_checkins','care_facts','fridge_notes','goals'];
  id_tables constant text[] := array['households','people','children','household_members','household_policies','grants','relationships','shared_statuses','goals','candidate_evaluations','confirmations','voice_notes'];
  restore_order constant text[] := array['people','shared_statuses','households','children','household_members','goals','holidays','routines','adult_availability','holiday_arrangements','coordination_jobs','attempts','candidate_evaluations','confirmations','voice_notes','expected_checkins','care_facts','household_policies','events','parenting_schedules','fridge_notes','fridge_item_preferences'];
  t text; keys text[]; cols text; updates text; predicate text; conflict_cols text; target_cols text; excluded_cols text;
  rows jsonb; source jsonb; report jsonb; existing public.demo_reset_runs%rowtype;
  restored jsonb := '{}'; cleared jsonb := '{}'; counts jsonb; n int; decisions int;
  cleanup_before timestamptz := clock_timestamp();
  sandbox_present text[]; family_rows jsonb; orphan_rows jsonb;
  family_people text[]; family_households text[]; family_villages text[]; family_users text[];
begin
  if nullif(p_actor,'') is null then raise exception 'RESET_ACTOR_REQUIRED'; end if;
  -- Same cluster-wide serialization used by family creation and the previous reset.
  if not pg_try_advisory_xact_lock(918273645) then
    raise exception 'RESET_IN_FLIGHT' using errcode = '55P03';
  end if;
  select * into existing from public.demo_reset_runs where run_id = p_run_id;
  if found then
    if existing.actor <> p_actor then raise exception 'RESET_RUN_NOT_OWNED' using errcode = '42501'; end if;
    return existing.report;
  end if;
  if p_fixtures is null or p_cast is null or jsonb_typeof(p_fixtures) <> 'object' or jsonb_typeof(p_cast) <> 'object'
     or not (p_fixtures ?& array['coordination_jobs','people','households']) or not (p_cast ? 'people') then
    raise exception 'RESET_SNAPSHOT_REQUIRED';
  end if;

  -- One local catalog read per restore, not one remote information_schema call per table.
  select array_agg(c.relname::text) into sandbox_present
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid
    where ns.nspname = 'public' and c.relname = any(sandbox_tables)
      and a.attname = 'sandbox' and not a.attisdropped;
  foreach t in array sandbox_tables loop
    if t = any(sandbox_present) then
      execute format('delete from public.%I where sandbox is true',t);
      get diagnostics n = row_count;
      if n > 0 then cleared := cleared || jsonb_build_object(t,n); end if;
    end if;
  end loop;
  foreach t in array id_tables loop
    rows := coalesce(p_fixtures -> t,'[]');
    if jsonb_array_length(rows) = 0 then continue; end if;
    keys := case t when 'children' then array['person_id'] when 'shared_statuses' then array['person_id']
      when 'household_members' then array['person_id','household_id']
      when 'household_policies' then array['household_id','rule'] else array['id'] end;
    select string_agg(format('target.%1$I = fixture.%1$I',k),' and ') into predicate from unnest(keys) k;
    execute format('delete from public.%1$I target using jsonb_populate_recordset(null::public.%1$I,$1) fixture where %2$s',t,predicate) using rows;
    get diagnostics n = row_count;
    if n > 0 then cleared := cleared || jsonb_build_object(t,n); end if;
  end loop;

  -- Preserve the exact existing precedence: simulated/private fixture rows, then Cast v2.
  foreach source in array array[p_fixtures,p_cast] loop
    foreach t in array restore_order loop
      rows := coalesce(source -> t,'[]');
      if jsonb_array_length(rows) = 0 then continue; end if;
      keys := case t when 'children' then array['person_id'] when 'shared_statuses' then array['person_id']
        when 'parenting_schedules' then array['child_id','parent_id']
        when 'fridge_item_preferences' then array['child_id','kind','item_id']
        when 'care_facts' then array['child_id','key'] when 'household_members' then array['person_id','household_id']
        when 'household_policies' then array['household_id','rule'] else array['id'] end;
      select string_agg(format('%I',k),',' order by k),
             string_agg(format('%1$I = excluded.%1$I',k),',' order by k) filter(where not k = any(keys)),
             string_agg(format('restored_row.%I',k),',' order by k),string_agg(format('excluded.%I',k),',' order by k)
        into cols,updates,target_cols,excluded_cols from (select distinct jsonb_object_keys(value) k from jsonb_array_elements(rows)) fields;
      select string_agg(format('%I',k),',') into conflict_cols from unnest(keys) k;
      execute format('insert into public.%1$I as restored_row (%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I,$1) on conflict (%3$s) %4$s',
        t,cols,conflict_cols,case when updates is null then 'do nothing' else 'do update set '||updates||' where row('||target_cols||') is distinct from row('||excluded_cols||')' end) using rows;
      get diagnostics n = row_count;
      if n > 0 then restored := restored || jsonb_build_object(t,coalesce((restored->>t)::int,0)+n); end if;
    end loop;
  end loop;
  counts := public.reset_demo_places(p_actor);
  restored := restored || counts;

  -- Capture the same created-family registry and namespaced orphan ownership before removal.
  select coalesce(jsonb_agg(to_jsonb(f)),'[]') into family_rows from public.demo_families f;
  select coalesce(jsonb_agg(jsonb_build_object('auth_user_id',o.user_id::text,'person_id',o.person_id,
    'household_id',h.household_id,'child_ids',coalesce(k.ids,'[]'),'village_id',house.village_id)),'[]')
    into orphan_rows from public.identity_map o
    left join lateral (select m.household_id from public.household_members m where m.person_id=o.person_id limit 1) h on true
    left join public.households house on house.id=h.household_id
    left join lateral (select jsonb_agg(m.person_id) ids from public.household_members m where m.household_id=h.household_id and m.role='child') k on true
    where o.person_id like 'p_family_%' and not exists(select 1 from public.demo_families f where f.person_id=o.person_id);
  family_rows := family_rows || orphan_rows;
  select array_agg(distinct id) into family_people from (
    select value->>'person_id' id from jsonb_array_elements(family_rows)
    union select value->>'child_id' from jsonb_array_elements(family_rows)
    union select jsonb_array_elements_text(coalesce(value->'child_ids','[]')) from jsonb_array_elements(family_rows)
  ) ids where id is not null;
  select array_agg(value->>'household_id'),array_agg(value->>'village_id'),array_agg(value->>'auth_user_id')
    into family_households,family_villages,family_users from jsonb_array_elements(family_rows);
  delete from public.identity_map where user_id::text = any(family_users);
  delete from public.household_members where household_id = any(family_households) or person_id = any(family_people);
  delete from public.children where person_id = any(family_people);
  delete from public.households where id = any(family_households);
  delete from public.people where id = any(family_people);
  delete from public.villages where id = any(family_villages);
  delete from public.demo_families;

  decisions := public.reset_demo_decisions();
  counts := public.reset_demo_school_reports();
  cleared := cleared || counts;
  counts := public.reset_demo_villager_provenance();
  cleared := cleared || counts;
  -- The original privileged helper owns the append-only exception and audit. Never bypass it.
  counts := public.reset_demo_orbit(p_actor,jsonb_build_object('approvals',decisions,
    'createdFamiliesRemoved',jsonb_array_length(family_rows),'runId',p_run_id));
  cleared := cleared || counts;
  report := jsonb_build_object('restored',restored,'cleared',cleared,'demoDecisionsCleared',decisions,
    'createdFamiliesRemoved',jsonb_array_length(family_rows),'familyRows',family_rows,
    'cleanupBefore',extract(epoch from cleanup_before)*1000);
  -- Receipt and restore share this transaction. A trigger failure rolls back BOTH, including audit.
  insert into public.demo_reset_runs(run_id,actor,report) values(p_run_id,p_actor,report);
  return report;
end $$;
revoke all on function public.restore_demo_snapshot(text,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
comment on function public.restore_demo_snapshot(text,uuid,jsonb,jsonb) is
  'Owner-only atomic canonical demo restore, idempotent run receipt. Preserves existing scoped cleanup, audit and rollback guards.';


commit;
