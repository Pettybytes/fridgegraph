-- 0066 — a caregiver may read — and therefore accept — her OWN attempt.
--
-- THE DEFECT (measured 2026-11-02)
-- `attempts` is FORCE RLS with a single SELECT policy that admits **parents only**
-- (`0003_rls.sql`: `is_parent_of(j.child_id)`). `accept_pickup` is SECURITY DEFINER owned by
-- `postgres`, and FORCE ROW LEVEL SECURITY applies to the owner too — so when a caregiver called
-- `acceptPickup` on her own attempt, the function's `select … for update` saw no row and raised
-- `ATTEMPT_NOT_FOUND`. Her `attempts` query returned `[]` for the same reason. The paid-ride
-- evaluation can therefore never be driven by the person it belongs to.
--
-- THE FIX
-- One additive SELECT policy. Policies are OR-ed, so:
--   * parents keep their existing full read (`attempts_read`);
--   * a caller additionally sees ONLY rows where `candidate_id = current_person()`.
-- Nothing else in `attempts` becomes visible to anyone. No INSERT/UPDATE/DELETE policy is added:
-- accepting still goes through `accept_pickup` / `accept_pickup_webhook`, which derive the candidate
-- from the row and never from an argument.
--
-- Forward-only and additive. Applied in the next window; until then it is NOT in the database.

begin;

drop policy if exists attempts_read_own on attempts;
create policy attempts_read_own on attempts
  for select to authenticated
  using (candidate_id = current_person());

commit;
