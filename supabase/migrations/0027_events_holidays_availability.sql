-- 0027 — coordination-v2 Areas A/B: event status, holidays over the weekly routine (inclusive
--        end dates), and adult busy/free availability whose reason is never exposed.
--
-- THREE SEPARATE FACTS, DELIBERATELY NOT CONFLATED:
--   * events.status            what a calendar entry currently IS (proposed / confirmed / cancelled)
--   * holidays                 a date range that outranks the weekly routine, BOTH ends inclusive
--   * adult_availability       when another adult is Busy/Free — the REASON is private to its owner
--
-- PRIVACY: Postgres RLS filters rows, not columns. So the reason column cannot be "hidden" by a
-- policy on the base table; a policy that admits another adult would expose it. The base table is
-- therefore owner-only, and sharing goes through `adult_availability_free_busy`, a view that
-- projects state only. The view is explicitly NOT auto-updatable in practice (write is revoked), so
-- it cannot become a back door.
--
-- HOLIDAY PRECEDENCE: `day_routines()` returns NO routine on a holiday even when the weekday
-- matches, and `day_kind()` reports HOLIDAY. An inclusive range is the requirement: a holiday that
-- ends on the 27th still covers the 27th.
--
-- Rollback: see the commented block at the bottom. Forward-only otherwise.

begin;

-- ---------------------------------------------------------------- 1. event status
alter table events add column if not exists status text not null default 'confirmed';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'events_status_check') then
    alter table events add constraint events_status_check
      check (status in ('proposed','confirmed','cancelled')) not valid;
  end if;
end $$;

-- ---------------------------------------------------------------- 2. weekly routine definitions
create table if not exists routines (
  id         text primary key,
  child_id   text not null references children(person_id) on delete cascade,
  title      text not null,
  weekdays   text[] not null check (array_length(weekdays, 1) > 0),
  start_time time not null,
  end_time   time not null,
  location   text,
  sandbox    boolean not null default true
);

-- ---------------------------------------------------------------- 3. holidays (inclusive)
create table if not exists holidays (
  id         text primary key,
  child_id   text not null references children(person_id) on delete cascade,
  name       text not null,
  start_date date not null,
  end_date   date not null,
  sandbox    boolean not null default true,
  constraint holidays_range check (end_date >= start_date)
);

create or replace function holiday_covers(child text, on_day date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from holidays h
     where h.child_id = child
       and on_day between h.start_date and h.end_date   -- INCLUSIVE at both ends
  )
$$;

create or replace function day_kind(child text, on_day date)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when holiday_covers(child, on_day) then 'HOLIDAY'
    when extract(isodow from on_day) between 1 and 5 then 'SCHOOL_DAY'
    else 'WEEKEND'
  end
$$;

-- Holiday precedence: on a holiday NO weekly routine applies, even if the weekday matches.
create or replace function day_routines(child text, on_day date)
returns table (id text, title text, start_time time, end_time time, location text)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.title, r.start_time, r.end_time, r.location
    from routines r
   where r.child_id = child
     and not holiday_covers(child, on_day)
     and to_char(on_day, 'DY') = any (r.weekdays)
   order by r.start_time
$$;

-- ---------------------------------------------------------------- 4. adult availability
create table if not exists adult_availability (
  id         text primary key,
  person_id  text not null references people(id) on delete cascade,
  start_at   timestamptz not null,
  end_at     timestamptz not null,
  state      text not null check (state in ('BUSY','FREE')),
  reason     text,                                  -- PRIVATE: owner only, never shared
  sandbox    boolean not null default true,
  constraint adult_availability_range check (end_at > start_at)
);

create or replace function shares_village_with(p text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from household_members me
      join households h1 on h1.id = me.household_id
      join household_members them on them.person_id = p
      join households h2 on h2.id = them.household_id
     where me.person_id = current_person()
       and h1.village_id = h2.village_id
  )
$$;

/* State only — no reason column exists in this projection. Definer semantics are intentional here:
   the view performs the sharing rule itself (same shape as the SECURITY DEFINER helpers), and the
   base table stays owner-only so there is no other path to the reason. */
