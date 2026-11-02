-- 0067 — index for the discovery-timeout sweeper.
--
-- The sweeper (src/village/discoverySweeper.ts) asks one question every 15 s:
--
--   select id from coordination_jobs
--    where status = 'discovering'
--      and now() >= created_at + make_interval(secs => discovery_timeout_seconds)
--    order by created_at limit 25
--
-- A partial index on `created_at` where the job is still discovering keeps that poll cheap without
-- touching any existing row or changing any plan for the parent-facing reads. Additive and
-- forward-only; reserved in HANDOFF before it was written (0067–0069 were free; 0066 and 0070–0074
-- are taken by merged work).

begin;

create index if not exists coordination_jobs_discovering_created_idx
  on coordination_jobs (created_at)
  where status = 'discovering';

commit;
