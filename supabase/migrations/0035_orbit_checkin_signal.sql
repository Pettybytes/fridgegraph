-- 0035 — the expected-check-in signal Orbit is triggered by.
--
-- An expected check-in ("Nora home by 4:00") with no recorded check-in is what Rosina notices and
-- offers Orbit for. The read reports "check-in not recorded" — never "missing", never "in danger" —
-- and only to the parent view. This slice records no location of any kind.

begin;

create table if not exists expected_checkins (
  id        text primary key,
  child_id  text not null references children(person_id) on delete cascade,
  label     text not null,
  due_at    timestamptz not null,
  active    boolean not null default true,
  sandbox   boolean not null default true,
  fixture   boolean not null default false
);

create table if not exists check_ins (
  id        text primary key,
  child_id  text not null references children(person_id) on delete cascade,
  at        timestamptz not null default now(),
  source    text not null default 'APP',
  fixture   boolean not null default false
);

alter table expected_checkins enable row level security;
alter table check_ins enable row level security;

drop policy if exists expected_checkins_parent on expected_checkins;
create policy expected_checkins_parent on expected_checkins for select to authenticated
  using (is_parent_of(child_id));

drop policy if exists check_ins_parent on check_ins;
create policy check_ins_parent on check_ins for select to authenticated
  using (is_parent_of(child_id));

drop policy if exists demo_guide_expected_checkins on expected_checkins;
create policy demo_guide_expected_checkins on expected_checkins for select to authenticated
  using (is_demo_guide() and sandbox);

grant select on expected_checkins, check_ins to authenticated;
grant select, insert, update, delete on expected_checkins, check_ins to service_role;

-- Parent view: was the expected check-in recorded for that day?
create or replace function checkin_status_for(p_child text, p_day date)
returns table (recorded boolean, label text, due_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with expected as (
    select e.label, e.due_at
      from expected_checkins e
     where e.child_id = p_child and e.active
       and e.due_at::date = p_day
     order by e.due_at desc
     limit 1
  )
  select
    exists (select 1 from check_ins c where c.child_id = p_child and c.at::date = p_day) as recorded,
    coalesce((select label from expected), 'check-in') as label,
    (select due_at from expected) as due_at
$$;

grant execute on function checkin_status_for(text, date) to authenticated;

commit;
