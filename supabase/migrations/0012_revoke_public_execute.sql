-- 0012 — revoke PUBLIC/anon EXECUTE on the four definer helpers that kept Postgres defaults.
--
-- Source: the read-only audit recorded in docs/handoff/HANDOFF.md §17 (2026-10-28).
-- current_person(), is_parent_of(text) and has_scope(text, text) were created in 0003 and
-- re-created in 0006 without `revoke all ... from public`; local_today() was created in 0006 with a
-- GRANT but no REVOKE. All four therefore kept the default PUBLIC EXECUTE, making them callable by
-- `anon` through PostgREST RPC. The other five definer helpers (whoami, my_household_ids,
-- parent_ids_of, pickup_candidates_for, grant_holders_for) already revoke PUBLIC and anon.
--
-- What an anon caller actually obtained was a null identity, the local date and two booleans that
-- are always false for it — no row data. This migration corrects the posture, not a live leak.
--
-- Revoking PUBLIC also removes the inherited grant from `authenticated`, which is the role every
-- request uses. These four functions are called by RLS policy expressions on tables the app reads,
-- so EXECUTE is re-granted to `authenticated` explicitly. Bodies are unchanged; no policy, table or
-- column is touched. search_path is already pinned in every definition and is not altered here.
--
-- Rollback (identical posture to before this migration, for a local reset only):
--   grant execute on function current_person() to public;
--   grant execute on function local_today() to public;
--   grant execute on function is_parent_of(text) to public;
--   grant execute on function has_scope(text, text) to public;

-- current_person(): identity of the caller. noqa: not needed by anon.
revoke all on function current_person() from public;
revoke all on function current_person() from anon;
grant execute on function current_person() to authenticated;

-- local_today(): the household calendar date. service_role keeps its 0006 grant.
revoke all on function local_today() from public;
revoke all on function local_today() from anon;
grant execute on function local_today() to authenticated;
grant execute on function local_today() to service_role;

-- is_parent_of(text): policy predicate.
revoke all on function is_parent_of(text) from public;
revoke all on function is_parent_of(text) from anon;
grant execute on function is_parent_of(text) to authenticated;

-- has_scope(text, text): policy predicate. The 0006 definition (local_today window) is untouched.
revoke all on function has_scope(text, text) from public;
revoke all on function has_scope(text, text) from anon;
grant execute on function has_scope(text, text) to authenticated;
