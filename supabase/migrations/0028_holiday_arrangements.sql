-- 0028 — Group 3 correction: a SCHOOL CLOSURE is not a HOLIDAY ARRANGEMENT.
--
-- The two facts 0027 conflated:
--   * a school closure (`holidays`)      — the calendar is closed; it suppresses SCHOOL-DAY routines
--                                          and nothing else. It says NOTHING about who has the child.
--   * a HolidayArrangement               — an agreed, bounded change of parenting time. Only an
--                                          APPROVED one overrides the weekly schedule, and only inside
--                                          its own inclusive interval.
--
-- Consequently 0027's "no routine at all on a holiday" was too strong: bedtime does not stop because
-- school is closed. Routines now declare applicability (`SCHOOL_DAY` vs `ANY_DAY`).
--
-- Forward-only: 0027 is already applied and is never edited.

begin;

-- ---------------------------------------------------------------- 1. routines carry applicability
alter table routines add column if not exists applies_on text not null default 'ANY_DAY';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'routines_applies_on_check') then
    alter table routines add constraint routines_applies_on_check
      check (applies_on in ('SCHOOL_DAY','ANY_DAY')) not valid;
  end if;
end $$;

-- A closure is a SCHOOL_CLOSURE, not a generic holiday, and it only removes school-day routines.
create or replace function day_kind(child text, on_day date)
returns text
language sql stable security definer set search_path = public
as $$
  select case
    when holiday_covers(child, on_day) then 'SCHOOL_CLOSURE'
    when extract(isodow from on_day) between 1 and 5 then 'SCHOOL_DAY'
    else 'WEEKEND'
  end
$$;

create or replace function day_routines(child text, on_day date)
returns table (id text, title text, start_time time, end_time time, location text)
language sql stable security definer set search_path = public
as $$
  select r.id, r.title, r.start_time, r.end_time, r.location
    from routines r
   where r.child_id = child
     and to_char(on_day, 'DY') = any (r.weekdays)
     and not (r.applies_on = 'SCHOOL_DAY' and day_kind(child, on_day) = 'SCHOOL_CLOSURE')
   order by r.start_time
$$;

-- ---------------------------------------------------------------- 2. the arrangement
create table if not exists holiday_arrangements (
  id                     text primary key,
  child_id               text not null references children(person_id) on delete cascade,
  holiday_name           text,                       -- null for a one-off swap (Scenario 3)
  date_start             date not null,
  date_end               date not null,
  assigned_parent_id     text not null references people(id),
  pickup_duty_parent_id  text references people(id),
  dropoff_duty_parent_id text references people(id),
  status                 text not null default 'PROPOSED'
                         check (status in ('PROPOSED','APPROVED','DECLINED')),
  proposed_by_id         text not null references people(id),
  approval_id            text references approvals(id),
  sandbox                boolean not null default true,
  constraint holiday_arrangements_range check (date_end >= date_start)
);

-- ---------------------------------------------------------------- 3. precedence
create or replace function effective_schedule_for(p_child text, p_day date)
returns table (parent_id text, source text, arrangement_id text)
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
         (select id from approved) as arrangement_id
$$;

-- pickup's approver rule now follows the effective schedule, so behaviour is unchanged wherever no
-- arrangement exists and follows the approved arrangement where one does.
create or replace function _is_approver_for(p_child text, p_as_of date)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from effective_schedule_for(p_child, p_as_of) e
     where e.parent_id = current_person()
  )
$$;
revoke all on function _is_approver_for(text, date) from public, anon, authenticated;

-- ---------------------------------------------------------------- 4. conflicts are surfaced, not fixed
create or replace function schedule_conflicts(p_child text, p_from date, p_to date)
returns table (kind text, on_day date, arrangement_ids text[], detail text)
language sql stable security definer set search_path = public
as $$
  with days as (
    select generate_series(p_from, p_to, interval '1 day')::date as day
  ),
  covered as (
    select d.day, a.id
      from days d
      join holiday_arrangements a
        on a.child_id = p_child
       and a.status = 'APPROVED'
       and d.day between a.date_start and a.date_end
  )
  select 'OVERLAP'::text as kind, day as on_day, array_agg(id order by id) as arrangement_ids,
         'two approved arrangements cover this day'::text as detail
    from covered
   group by day
  having count(*) > 1
  union all
  select 'GAP'::text as kind, d.day as on_day, '{}'::text[] as arrangement_ids,
         'no parent assigned by any rule'::text as detail
    from days d
   where not exists (
     select 1 from effective_schedule_for(p_child, d.day) e where e.parent_id is not null
   )
  order by kind, on_day
