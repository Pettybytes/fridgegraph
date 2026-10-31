-- 0030 — an explicit FIXTURE marker, so additive demo rows are identifiable and removable.
--
-- WHY: additive fixture rows may live in a table that already has baseline data (a cancelled event,
-- for instance). They are allowed ONLY if they can be told apart from baseline rows and removed
-- exactly, leaving the baseline byte-identical. A boolean marker is that handle; an id prefix alone
-- is a convention that a future fixture can forget.
--
-- No policy reads this column. Authorization never depends on it: it is bookkeeping for seeding,
-- checksums and cleanup.

begin;

alter table events                add column if not exists fixture boolean not null default false;
alter table coordination_jobs     add column if not exists fixture boolean not null default false;
alter table attempts              add column if not exists fixture boolean not null default false;
alter table holidays              add column if not exists fixture boolean not null default false;
alter table routines              add column if not exists fixture boolean not null default false;
alter table adult_availability    add column if not exists fixture boolean not null default false;
alter table holiday_arrangements  add column if not exists fixture boolean not null default false;

-- Fast "is there anything of mine here" lookups during cleanup.
create index if not exists events_fixture_idx on events (fixture) where fixture;
create index if not exists coordination_jobs_fixture_idx on coordination_jobs (fixture) where fixture;
create index if not exists attempts_fixture_idx on attempts (fixture) where fixture;
create index if not exists holidays_fixture_idx on holidays (fixture) where fixture;
create index if not exists routines_fixture_idx on routines (fixture) where fixture;
create index if not exists adult_availability_fixture_idx on adult_availability (fixture) where fixture;
create index if not exists holiday_arrangements_fixture_idx on holiday_arrangements (fixture) where fixture;

commit;
