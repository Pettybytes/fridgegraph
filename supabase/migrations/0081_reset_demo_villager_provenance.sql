-- 0081 — the demo reset kept an Add-a-Villager grant while deleting its approval audit row.
--
-- MEASURED DEFECT (window N+1 reset, 2026-11-02 ~04:03Z)
--   grants g_1d2dfa3915b1 ............ STILL PRESENT, live (scopes {pickup.request}, granted_by p_mom)
--   approvals (ap_d704358f335f) ...... DELETED
--   villager_proposals vp_9c8114984df1  still confirmed (confirmed_grant_id, confirmed_at)
--   relationships r_dana_friend_parent  still ACTIVE
-- A reset therefore produced a demo where Dana holds pickup access on Nora with **no record of who
-- granted it**, and `stack-health`'s cast checksum moved (f022ccf8311e7561 → 57eead180d11fbf0)
-- because that checksum digests `grants` as well as care_facts and routines. The checksum drift was a
-- SYMPTOM of the stale grant, not a seed change — the canonical baseline itself never moved.
--
-- WHY THE EXISTING RESET MISSES IT
-- resetDemo deletes by `sandbox is true` or by fixture id. `grants`, `relationships` and
-- `villager_proposals` have no `sandbox` column, so none of the Add-a-Villager writes were in scope —
-- while `approvals` (cleared wholesale elsewhere) was. That asymmetry is what orphaned the audit row.
--
-- WHAT THIS DOES — provenance, not guesswork
-- `villager_proposals` is the record of every Add-a-Villager write. Everything a proposal created is
-- removed through it:
--   1. approvals whose subject is a proposal-created grant;
--   2. those grants themselves;
--   3. proposals;
--   4. a seeded relationship that a proposal merely ACTIVATED is restored to its seeded status;
--   5. a relationship that only exists because a confirm created it (proposal.relationship_id is null)
--      is removed entirely.
-- Untouched: grants with no proposal provenance, other households, protected rows, audit rows that do
-- not reference a proposal grant.
--
-- SEEDED SOURCE OF TRUTH for step 4: `src/fixtures.ts` — `r_dana_friend_parent` is seeded `DISCOVERED`.
-- The map is explicit rather than inferred from "not ACTIVE", because `src/fixtures-cast-v2.ts` seeds
-- its own relationships `ACTIVE` and a blanket downgrade would corrupt those.
--
-- Atomic (single statement, CTEs share one snapshot) and repeatable (a second call deletes 0).

begin;

create or replace function public.reset_demo_villager_provenance()
returns jsonb
language sql
security definer
set search_path = public
as $$
  with prov as (
    select id,
           relationship_id,
           confirmed_relationship_id,
           confirmed_grant_id
      from villager_proposals
  ),
  del_approvals as (
    delete from approvals a
     using prov p
     where p.confirmed_grant_id is not null
       and a.subject_type = 'Grant'
       and a.subject_id = p.confirmed_grant_id
    returning a.id
  ),
  del_grants as (
    delete from grants g
     using prov p
     where p.confirmed_grant_id is not null
       and g.id = p.confirmed_grant_id
    returning g.id
  ),
  restore_seeded as (
    update relationships r
       set status = 'DISCOVERED',
           history = r.history || jsonb_build_array(jsonb_build_object(
             'at', current_date,
             'event', 'RESTORED to seeded DISCOVERED (demo reset)'))
     where r.id = 'r_dana_friend_parent'                     -- src/fixtures.ts
       and r.id in (select relationship_id from prov where relationship_id is not null)
    returning r.id
  ),
  del_disposable_rel as (
    delete from relationships r
     where r.id in (
             select confirmed_relationship_id from prov
              where relationship_id is null and confirmed_relationship_id is not null
           )
    returning r.id
  ),
  del_proposals as (
    delete from villager_proposals returning id
  )
  select jsonb_build_object(
    'approvals_removed',       (select count(*) from del_approvals),
    'grants_removed',          (select count(*) from del_grants),
    'relationships_restored',  (select count(*) from restore_seeded),
    'relationships_removed',   (select count(*) from del_disposable_rel),
    'proposals_removed',       (select count(*) from del_proposals)
  );
$$;

revoke all on function public.reset_demo_villager_provenance() from public, anon;
grant execute on function public.reset_demo_villager_provenance() to authenticated;

commit;
