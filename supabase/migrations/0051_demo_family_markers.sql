-- 0051 — an aborted family creation must never strand a Supabase Auth user.
--
-- Before this, a family that crashed before writing its mapping left an auth account that no sweep
-- could see: `purgeFamilyArtifacts` only walks accounts reachable through a file entry, and an aborted
-- run never writes one. Those accounts are unmapped on BOTH paths, so they resolve to nobody — but
-- they exist forever (four had accumulated, one per fault-injection run).
--
-- Fix: the registry row is written FIRST, as a `pending` marker carrying the email, and only becomes
-- `active` once the family is fully committed. A crash at any point therefore leaves a reconcilable
-- marker with the email needed to find (and delete) the account.

alter table demo_families alter column auth_user_id drop not null;

alter table demo_families add column if not exists status text not null default 'active';
alter table demo_families add column if not exists aborted_at timestamptz;
alter table demo_families add column if not exists reconciled_at timestamptz;

comment on column demo_families.status is
  'pending = creation started (reconcilable marker), active = fully created, aborted = abandoned by a crash.';
comment on column demo_families.auth_user_id is
  'NULL while status = pending: the marker is written before the auth user exists, so a crash still leaves a handle.';

create index if not exists demo_families_pending on demo_families (created_at) where status <> 'active';
