-- 0087 — pickup outreach: dispatch identity, allowance, suppression
--
-- Contract: docs/contracts/pickup-sms-dispatch.v1.md (v1.1) and
--           docs/contracts/pickup-message-inventory.v1.md
--
-- Caps are operator policy, enforced in the SEGMENT unit:
--   per run 50 · per recipient 15 · per America/Detroit day 150
--
-- This migration adds storage only. The atomic claim/reserve function is the next
-- increment and must reserve in ONE transaction with the claim.

begin;

-- ---------------------------------------------------------------- suppression
-- Lookup key is a server-keyed HMAC of the E.164 number. The raw number is never
-- stored here.
create table if not exists outreach_suppression (
  key        text primary key,
  reason     text not null check (reason in ('STOP','UNSUBSCRIBE','PROVIDER','MANUAL')),
  source     text not null,
  created_at timestamptz not null default now()
);

-- Demo reset must not clear this table. Guarded explicitly rather than by convention.
comment on table outreach_suppression is
  'Outreach opt-out ledger. EXCLUDED from demo reset. Never truncated.';

-- ---------------------------------------------------------------- dispatches
create table if not exists outreach_dispatch (
  dispatch_id         text primary key,
  run_id              text not null,
  attempt_id          text not null,
  candidate_id        text not null,
  job_version         integer not null check (job_version >= 0),
  state               text not null check (state in
                        ('PENDING','CLAIMED','ACCEPTED','UNKNOWN','FAILED_FINAL','SUPPRESSED','RESPONDED')),
  claimed_by          text,
  claimed_at          timestamptz,
  claim_expires_at    timestamptz,
  provider_message_id text,
  segments            integer not null default 0 check (segments >= 0),
  refusal_reason      text check (refusal_reason in (null,'LIMIT_RUN','LIMIT_RECIPIENT','LIMIT_DAY','SUPPRESSED','WINDOW','KILL_SWITCH')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- one dispatch per (attempt, candidate, version): a retry is not a new identity
  unique (attempt_id, candidate_id, job_version)
);

-- A provider message may back exactly one dispatch.
create unique index if not exists outreach_dispatch_provider_msg
  on outreach_dispatch (provider_message_id)
  where provider_message_id is not null;

create index if not exists outreach_dispatch_state_idx
  on outreach_dispatch (state, run_id);

comment on table outreach_dispatch is
  'One row per dispatch identity. UNKNOWN is a terminal-ish recorded fact and is never auto-resent.';

-- ---------------------------------------------------------------- allowance
-- Counters keyed by scope so caps are enforced by atomic UPDATE ... WHERE used+n <= limit.
-- window_start is the America/Detroit calendar date for RUN/RECIPIENT/DAY scopes.
create table if not exists outreach_allowance (
  scope_kind     text not null check (scope_kind in ('RUN','RECIPIENT','DAY')),
  scope_key      text not null,
  window_start   date not null,
  used_segments  integer not null default 0 check (used_segments >= 0),
  limit_segments integer not null check (limit_segments > 0),
  primary key (scope_kind, scope_key, window_start)
);

comment on table outreach_allowance is
  'Segment allowance. Reserved before provider handoff; UNKNOWN keeps its reservation.';

-- Seed the operator caps as defaults for a new window; callers may not raise them at runtime.
create or replace function outreach_default_limit(p_kind text) returns integer
language sql immutable as $$
  select case p_kind
    when 'RUN'       then 50
    when 'RECIPIENT' then 15
    when 'DAY'       then 150
  end
$$;

commit;
