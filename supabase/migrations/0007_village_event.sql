-- 0007 — village_event (history) + ops_sentinel (outside the reset boundary)
--
-- village_event is VILLAGE history: things that happened. It is NOT the schedule.
--   * `events` remains the calendar (title/start/end/location) — what is planned.
--   * `village_event` records occurrences, who did them, and whether they were real or simulated.
-- Seeded fixtures never write here, and `npm run db:reset` never generates history.
-- Created EMPTY on purpose.

create table if not exists village_event (
  id          text primary key,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  actor_id    text references people(id),
  subject_id  text not null references children(person_id) on delete cascade,
  kind        text not null,
  source      text not null check (source in ('LIVE', 'SYNTHETIC_SCENARIO')),
  scenario_id text,
  payload     jsonb not null default '{}'::jsonb
);

alter table village_event enable row level security;
alter table village_event force row level security;

-- Same rule as the schedule: a parent, or a CURRENT schedule.read grant (America/Detroit today).
create policy village_event_read on village_event for select to authenticated
  using (is_parent_of(subject_id) or has_scope(subject_id, 'schedule.read'));

grant select on village_event to authenticated;
grant all privileges on village_event to service_role;

create index if not exists idx_village_event_subject on village_event(subject_id, occurred_at desc);

-- A record that deliberately sits OUTSIDE the demo-data boundary, so `db:reset` can be proven not
-- to touch unrelated rows. Server-side only.
create table if not exists ops_sentinel (
  id   text primary key,
  note text not null
);

alter table ops_sentinel enable row level security;
alter table ops_sentinel force row level security;
revoke all on ops_sentinel from anon, authenticated;
grant all privileges on ops_sentinel to service_role;
