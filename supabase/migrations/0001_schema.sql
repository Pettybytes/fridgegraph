-- 0001 — FridgeGraph schema (Supabase/Postgres)
-- Mirrors the in-memory fixtures exactly: same ids, same field semantics, same date granularity.
-- Fictional data only.

create table if not exists people (
  id            text primary key,
  display_name  text not null,
  birth_date    date not null
);

create table if not exists children (
  person_id text primary key references people(id) on delete cascade
);

create table if not exists villages (
  id   text primary key,
  name text not null
);

create table if not exists households (
  id         text primary key,
  village_id text not null references villages(id) on delete cascade
);

create table if not exists household_members (
  person_id    text not null references people(id) on delete cascade,
  household_id text not null references households(id) on delete cascade,
  role         text not null check (role in ('parent', 'child')),
  primary key (person_id, household_id)
);

create table if not exists relationships (
  id         text primary key,
  from_id    text not null references people(id) on delete cascade,
  to_id      text not null references children(person_id) on delete cascade,
  type       text not null,
  status     text not null check (status in ('DISCOVERED','INTRODUCED','VERIFIED','APPROVED','ACTIVE','EXPIRED','REVOKED')),
  created_at date not null,
  history    jsonb not null default '[]'::jsonb
);

create table if not exists contact_methods (
  id         bigserial primary key,
  person_id  text not null references people(id) on delete cascade,
  channel    text not null check (channel in ('CALL','SMS','EMAIL')),
  value      text not null,
  preferred  boolean not null default false,
  verified   boolean not null default false,
  unique (person_id, channel, value)
);

-- What someone OFFERS. Never permission.
create table if not exists capabilities (
  person_id  text not null references people(id) on delete cascade,
  name       text not null,
  conditions text,
  primary key (person_id, name)
);

create table if not exists groups (
  id   text primary key,
  name text not null,
  kind text not null
);

create table if not exists memberships (
  person_id text not null references people(id) on delete cascade,
  group_id  text not null references groups(id) on delete cascade,
  role      text not null,
  primary key (person_id, group_id)
);

create table if not exists goals (
  id             text primary key,
  child_id       text not null references children(person_id) on delete cascade,
  title          text not null,
  owner_id       text references people(id),
  proposed_by_id text references people(id),
  horizon        text,
  status         text not null check (status in ('APPROVED','PROPOSED'))
);

create table if not exists care_plans (
  child_id text primary key references children(person_id) on delete cascade,
  text     text not null
);

-- ---------------------------------------------------------------- access
create table if not exists grants (
  id          text primary key,
  actor_id    text not null references people(id) on delete cascade,
  child_id    text not null references children(person_id) on delete cascade,
  scopes      text[] not null check (array_length(scopes, 1) > 0),
  valid_from  date,
  valid_until date,
  granted_by  text not null references people(id)
);

create table if not exists approvals (
  id           text primary key,
  approver_id  text not null references people(id),
  subject_type text not null check (subject_type in ('Relationship','Grant')),
  subject_id   text not null,
  decision     text not null check (decision in ('APPROVED','GRANTED','REVOKED')),
  at           date not null
);

create table if not exists household_policies (
  household_id text not null references households(id) on delete cascade,
  rule         text not null,
  value        text not null,
  primary key (household_id, rule)
);

create table if not exists parenting_schedules (
  child_id  text not null references children(person_id) on delete cascade,
  parent_id text not null references people(id) on delete cascade,
  weekdays  text[] not null check (array_length(weekdays, 1) > 0),
  primary key (child_id, parent_id)
);

-- ---------------------------------------------------------------- schedule / school / transport / activities
create table if not exists events (
  id       text primary key,
  child_id text not null references children(person_id) on delete cascade,
  title    text not null,
  start_at timestamp not null,
  end_at   timestamp not null,
  location text
);

create table if not exists school_reports (
  id       text primary key,
  child_id text not null references children(person_id) on delete cascade,
  kind     text not null,
  text     text not null,
  at       date not null
);

create table if not exists permission_slips (
  id       text primary key,
  child_id text not null references children(person_id) on delete cascade,
  title    text not null,
  signed   boolean not null default false
);

create table if not exists bus_rosters (
  date     date not null,
  child_id text not null references children(person_id) on delete cascade,
  route    text not null,
  riding   boolean not null default false,
  primary key (date, child_id)
);

create table if not exists vehicles (
  id       text primary key,
  owner_id text not null references people(id) on delete cascade,
  year     int  not null,
  make     text not null,
  model    text not null,
  color    text not null,
  plate    text not null
);

create table if not exists practices (
  id       text primary key,
  group_id text not null references groups(id) on delete cascade,
  start_at timestamp not null,
  location text
);

-- ---------------------------------------------------------------- coordination + conversation (empty tonight)
create table if not exists coordination_jobs (
  id               text primary key,
  idempotency_key  text not null unique,
  type             text not null check (type in ('PICKUP','INVITATION','ONBOARDING')),
  child_id         text not null references children(person_id) on delete cascade,
  status           text not null,
  version          int  not null default 1
);

create table if not exists attempts (
  id      text primary key,
  job_id  text not null references coordination_jobs(id) on delete cascade,
  channel text not null,
  at      timestamptz not null
);

create table if not exists information_requests (
  id       text primary key,
  job_id   text not null references coordination_jobs(id) on delete cascade,
  question text not null,
  status   text not null
);

create table if not exists confirmations (
  id          text primary key,
  job_id      text not null references coordination_jobs(id) on delete cascade,
  received_at timestamptz not null
);

create table if not exists conversation_state (
  conversation_id text primary key,
  person_id       text not null references people(id) on delete cascade,
  child_id        text not null references children(person_id) on delete cascade,
  state           text not null,
  version         int  not null default 1,
  updated_at      timestamptz not null default now()
);

-- The DB-side half of the identity map: Supabase user id -> village person id.
-- Kept in Postgres so RLS can answer "who is calling?" without trusting a header.
create table if not exists identity_map (
  user_id   uuid primary key,
  person_id text not null unique references people(id) on delete cascade
);

create index if not exists idx_relationships_to on relationships(to_id);
create index if not exists idx_grants_actor_child on grants(actor_id, child_id);
create index if not exists idx_members_person on household_members(person_id);
