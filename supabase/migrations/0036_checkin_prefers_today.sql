-- 0036 — the expected check-in selector: today first, then the most recent overdue one.
--
-- A missed check-in does not stop being the signal at midnight. The previous version only matched
-- the exact day, so an expectation seeded on one date disappeared the next day. This keeps "today"
-- authoritative when it exists and otherwise reports the latest overdue expectation.

begin;

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
     order by (e.due_at::date = p_day) desc, e.due_at desc
     limit 1
  )
  select
    exists (
      select 1 from check_ins c
       where c.child_id = p_child
         and c.at::date = (select due_at::date from expected)
    ) as recorded,
    coalesce((select label from expected), 'check-in') as label,
    (select due_at from expected) as due_at
$$;

grant execute on function checkin_status_for(text, date) to authenticated;

commit;