$$;

-- ---------------------------------------------------------------- 5. who may approve a swap
create or replace function swap_approval_rule(p_child text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((
    select hp.value
      from household_policies hp
      join household_members c on c.household_id = hp.household_id
     where c.person_id = p_child and c.role = 'child' and hp.rule = 'schedule_swap_approval'
     limit 1
  ), 'BOTH_PARENTS')
$$;

-- BOTH_PARENTS (default): the OTHER parent/guardian approves — never the proposer, never a grant.
-- ANY_PARENT: any parent/guardian of the child may approve.
create or replace function can_approve_swap(p_child text, p_proposer text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from household_members me
      join households h on h.id = me.household_id
     where me.person_id = current_person()
       and me.role in ('parent','guardian')
       and (swap_approval_rule(p_child) = 'ANY_PARENT' or me.person_id <> p_proposer)
       and exists (
         select 1 from household_members c
          where c.household_id = h.id and c.person_id = p_child and c.role = 'child'
       )
  )
$$;

-- The rule is enforced on the TABLE, so no update path can approve on the proposer's own authority.
create or replace function _guard_arrangement_approval()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'APPROVED' and (old.status is distinct from 'APPROVED') then
    if not can_approve_swap(new.child_id, new.proposed_by_id) then
      raise exception 'SWAP_APPROVAL_NOT_ALLOWED' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists holiday_arrangements_approval_guard on holiday_arrangements;
create trigger holiday_arrangements_approval_guard
  before update on holiday_arrangements
  for each row execute function _guard_arrangement_approval();

-- ---------------------------------------------------------------- 6. approvals may reference one
do $$
declare cname text;
begin
  select conname into cname
    from pg_constraint
   where conrelid = 'approvals'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) like '%subject_type%';
  if cname is not null then
    execute format('alter table approvals drop constraint %I', cname);
  end if;
  alter table approvals add constraint approvals_subject_type_check
    check (subject_type in ('Relationship','Grant','HolidayArrangement')) not valid;
end $$;

-- ---------------------------------------------------------------- 7. RLS + privileges
alter table holiday_arrangements enable row level security;

drop policy if exists holiday_arrangements_read on holiday_arrangements;
create policy holiday_arrangements_read on holiday_arrangements for select to authenticated
  using (is_parent_of(child_id) or has_scope(child_id, 'schedule.read'));

drop policy if exists demo_guide_holiday_arrangements on holiday_arrangements;
create policy demo_guide_holiday_arrangements on holiday_arrangements for select to authenticated
  using (is_demo_guide() and sandbox);

drop policy if exists holiday_arrangements_parent_write on holiday_arrangements;
create policy holiday_arrangements_parent_write on holiday_arrangements for all to authenticated
  using (is_parent_of(child_id)) with check (is_parent_of(child_id));

drop policy if exists holiday_arrangements_guide_no_insert on holiday_arrangements;
create policy holiday_arrangements_guide_no_insert on holiday_arrangements as restrictive for insert to authenticated
  with check (not is_demo_guide());
drop policy if exists holiday_arrangements_guide_no_update on holiday_arrangements;
create policy holiday_arrangements_guide_no_update on holiday_arrangements as restrictive for update to authenticated
  using (not is_demo_guide()) with check (not is_demo_guide());
drop policy if exists holiday_arrangements_guide_no_delete on holiday_arrangements;
create policy holiday_arrangements_guide_no_delete on holiday_arrangements as restrictive for delete to authenticated
  using (not is_demo_guide());

grant select, insert, update on holiday_arrangements to authenticated;
grant execute on function effective_schedule_for(text, date) to authenticated;
grant execute on function schedule_conflicts(text, date, date) to authenticated;
grant execute on function swap_approval_rule(text) to authenticated;
grant execute on function can_approve_swap(text, text) to authenticated;

commit;

-- ---------------------------------------------------------------- rollback (manual)
-- begin;
--   drop trigger if exists holiday_arrangements_approval_guard on holiday_arrangements;
--   drop function if exists _guard_arrangement_approval();
--   drop table if exists holiday_arrangements;
--   drop function if exists can_approve_swap(text,text);
--   drop function if exists swap_approval_rule(text);
--   drop function if exists schedule_conflicts(text,date,date);
--   drop function if exists effective_schedule_for(text,date);
--   alter table routines drop constraint if exists routines_applies_on_check;
--   alter table routines drop column if exists applies_on;
--   -- day_kind/day_routines/_is_approver_for: recreate from 0027 / 0013
-- commit;
