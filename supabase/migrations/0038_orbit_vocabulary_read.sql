-- 0038 — the vocabulary is public reference data, so it needs a SELECT policy.
--
-- 0034 granted SELECT and inserted the values, but Supabase enables RLS on the table with no policy,
-- so `authenticated` reads returned zero rows. The list is deliberately public to authenticated
-- callers — it is the closed set of words Orbit may use — so the policy is a plain true for SELECT.
-- There is no write policy: values change only by migration.

begin;

drop policy if exists orbit_vocabulary_read on orbit_vocabulary;
create policy orbit_vocabulary_read on orbit_vocabulary for select to authenticated
  using (true);

commit;
