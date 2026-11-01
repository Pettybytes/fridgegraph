-- 0049 — demo families created at runtime.
--
-- A created family is sandbox data plus ONE persona that has a real Supabase Auth user. This table is
-- the authoritative list of created personas: the picker (health + login) reads it, and reset deletes
-- exactly these rows and nothing else.
--
-- SERVER-ONLY. RLS is enabled and forced with NO policies, so no browser JWT can read or write it
-- even if it learns the table name. The demo server reaches it over the owner connection it already
-- uses for reset.

create table if not exists demo_families (
  id           text primary key,
  persona_id   text not null unique,
  person_id    text not null unique,
  child_id     text not null unique,
  household_id text not null unique,
  village_id   text not null,
  email        text not null unique,
  auth_user_id text not null unique,
  parent_name  text not null,
  child_name   text not null,
  created_at   timestamptz not null default now()
);

alter table demo_families enable row level security;
alter table demo_families force row level security;

comment on table demo_families is
  'Demo families created at runtime. Sandbox only. Reset deletes these rows, their people/household/village data, the picker entry and the identity mapping.';
