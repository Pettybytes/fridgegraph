-- 0087 — pickup outreach: dispatch identity, allowance, suppression, reservations
--
-- Contract: docs/contracts/pickup-sms-dispatch.v1.md (v1.1) §2–§8 and
--           docs/contracts/pickup-message-inventory.v1.md
--
-- NEVER APPLIED. Forward-only once it is: this file is the single increment for the storage
-- and the atomic claim/reserve, so a later defect gets a NEW migration, not an edit to this one.
--
-- Caps are operator policy, enforced in the SEGMENT unit:
--   per run 50 · per recipient 15 · per America/Detroit day 150
-- plus a hard run backstop of $1.00 of segments (SEGMENT_PRICE_MICROS = 7900). At 50 segments the
-- segment cap binds first ($0.395); the dollar cap is a second, independent ceiling so raising or
-- mis-setting the segment cap cannot exceed $1, and a single run row can be tightened.
--
-- The crash rule this schema encodes:
--   A dispatch that has STARTED a provider handoff is never sendable again. The marker
--   (`handoff_started_at`) is written BEFORE the request and is not cleared by lease expiry,
--   restart, or a missing provider id. `provider_message_id IS NULL` therefore never means
--   "no handoff happened" — only `handoff_started_at IS NULL` does.

begin;

-- ─────────────────────────────────────────────────────────────── suppression
create table if not exists outreach_suppression (
  key        text primary key,
  reason     text not null check (reason in ('STOP','UNSUBSCRIBE','PROVIDER','MANUAL')),
  source     text not null,
  created_at timestamptz not null default now()
);

comment on table outreach_suppression is
  'Outreach opt-out ledger. EXCLUDED from demo reset, and delete/truncate are refused by trigger.';

