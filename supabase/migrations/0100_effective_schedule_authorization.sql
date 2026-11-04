-- Forward-only repair for 0099: the SECURITY DEFINER RPC must authorize its own reads.
-- GraphQL checks cannot protect direct PostgREST RPC calls. No write rights change.
begin;
create or replace function public.effective_schedule_for(p_child text, p_day date)
returns table (parent_id text, source text, arrangement_id text, handoff_time time, handoff_location text)
language plpgsql stable security definer set search_path = pg_catalog, public
as $$
begin
  if public.current_person() is null or not coalesce(
    -- The mapped guide identity never inherits ordinary grants into private families.
    case when public.current_person() = 'p_demo_guide' then public.guide_reads_child(p_child)
      else public.is_parent_of(p_child) or public.has_scope(p_child, 'schedule.read')
    end, false
  ) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return query
  with approved as (
    select a.id, a.assigned_parent_id
      from public.holiday_arrangements a
     where a.child_id = p_child
       and a.status = 'APPROVED'
       and p_day between a.date_start and a.date_end      -- INCLUSIVE
     order by a.date_start, a.id                          -- deterministic; overlaps are reported
     limit 1
  )
  select coalesce(
           (select assigned_parent_id from approved),
           (select ps.parent_id from public.parenting_schedules ps
             where ps.child_id = p_child
               and upper(to_char(p_day, 'DY')) = any (ps.weekdays)
             order by ps.parent_id
             limit 1)
         ) as parent_id,
         case when exists (select 1 from approved) then 'ARRANGEMENT' else 'WEEKLY' end as source,
         (select id from approved) as arrangement_id,
         case when not exists (select 1 from approved) then
           (select ps.handoff_time from public.parenting_schedules ps where ps.child_id = p_child
             and upper(to_char(p_day, 'DY')) = any(ps.weekdays) order by ps.parent_id limit 1)
         end as handoff_time,
         case when not exists (select 1 from approved) then
           (select ps.handoff_location from public.parenting_schedules ps where ps.child_id = p_child
             and upper(to_char(p_day, 'DY')) = any(ps.weekdays) order by ps.parent_id limit 1)
         end as handoff_location;
end
$$;
revoke all on function public.effective_schedule_for(text,date) from public, anon;
grant execute on function public.effective_schedule_for(text,date) to authenticated, service_role;
commit;
