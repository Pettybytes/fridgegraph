-- 0004 — Role grants.
-- RLS only filters rows a role is already allowed to touch. Without these GRANTs every request fails
-- at 403 before any policy is evaluated, which looks like "RLS works" but proves nothing.

grant usage on schema public to anon, authenticated, service_role;

-- service role: used only by server-side scripts (seed, identity map, subgraph writes)
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- signed-in users: read is filtered by RLS; writes only where a parent acts
grant select on all tables in schema public to authenticated;
grant insert, update, delete on relationships, grants, approvals, goals to authenticated;
grant usage on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- anonymous: no table access at all. Kept explicit so it cannot drift.
revoke all on all tables in schema public from anon;

-- identity_map is server-side only: no policy exists for it, and these revokes make that explicit
revoke all on identity_map from anon, authenticated;