-- ──────────────────────────────────────────────────────────────── dispatches
create table if not exists outreach_dispatch (
  dispatch_id         text primary key,
  run_id              text not null,
  attempt_id          text not null,
  candidate_id        text not null,
  job_version         integer not null check (job_version >= 0),
  message_kind        text not null default 'REQUEST'
                        check (message_kind in ('REQUEST','IDENTITY_PROMPT','NUDGE')),
  state               text not null default 'PENDING' check (state in
                        ('PENDING','CLAIMED','HANDOFF_STARTED','ACCEPTED','UNKNOWN',
                         'FAILED_FINAL','SUPPRESSED','RESPONDED')),
  claim_owner         text,
  claim_token         text,
  claimed_at          timestamptz,
  claim_expires_at    timestamptz,
  handoff_started_at  timestamptz,
  provider_message_id text,
  segments            integer not null default 0 check (segments >= 0),
  refusal_reason      text check (refusal_reason in
                        (null,'LIMIT_RUN','LIMIT_RECIPIENT','LIMIT_DAY','LIMIT_COST_RUN',
                         'SUPPRESSED','WINDOW','KILL_SWITCH')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- one dispatch per (attempt, candidate, version, KIND): a retry is not a new identity, and a
  -- follow-up kind can never borrow a request's identity or its reservation
  unique (attempt_id, candidate_id, job_version, message_kind),
  constraint outreach_handoff_marker_consistent check
    (state <> 'HANDOFF_STARTED' or handoff_started_at is not null),
  constraint outreach_provider_id_implies_handoff check
    (provider_message_id is null or handoff_started_at is not null),
  constraint outreach_accepted_has_provider_id check
    (state <> 'ACCEPTED' or provider_message_id is not null)
);

create unique index if not exists outreach_dispatch_provider_msg
  on outreach_dispatch (provider_message_id)
  where provider_message_id is not null;

create index if not exists outreach_dispatch_state_idx
  on outreach_dispatch (state, run_id);

comment on table outreach_dispatch is
  'One row per dispatch identity. HANDOFF_STARTED and UNKNOWN are never auto-resent; '
  'provider_message_id IS NULL does not prove no handoff.';

-- Deterministic identity helper: same inputs, same id. sha256(attempt, candidate, version, kind).
create or replace function outreach_dispatch_id(
  p_attempt_id text, p_candidate_id text, p_job_version integer, p_message_kind text default 'REQUEST'
) returns text language sql immutable as $$
  select encode(sha256(convert_to(
    p_attempt_id || '|' || p_candidate_id || '|' || p_job_version::text || '|' || p_message_kind, 'UTF8')), 'hex')
$$;

-- ─────────────────────────────────────────────────────────────── reservations
create table if not exists outreach_reservation (
  dispatch_id   text primary key references outreach_dispatch (dispatch_id) on delete restrict,
  segments      integer not null check (segments > 0),
  run_id        text not null,
  recipient_key text not null,
  day           date not null,
  cost_micros   bigint not null check (cost_micros > 0),
  created_at    timestamptz not null default now()
);

comment on table outreach_reservation is
  'Segment reservation, one per dispatch identity. HANDOFF_STARTED/UNKNOWN keep theirs; '
  're-inserting for the same dispatch is a no-op, which is what makes reclaim idempotent.';

-- ────────────────────────────────────────────────────────────────── allowance
-- RUN rows are keyed by the RUN's own start date (per run, not per day). DAY and RECIPIENT rows
-- reset on the America/Detroit calendar date.
create table if not exists outreach_allowance (
  scope_kind     text not null check (scope_kind in ('RUN','RECIPIENT','DAY')),
  scope_key      text not null,
  window_start   date not null,
  used_segments  integer not null default 0 check (used_segments >= 0),
  limit_segments integer not null check (limit_segments > 0),
  used_micros    bigint not null default 0 check (used_micros >= 0),
  limit_micros   bigint check (limit_micros is null or limit_micros > 0),
  primary key (scope_kind, scope_key, window_start)
);

comment on table outreach_allowance is
  'Segment allowance. Reserved before provider handoff; a retained reservation is never refunded.';

create or replace function outreach_default_limit(p_kind text) returns integer
language sql immutable set search_path = public as $$
  select case p_kind
    when 'RUN'       then 50
    when 'RECIPIENT' then 15
    when 'DAY'       then 150
  end
$$;

create or replace function outreach_segment_price_micros() returns bigint
language sql immutable set search_path = public as $$ select 7900::bigint $$;

create or replace function outreach_run_cost_cap_micros() returns bigint
language sql immutable set search_path = public as $$ select 1000000::bigint $$;

-- ───────────────────────────────────────────────────────── claim / reserve ──

create or replace function outreach_claim(
  p_dispatch_id text,
  p_owner text,
  p_lease_seconds integer default 60
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v outreach_dispatch;
  v_token text;
  v_reclaimed boolean := false;
begin
  if p_lease_seconds is null or p_lease_seconds < 5 or p_lease_seconds > 300 then
    raise exception 'BAD_LEASE' using errcode = '22023';
  end if;

  select * into v from outreach_dispatch where dispatch_id = p_dispatch_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'UNKNOWN_DISPATCH');
  end if;

  if v.handoff_started_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'HANDOFF_STARTED');
  end if;
  if v.provider_message_id is not null then
    return jsonb_build_object('ok', false, 'reason', 'PROVIDER_ID');
  end if;

  if v.state = 'PENDING' then
    null;
  elsif v.state = 'CLAIMED' and v.claim_expires_at is not null and v.claim_expires_at <= now() then
    v_reclaimed := true; -- expired PRE-handoff lease; the token rotates, fencing the old worker
  else
    return jsonb_build_object('ok', false, 'reason', 'NOT_CLAIMABLE', 'state', v.state);
  end if;

  v_token := gen_random_uuid()::text;
  update outreach_dispatch
     set state = 'CLAIMED',
         claim_owner = p_owner,
         claim_token = v_token,
         claimed_at = now(),
         claim_expires_at = now() + make_interval(secs => p_lease_seconds),
         updated_at = now()
   where dispatch_id = p_dispatch_id;

  return jsonb_build_object(
    'ok', true,
    'token', v_token,
    'expires_at', (now() + make_interval(secs => p_lease_seconds)),
    'reclaimed', v_reclaimed
  );
end $$;

/**
 * Reserve segments for this dispatch across RUN, RECIPIENT and DAY, plus the dollar backstop.
 *
 * Idempotent by dispatch identity: an existing reservation is returned and nothing is charged
 * again — the rule that keeps a reclaimed pre-handoff claim from reserving twice.
 *
 * `p_segments` is the candidate's own size. Counters compared here are the stored ones BEFORE
 * this reservation, matching `refusalFor`'s `used` semantics in src/outreach/policy.ts.
 */
