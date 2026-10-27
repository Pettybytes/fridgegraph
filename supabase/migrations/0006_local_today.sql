-- 0006 — Grant windows must be evaluated in the household's local timezone.
--
-- `current_date` is UTC. Detroit is 4-5 hours behind, so a grant valid "today" started reading as
-- expired from 20:00 local onward — the exact bug fixed in the app (APP_TIME_ZONE) reappearing here.
-- Date-granular windows (grants, and any future policy using a date) must use the local day.

create or replace function local_today() returns date
language sql stable as $$
  select (now() at time zone 'America/Detroit')::date
$$;

create or replace function has_scope(child text, scope text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from grants g
    where g.actor_id = current_person()
      and g.child_id = child
      and scope = any(g.scopes)
      and (g.valid_from  is null or local_today() >= g.valid_from)
      and (g.valid_until is null or local_today() <= g.valid_until)
  )
$$;

grant execute on function local_today() to authenticated, service_role;
