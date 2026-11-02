-- 0068 — the narrow gate: a caregiver can accept her own attempt and learn only her own status.
--
-- WHY (measured 2026-11-02, after 0066 was applied and served)
-- With `attempts_read_own` in place the caregiver could SEE only her own attempt, yet her own accept
-- still failed with `JOB_NOT_FOUND`, because the resolver read the JOB through the caller's own RLS
-- client to obtain `request_version`, and `coordination_jobs` is parent-only.
--
-- WHAT WAS WRONG WITH THE FIRST DRAFT OF THIS MIGRATION
-- It added `candidate_evaluations_own` — a whole-row SELECT for `candidate_id = current_person()`.
-- That would have let a caregiver read her own `estimated_ride_cost_usd`, `cost_basis`,
-- `distance_miles` and `OVER_POLICY` reason, contradicting the agreed #87 rule that **cost, basis and
-- cap are parent/guardian reads**. The row policy is therefore NOT used. This migration drops it if an
-- earlier run created it, and gives the resolver exactly the columns `acceptPickup` needs — no money
-- column is reachable by a candidate at all.
--
-- WHAT `acceptPickup` ACTUALLY NEEDS (named from src/subgraphs/coordination.ts)
--   1. to call `accept_pickup`: the Attempt's `job_id` and that job's `request_version`
--      → `candidate_attempt_context(p_attempt)`.
--   2. to return the candidate's own outcome: `reason_code`, `available`, `accepted_via`,
--      `decline_reason` → `candidate_attempt_outcome(p_attempt)`. The cost/basis/distance/provenance/
--      calculated-at fields of the GraphQL type stay null on this path.
--
-- Both helpers are SECURITY DEFINER and gated on `attempts.candidate_id = current_person()`: a
-- foreign or nonexistent attempt returns no rows — the same generic refusal, no existence oracle.
-- Nothing is widened for anyone else, and no write policy is added (accepting still goes through
-- `accept_pickup`, which derives the candidate from the row).

begin;

-- Retire the over-broad draft if it was ever applied.
drop policy if exists candidate_evaluations_own on candidate_evaluations;

create or replace function candidate_attempt_context(p_attempt text)
returns table (attempt_id text, job_id text, request_version int)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.job_id, j.request_version
    from attempts a
    join coordination_jobs j on j.id = a.job_id
   where a.id = p_attempt
     and a.candidate_id = current_person()
$$;

revoke all on function candidate_attempt_context(text) from public, anon;
grant execute on function candidate_attempt_context(text) to authenticated;

create or replace function candidate_attempt_outcome(p_attempt text)
returns table (reason_code text, available boolean, accepted_via text, decline_reason text)
language sql
stable
security definer
set search_path = public
as $$
  select ce.reason_code, ce.available, ce.accepted_via, ce.decline_reason
    from attempts a
    join candidate_evaluations ce
      on ce.job_id = a.job_id and ce.candidate_id = a.candidate_id
   where a.id = p_attempt
     and a.candidate_id = current_person()
$$;

revoke all on function candidate_attempt_outcome(text) from public, anon;
grant execute on function candidate_attempt_outcome(text) to authenticated;

commit;
