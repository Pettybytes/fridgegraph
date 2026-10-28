-- 0013 — Station 06: the coordination schema the pickup job needs.
--
-- Source of truth: docs/contracts/pickup-job.md (Rev 3) and docs/contracts/webhook.md at ad188f2.
-- Everything here is ADDITIVE. Nothing is dropped, renamed, or rewritten: no existing column
-- changes type, no existing policy is replaced, no existing table is touched beyond new nullable
-- columns and one new NOT VALID check on a table that is empty by design.
--
-- What this adds, and why:
--   * coordination_jobs: request_version (separate from the optimistic `version`), the two per-job
--     timeouts, and failure_reason so `failed` is never a bare status.
--   * attempts: candidate, destination + destinationMode (the three-way UI badge), provider message
--     id for dedupe, late_reply for audit — the contract's Attempt is unusable for correlation
--     without these.
--   * confirmations: candidate + approved_by — a Confirmation must say WHO was approved and WHICH
--     parent approved, or it cannot be distinguished from an adult's acceptance.
--   * candidate_evaluations: the per-candidate record carrying exactly one of the 8 reason codes,
--     plus the ride-cost fields and acceptedVia. This is the table the whole ranking reads.
--   * the partial unique index that makes "at most one active recommendation per (job,
--     request_version)" a DATABASE guarantee rather than a race in application code.
--   * real_call_authorizations: the second real-call gate. Single-use is enforced by an atomic
--     UPDATE ... WHERE consumed_at IS NULL AND expires_at > now(), never by check-then-write.
--   * locations: the canonical Location model (pickup-job.md §6), village-owned, behind address.read.
--   * two idempotent data rows the demo needs: Kendra's $10 ride cap and Angela's address.read grant.
--
-- Rollback is at the bottom of this file and is exact.

begin;

-- ---------------------------------------------------------------------------
-- 1. Existing tables: nullable additions only
-- ---------------------------------------------------------------------------

alter table coordination_jobs
  add column if not exists request_version            int  not null default 1,
  add column if not exists discovery_timeout_seconds  int  not null default 60,
  add column if not exists approval_timeout_seconds   int  not null default 120,
  add column if not exists failure_reason             text;

-- Empty by design (see data-model.md §2); NOT VALID keeps this additive for any stray row.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'coordination_jobs_status_check'
  ) then
    alter table coordination_jobs
      add constraint coordination_jobs_status_check
      check (status in ('pending','discovering','awaiting_approval','confirmed','failed'))
      not valid;
  end if;
end $$;

alter table attempts
  add column if not exists candidate_id        text references people(id) on delete cascade,
  add column if not exists destination         text,
  add column if not exists destination_mode    text not null default 'TEST_RESPONDER',
  add column if not exists provider_message_id text,
  add column if not exists late_reply          boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'attempts_destination_mode_check') then
    alter table attempts
      add constraint attempts_destination_mode_check
      check (destination_mode in ('TEST_RESPONDER','REAL_CONSENTED'))
      not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'attempts_channel_check') then
    alter table attempts
      add constraint attempts_channel_check
      check (channel in ('SMS','CALL'))
      not valid;
  end if;
end $$;

alter table confirmations
  add column if not exists candidate_id text references people(id) on delete cascade,
  add column if not exists approved_by  text references people(id);

-- ---------------------------------------------------------------------------
-- 2. candidate_evaluations — one row per (job, candidate), exactly one reason code
-- ---------------------------------------------------------------------------

create table if not exists candidate_evaluations (
  id                  text primary key,
  job_id              text not null references coordination_jobs(id) on delete cascade,
  request_version     int  not null default 1,
  candidate_id        text not null references people(id) on delete cascade,
  reason_code         text not null check (reason_code in (
                        'UNAUTHORIZED',
                        'NO_VERIFIED_CONTACT_METHOD',
                        'UNREACHABLE',
                        'UNAVAILABLE',
                        'AVAILABLE_NO_TRANSPORT',
                        'OVER_POLICY',
                        'RECOMMENDED',
                        'APPROVAL_PENDING'
                      )),
  available           boolean,                              -- null = UNKNOWN, never inferred
  decline_reason      text check (decline_reason in ('BUSY','NO_TRANSPORT','OTHER')),
  accepted_via        text check (accepted_via in ('WEBHOOK_CALLBACK','CANDIDATE_JWT')),
  estimated_ride_cost_usd numeric(10,2),
  cost_basis          text,
  distance_miles      numeric(6,2),
  location_provenance text check (location_provenance in ('SUPPLIED','ESTIMATED','VERIFIED')),
  cost_calculated_at  timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (job_id, request_version, candidate_id)
);

-- The contract's "at most one active recommendation per (job, request_version)" as a DB guarantee.
create unique index if not exists candidate_evaluations_one_active_recommendation
  on candidate_evaluations (job_id, request_version)
  where reason_code in ('RECOMMENDED','APPROVAL_PENDING');

-- ---------------------------------------------------------------------------
-- 3. real_call_authorizations — gate 2. Server-side only.
-- ---------------------------------------------------------------------------

create table if not exists real_call_authorizations (
  id            text primary key,
  attempt_id    text not null references attempts(id) on delete cascade,
  recipient_ref text not null,          -- a GHL-side identifier; never a literal number
  issued_at     timestamptz not null default now(),
  expires_at    timestamptz not null,
  consumed_at   timestamptz,
  constraint real_call_authorizations_expiry_after_issue check (expires_at > issued_at)
);

