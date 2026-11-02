-- 0068 — the companion gate: a caregiver can accept her own attempt, and only her own.
--
-- WHY THIS EXISTS (measured 2026-11-02, after 0066 was applied and served)
-- With `attempts_read_own` in place the caregiver could SEE exactly one attempt — her own — and could
-- not accept anyone else's. Her own accept still failed with `JOB_NOT_FOUND`, because the resolver
-- read the JOB through the caller's own RLS client to obtain `request_version`, and
-- `coordination_jobs` is parent-only. Reading the evaluation afterwards had the same shape: the
-- candidate cannot see `candidate_evaluations`, so the resolver would have ended in `NOT_FOUND`.
--
-- WHAT THIS ADDS (both additive; nothing is widened for anyone else)
--   1. `candidate_attempt_context(p_attempt)` — SECURITY DEFINER, EXECUTE to `authenticated` only.
--      Returns `(attempt_id, job_id, request_version)` **only when the attempt belongs to
--      current_person()**. It is the narrow answer to "which job and version does MY attempt have",
--      so the resolver never needs a job read whose visibility was designed for parents.
--      A foreign or nonexistent attempt yields no rows — the same generic refusal, no oracle.
--   2. `candidate_evaluations_own` — SELECT policy `candidate_id = current_person()`, so the
--      caregiver can read her own evaluation row (and only hers). Policies are OR-ed, so parents and
--      the demo guide keep exactly what they had.
--
-- No INSERT/UPDATE/DELETE policy is added: accepting still goes through `accept_pickup`, which
-- derives the candidate from the attempt rather than an argument.

begin;

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

drop policy if exists candidate_evaluations_own on candidate_evaluations;
create policy candidate_evaluations_own on candidate_evaluations
  for select to authenticated
  using (candidate_id = current_person());

commit;