create or replace view adult_availability_free_busy as
  select a.id, a.person_id, a.start_at, a.end_at, a.state
    from adult_availability a
   where a.person_id = current_person()
      or shares_village_with(a.person_id)
      or (is_demo_guide() and a.sandbox);

revoke all on adult_availability_free_busy from authenticated;
grant select on adult_availability_free_busy to authenticated;

-- ---------------------------------------------------------------- 5. RLS
alter table routines enable row level security;
alter table holidays enable row level security;
alter table adult_availability enable row level security;

drop policy if exists routines_read on routines;
create policy routines_read on routines for select to authenticated
  using (is_parent_of(child_id) or has_scope(child_id, 'schedule.read'));

drop policy if exists holidays_read on holidays;
create policy holidays_read on holidays for select to authenticated
  using (is_parent_of(child_id) or has_scope(child_id, 'schedule.read'));

drop policy if exists demo_guide_routines on routines;
create policy demo_guide_routines on routines for select to authenticated
  using (is_demo_guide() and sandbox);

drop policy if exists demo_guide_holidays on holidays;
create policy demo_guide_holidays on holidays for select to authenticated
  using (is_demo_guide() and sandbox);

-- The owner sees their own rows (including the reason); nobody else can read this table at all.
drop policy if exists adult_availability_own on adult_availability;
create policy adult_availability_own on adult_availability for select to authenticated
  using (person_id = current_person());

drop policy if exists adult_availability_own_write on adult_availability;
create policy adult_availability_own_write on adult_availability for all to authenticated
  using (person_id = current_person())
  with check (person_id = current_person());

-- ---------------------------------------------------------------- 5b. privileges
-- 0004 granted privileges on the tables that existed THEN; a new table needs its own grant or every
-- caller gets 42501 before RLS is even consulted (found by the dry run, not in production).
grant select on routines, holidays to authenticated;
grant select on adult_availability to authenticated;   -- RLS narrows this to the owner
grant execute on function holiday_covers(text, date) to authenticated;
grant execute on function day_kind(text, date) to authenticated;
grant execute on function day_routines(text, date) to authenticated;
grant execute on function shares_village_with(text) to authenticated;

-- ---------------------------------------------------------------- 6. no-write for the guide
-- Restrictive, per command: a restrictive SELECT would defeat the guide's read policies above.
drop policy if exists routines_guide_no_insert on routines;
create policy routines_guide_no_insert on routines as restrictive for insert to authenticated
  with check (not is_demo_guide());
drop policy if exists routines_guide_no_update on routines;
create policy routines_guide_no_update on routines as restrictive for update to authenticated
  using (not is_demo_guide()) with check (not is_demo_guide());
drop policy if exists routines_guide_no_delete on routines;
create policy routines_guide_no_delete on routines as restrictive for delete to authenticated
  using (not is_demo_guide());

drop policy if exists holidays_guide_no_insert on holidays;
create policy holidays_guide_no_insert on holidays as restrictive for insert to authenticated
  with check (not is_demo_guide());
drop policy if exists holidays_guide_no_update on holidays;
create policy holidays_guide_no_update on holidays as restrictive for update to authenticated
  using (not is_demo_guide()) with check (not is_demo_guide());
drop policy if exists holidays_guide_no_delete on holidays;
create policy holidays_guide_no_delete on holidays as restrictive for delete to authenticated
  using (not is_demo_guide());

commit;

-- ---------------------------------------------------------------- rollback (manual)
-- begin;
--   drop view if exists adult_availability_free_busy;
--   drop function if exists day_routines(text, date);
--   drop function if exists day_kind(text, date);
--   drop function if exists holiday_covers(text, date);
--   drop function if exists shares_village_with(text);
--   drop table if exists adult_availability;
--   drop table if exists holidays;
--   drop table if exists routines;
--   alter table events drop constraint if exists events_status_check;
--   alter table events drop column if exists status;
-- commit;