-- Single-use is claimed by this statement shape, not by application logic:
--   update real_call_authorizations
--      set consumed_at = now()
--    where id = $1 and attempt_id = $2 and consumed_at is null and expires_at > now()
--   returning id;
-- Zero rows returned = no call. There is no read-then-write window.

-- ---------------------------------------------------------------------------
-- 4. locations — the canonical model, village-owned (pickup-job.md §6)
-- ---------------------------------------------------------------------------

create table if not exists locations (
  id          text primary key,
  owner_type  text not null check (owner_type in ('CHILD','PERSON','PLACE')),
  owner_id    text not null,
  label       text,
  lat         double precision not null check (lat between -90 and 90),
  lng         double precision not null check (lng between -180 and 180),
  source      text not null check (source in ('SUPPLIED','ESTIMATED','VERIFIED')),
  captured_at timestamptz not null
);

-- ---------------------------------------------------------------------------
-- 5. RLS — on, and forced, for every new table
-- ---------------------------------------------------------------------------

alter table candidate_evaluations      enable row level security;
alter table candidate_evaluations      force  row level security;
alter table real_call_authorizations   enable row level security;
alter table real_call_authorizations   force  row level security;
alter table locations                  enable row level security;
alter table locations                  force  row level security;

-- Parents read the evaluations for their own child's job; a candidate may read their own row.
create policy candidate_evaluations_read on candidate_evaluations for select to authenticated
  using (
    candidate_id = current_person()
    or exists (
      select 1 from coordination_jobs j
       where j.id = candidate_evaluations.job_id and is_parent_of(j.child_id)
    )
  );

-- Locations: the child's parents, or anyone holding address.read for that child.
create policy locations_read on locations for select to authenticated
  using (
    owner_type = 'CHILD'
    and (is_parent_of(owner_id) or has_scope(owner_id, 'address.read'))
  );

-- real_call_authorizations intentionally has NO policy: it is service-role only, like identity_map.

-- ---------------------------------------------------------------------------
-- 6. Grants — explicit, anon revoked, consistent with 0012/0004
-- ---------------------------------------------------------------------------

revoke all on candidate_evaluations      from anon;
revoke all on real_call_authorizations   from anon;
revoke all on locations                  from anon;
revoke all on real_call_authorizations   from authenticated;

grant select on locations to authenticated;
grant select on candidate_evaluations to authenticated;

-- The job writes as the caller's identity (pickup-job.md §11), so the coordination mutation tables
-- need write grants for `authenticated`. RLS remains the boundary; without these the write fails at
-- 403 before any policy runs. This is the only privilege widening in this migration.
grant insert, update on coordination_jobs      to authenticated;
grant insert, update on attempts               to authenticated;
grant insert, update on confirmations          to authenticated;
grant insert, update on candidate_evaluations  to authenticated;
grant insert, update on information_requests   to authenticated;

grant all privileges on all tables in schema public to service_role;

-- ---------------------------------------------------------------------------
-- 7. Data the demo needs — idempotent, safe to re-run
-- ---------------------------------------------------------------------------

insert into household_policies (household_id, rule, value)
values ('h_a', 'ride_cost_cap_usd', '10')
on conflict (household_id, rule) do nothing;

insert into grants (id, actor_id, child_id, scopes, valid_from, valid_until, granted_by)
values ('g_price_address_read', 'p_price', 'p_nora', array['address.read'], null, null, 'p_mom')
on conflict (id) do nothing;

commit;

-- ---------------------------------------------------------------------------
-- Rollback (exact; run only with Bryan's approval, on a database you may change)
-- ---------------------------------------------------------------------------
-- begin;
--   delete from grants where id = 'g_price_address_read';
--   delete from household_policies where household_id = 'h_a' and rule = 'ride_cost_cap_usd';
--   revoke insert, update on information_requests, candidate_evaluations, confirmations,
--          attempts, coordination_jobs from authenticated;
--   revoke select on candidate_evaluations, locations from authenticated;
--   revoke all on real_call_authorizations from authenticated, anon;
--   revoke all on locations, candidate_evaluations from anon;
--   drop table if exists real_call_authorizations;
--   drop index if exists candidate_evaluations_one_active_recommendation;
--   drop table if exists candidate_evaluations;
--   drop table if exists locations;
--   alter table confirmations drop column if exists approved_by, drop column if exists candidate_id;
--   alter table attempts drop constraint if exists attempts_channel_check;
--   alter table attempts drop constraint if exists attempts_destination_mode_check;
--   alter table attempts drop column if exists late_reply, drop column if exists provider_message_id,
--                       drop column if exists destination_mode, drop column if exists destination,
--                       drop column if exists candidate_id;
--   alter table coordination_jobs drop constraint if exists coordination_jobs_status_check;
--   alter table coordination_jobs drop column if exists failure_reason,
--                                drop column if exists approval_timeout_seconds,
--                                drop column if exists discovery_timeout_seconds,
--                                drop column if exists request_version;
-- commit;
--
-- Note: dropping candidate_evaluations destroys job history. On the shared demo database that is
-- acceptable only before the first real job; after that, roll forward instead of back.
