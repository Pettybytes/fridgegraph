-- 0005 — whoami(): lets a signed-in caller see WHICH person the database thinks they are.
-- Needed to prove auth.uid() -> identity_map -> person_id resolution without exposing the map
-- itself (identity_map stays revoked for authenticated/anon).

create or replace function whoami() returns text
language sql stable security definer set search_path = public as $$
  select current_person()
$$;

revoke all on function whoami() from public;
grant execute on function whoami() to authenticated;