create or replace function outreach_reserve(
  p_dispatch_id text,
  p_recipient_key text,
  p_segments integer,
  p_day date default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dispatch outreach_dispatch;
  v_day date;
  v_run_day date;
  v_existing integer;
  v_cost bigint;
  v_run_used integer;
  v_rec_used integer;
  v_day_used integer;
  v_micros bigint;
  v_run_limit integer := outreach_default_limit('RUN');
  v_rec_limit integer := outreach_default_limit('RECIPIENT');
  v_day_limit integer := outreach_default_limit('DAY');
  v_cap bigint := outreach_run_cost_cap_micros();
begin
  if p_segments is null or p_segments <= 0 then
    raise exception 'BAD_SEGMENTS' using errcode = '22023';
  end if;
  if p_recipient_key is null or length(p_recipient_key) < 32 then
    raise exception 'RECIPIENT_KEY_REQUIRED' using errcode = '22023';
  end if;

  select * into v_dispatch from outreach_dispatch where dispatch_id = p_dispatch_id for update;
  if not found then
    raise exception 'UNKNOWN_DISPATCH' using errcode = '22023';
  end if;

  select segments into v_existing from outreach_reservation where dispatch_id = p_dispatch_id;
  if found then
    return jsonb_build_object('ok', true, 'reserved', false, 'reused', true, 'segments', v_existing);
  end if;

  v_day := coalesce(p_day, (now() at time zone 'America/Detroit')::date);
  -- Per RUN, not per calendar day: a run that crosses midnight cannot refill its 50.
  v_run_day := (v_dispatch.created_at at time zone 'America/Detroit')::date;
  v_cost := p_segments::bigint * outreach_segment_price_micros();

  insert into outreach_allowance (scope_kind, scope_key, window_start, limit_segments, limit_micros)
  values ('DAY', 'America/Detroit', v_day, v_day_limit, null),
         ('RECIPIENT', p_recipient_key, v_day, v_rec_limit, null),
         ('RUN', v_dispatch.run_id, v_run_day, v_run_limit, v_cap)
  on conflict (scope_kind, scope_key, window_start) do nothing;

  -- Caps are read from the row so an operator can TIGHTEN a scope; `least()` with the default
  -- means a row can never be raised above the operator ceiling.
  select used_segments, used_micros,
         least(limit_segments, outreach_default_limit('RUN')),
         coalesce(limit_micros, outreach_run_cost_cap_micros())
    into v_run_used, v_micros, v_run_limit, v_cap
    from outreach_allowance
   where scope_kind = 'RUN' and scope_key = v_dispatch.run_id and window_start = v_run_day;

  select used_segments, least(limit_segments, outreach_default_limit('RECIPIENT'))
    into v_rec_used, v_rec_limit
    from outreach_allowance
   where scope_kind = 'RECIPIENT' and scope_key = p_recipient_key and window_start = v_day;

  select used_segments, least(limit_segments, outreach_default_limit('DAY'))
    into v_day_used, v_day_limit
    from outreach_allowance
   where scope_kind = 'DAY' and scope_key = 'America/Detroit' and window_start = v_day;

  -- Deterministic lock order: scope_kind, then window_start.
  perform 1 from outreach_allowance
   where (scope_kind = 'DAY' and scope_key = 'America/Detroit' and window_start = v_day)
      or (scope_kind = 'RECIPIENT' and scope_key = p_recipient_key and window_start = v_day)
      or (scope_kind = 'RUN' and scope_key = v_dispatch.run_id and window_start = v_run_day)
   order by scope_kind, window_start
   for update;

  if v_run_used + p_segments > v_run_limit then
    return jsonb_build_object('ok', false, 'reason', 'LIMIT_RUN', 'used', v_run_used, 'limit', v_run_limit);
  end if;
  if v_rec_used + p_segments > v_rec_limit then
    return jsonb_build_object('ok', false, 'reason', 'LIMIT_RECIPIENT', 'used', v_rec_used, 'limit', v_rec_limit);
  end if;
  if v_day_used + p_segments > v_day_limit then
    return jsonb_build_object('ok', false, 'reason', 'LIMIT_DAY', 'used', v_day_used, 'limit', v_day_limit);
  end if;
  if v_micros + v_cost > v_cap then
    return jsonb_build_object('ok', false, 'reason', 'LIMIT_COST_RUN', 'used_micros', v_micros, 'cap', v_cap);
  end if;

  insert into outreach_reservation (dispatch_id, segments, run_id, recipient_key, day, cost_micros)
  values (p_dispatch_id, p_segments, v_dispatch.run_id, p_recipient_key, v_day, v_cost);

  update outreach_allowance set used_segments = used_segments + p_segments
   where scope_kind = 'DAY' and scope_key = 'America/Detroit' and window_start = v_day;
  update outreach_allowance set used_segments = used_segments + p_segments
   where scope_kind = 'RECIPIENT' and scope_key = p_recipient_key and window_start = v_day;
  update outreach_allowance set used_segments = used_segments + p_segments, used_micros = used_micros + v_cost
   where scope_kind = 'RUN' and scope_key = v_dispatch.run_id and window_start = v_run_day;

  update outreach_dispatch set segments = p_segments, updated_at = now() where dispatch_id = p_dispatch_id;

  return jsonb_build_object('ok', true, 'reserved', true, 'reused', false, 'segments', p_segments,
                            'cost_micros', v_cost, 'day', v_day, 'run_day', v_run_day);
end $$;

-- ──────────────────────────────────────────────────── fenced state changes ──

/** MUST be called and MUST return true BEFORE the provider request. */
create or replace function outreach_mark_handoff(p_dispatch_id text, p_token text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v integer;
begin
  update outreach_dispatch
     set state = 'HANDOFF_STARTED', handoff_started_at = now(), updated_at = now()
   where dispatch_id = p_dispatch_id
     and claim_token = p_token
     and state = 'CLAIMED'
     and handoff_started_at is null
     and claim_expires_at > now();
  get diagnostics v = row_count;
  return v = 1;
end $$;

/** Fenced accept. A worker whose token was rotated away cannot record the outcome. */
create or replace function outreach_mark_accepted(p_dispatch_id text, p_token text, p_provider_message_id text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v integer;
begin
  if p_provider_message_id is null or length(p_provider_message_id) = 0 then
    raise exception 'PROVIDER_ID_REQUIRED' using errcode = '22023';
  end if;
  update outreach_dispatch
     set state = 'ACCEPTED', provider_message_id = p_provider_message_id,
         claim_expires_at = null, updated_at = now()
   where dispatch_id = p_dispatch_id
     and claim_token = p_token
     and state = 'HANDOFF_STARTED'
     and handoff_started_at is not null;
  get diagnostics v = row_count;
  return v = 1;
end $$;

/**
 * Record an uncertain outcome. The fenced worker may call it with its token; an operator path
 * passes NULL for a dispatch a crash left HANDOFF_STARTED. The result is UNKNOWN either way.
 */
create or replace function outreach_mark_unknown(p_dispatch_id text, p_token text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v integer;
begin
  update outreach_dispatch
     set state = 'UNKNOWN', claim_expires_at = null, updated_at = now()
   where dispatch_id = p_dispatch_id
     and state = 'HANDOFF_STARTED'
     and (p_token is null or claim_token = p_token);
  get diagnostics v = row_count;
  return v = 1;
end $$;

-- ──────────────────────────────────────────────────── safety-record guard ──
-- Reset preservation is ENFORCED, not requested. A demo reset runs as the table owner, where RLS
-- alone would not stop it; a statement trigger does.
create or replace function outreach_safety_record_refusal() returns trigger
language plpgsql as $$
begin
  raise exception 'OUTREACH_SAFETY_RECORD: % on % is refused (suppression, allowance, dispatch identity and reservations are never deleted)',
    tg_op, tg_table_name
    using errcode = '42501';
end $$;

do $$
declare t text;
begin
  foreach t in array array['outreach_suppression','outreach_allowance','outreach_reservation','outreach_dispatch']
  loop
    execute format('drop trigger if exists %I on %I', t || '_no_delete', t);
    execute format(
      'create trigger %I before delete or truncate on %I for each statement execute function outreach_safety_record_refusal()',
      t || '_no_delete', t);
  end loop;
end $$;

-- ───────────────────────────────────────────────────────────── row security ──
-- Operator-only records. Demo callers get no grant and no policy — denied by default, and no RPC
-- path either (EXECUTE is revoked). ENABLE, not FORCE: the migration role owns these tables and
-- the public boundary is the revoke plus the absence of policies, not the owner.
alter table outreach_suppression enable row level security;
alter table outreach_dispatch    enable row level security;
alter table outreach_allowance   enable row level security;
alter table outreach_reservation enable row level security;

revoke all on table outreach_suppression from public, anon, authenticated;
revoke all on table outreach_dispatch    from public, anon, authenticated;
revoke all on table outreach_allowance   from public, anon, authenticated;
revoke all on table outreach_reservation from public, anon, authenticated;

revoke all on function outreach_claim(text, text, integer) from public, anon, authenticated;
revoke all on function outreach_reserve(text, text, integer, date) from public, anon, authenticated;
revoke all on function outreach_mark_handoff(text, text) from public, anon, authenticated;
revoke all on function outreach_mark_accepted(text, text, text) from public, anon, authenticated;
revoke all on function outreach_mark_unknown(text, text) from public, anon, authenticated;
revoke all on function outreach_default_limit(text) from public, anon, authenticated;
revoke all on function outreach_dispatch_id(text, text, integer, text) from public, anon, authenticated;

-- The operator (dispatcher) role. Present in Supabase; guarded so a bare Postgres rehearsal can
-- create it explicitly instead of failing the migration.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update on outreach_suppression to service_role;
    grant select, insert, update on outreach_dispatch    to service_role;
    grant select, insert, update on outreach_allowance   to service_role;
    grant select, insert         on outreach_reservation to service_role;
    grant execute on function outreach_claim(text, text, integer) to service_role;
    grant execute on function outreach_reserve(text, text, integer, date) to service_role;
    grant execute on function outreach_mark_handoff(text, text) to service_role;
    grant execute on function outreach_mark_accepted(text, text, text) to service_role;
    grant execute on function outreach_mark_unknown(text, text) to service_role;
    grant execute on function outreach_dispatch_id(text, text, integer, text) to service_role;
  end if;
end $$;

commit;
