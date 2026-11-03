-- 0088 — villager_proposals: restore SELECT to authenticated (Activity read)
--
-- DEFECT (2026-11-03, observed on the served build)
-- Activity's `villagerAdditions` resolver returned `[db] 42501 permission denied for table
-- villager_proposals` for an ordinary signed-in demo caller, which the web turned into a whole-page
-- "Activity unavailable". 0074 created the table, enabled + FORCED row level security and added the
-- proposer-only SELECT policy — but never granted table-level SELECT to `authenticated`.
--
-- RLS decides WHICH rows a caller may see. A missing GRANT decides whether the table is readable at
-- all; 42501 is the grant talking, not the policy. That distinction matters: this is an
-- infrastructure privilege defect, not an authorization refusal, and it must not be classified as
-- UNAUTHORIZED anywhere.
--
-- SCOPE — exactly one grant.
--   * The existing policy `villager_proposals_read` (proposer_id = current_person()) is UNTOUCHED,
--     so a caller still sees only their own proposals.
--   * No grant to `anon`.
--   * No INSERT/UPDATE/DELETE/TRUNCATE grant: writes continue to go through 0074's SECURITY DEFINER
--     functions only.
--   * No policy widening, no service-role workaround, no view.
--
-- Catalog guards fail closed. If the table or the expected policy is not what this migration was
-- written against, it raises instead of granting blind.

begin;

do $$
begin
  if to_regclass('public.villager_proposals') is null then
    raise exception '0088: public.villager_proposals is missing';
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'villager_proposals'
       and policyname = 'villager_proposals_read' and cmd = 'SELECT'
  ) then
    raise exception '0088: expected the proposer-only SELECT policy villager_proposals_read';
  end if;

  -- A write policy would mean the table's write model changed underneath this migration.
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'villager_proposals'
       and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ) then
    raise exception '0088: unexpected write policy on villager_proposals';
  end if;
end $$;

-- The only change: readable to signed-in callers. Visibility is still the policy's decision.
grant select on table public.villager_proposals to authenticated;

-- Anonymous callers never read this table.
revoke all on table public.villager_proposals from anon;

-- Writes stay function-only. Stated explicitly so a future DEFAULT PRIVILEGES change cannot quietly
-- add them.
revoke insert, update, delete, truncate on table public.villager_proposals from authenticated;

comment on table public.villager_proposals is
  'Add-a-Villager proposals. SELECT granted to authenticated (0088); rows remain proposer-only via '
  'the villager_proposals_read policy. All writes go through the 0074 SECURITY DEFINER functions.';

commit;
