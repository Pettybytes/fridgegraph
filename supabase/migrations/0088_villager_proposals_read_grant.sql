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

--
-- CATALOG GUARDS — fail closed. 0074 is the only migration that created this table's shape, so every
-- assertion below is a statement about THAT shape. If any of them is false, the catalog has changed
-- underneath this migration and granting blind would widen visibility we did not review. Each guard
-- names the unexpected state; the migration aborts rather than "repairing" it.

begin;

do $$
declare
  v_rls boolean;
  v_forced boolean;
  v_select_policies int;
  v_permissive text;
  v_roles name[];
  v_qual text;
  v_qual_norm text;
begin
  if to_regclass('public.villager_proposals') is null then
    raise exception '0088: public.villager_proposals is missing';
  end if;

  -- RLS must be ON and FORCED: a SECURITY DEFINER function owner would otherwise bypass the policy.
  select c.relrowsecurity, c.relforcerowsecurity into v_rls, v_forced
    from pg_class c
   where c.oid = 'public.villager_proposals'::regclass;
  if not v_rls then
    raise exception '0088: row level security is not enabled on villager_proposals';
  end if;
  if not v_forced then
    raise exception '0088: row level security is not FORCED on villager_proposals';
  end if;

  -- Exactly one SELECT policy, and it is the one this migration was written against. An extra
  -- permissive SELECT policy would broaden visibility while looking like a harmless grant.
  select count(*)::int into v_select_policies
    from pg_policies
   where schemaname = 'public' and tablename = 'villager_proposals' and cmd = 'SELECT';
  if v_select_policies <> 1 then
    raise exception '0088: expected exactly one SELECT policy on villager_proposals, found %', v_select_policies;
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'villager_proposals'
       and policyname = 'villager_proposals_read' and cmd = 'SELECT'
  ) then
    raise exception '0088: expected the proposer-only SELECT policy villager_proposals_read';
  end if;

  select p.permissive, p.roles, p.qual into v_permissive, v_roles, v_qual
    from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'villager_proposals'
     and p.policyname = 'villager_proposals_read';

  -- The policy must apply to signed-in callers only. `public`/`anon` here would expose proposals to
  -- unauthenticated traffic the moment the grant lands.
  if v_permissive <> 'PERMISSIVE' then
    raise exception '0088: villager_proposals_read is unexpectedly %, not PERMISSIVE', v_permissive;
  end if;
  if v_roles <> array['authenticated']::name[] then
    raise exception '0088: villager_proposals_read applies to %, expected {authenticated}', v_roles;
  end if;

  -- The predicate must remain the proposer-only decision. Whitespace is normalized only; nothing
  -- else about it is inferred.
  v_qual_norm := btrim(regexp_replace(coalesce(v_qual, ''), '\s+', ' ', 'g'));
  if v_qual_norm <> '(proposer_id = current_person())' then
    raise exception '0088: villager_proposals_read predicate changed: %', v_qual_norm;
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
