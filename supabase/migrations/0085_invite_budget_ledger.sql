-- 0085 — Invites (slim) FIRST SLICE: per-child generation budget + private usage/cost ledger.
-- STAGED ONLY — never applied by this PR. Forward-only; 0001-0084 never edited.
--
-- Money-adjacent (AGENTS.md §1.6: senior-only, Claude only on explicit instruction, human review
-- required before any apply) AND schema/data (AGENTS.md: senior-only, forward-only, never rewrite
-- an applied migration). Both apply here — this migration stays unapplied until reviewed.
--
-- Replaces the existing process-wide, in-memory GenerationBudget (src/rosina/inviteBudget.ts) —
-- which is NOT per-child and does not survive a process restart or record anything — with a real
-- per-CHILD daily budget and a private, append-only ledger. Scoped to the CHILD, not a household:
-- a co-parented child (two households, e.g. p_nora's h_a/h_b) shares ONE budget regardless of
-- which parent is asking, since the invitation is for that child's party either way and a
-- per-household split would let the same party be re-generated twice for free by switching
-- parents. Documented accurately as per-CHILD throughout — not "per family," which this PR never
-- implements. Documented in docs/contracts/invites.md.
--
-- Cost model: Muse Image is priced at **$0.01 per generated image**, per Meta's published docs —
-- a real, current, citable figure, not modeled on a third-party comparable. Default cap
-- $1.00/child/day -> 100 generations/day, overridable per child's household via the EXISTING
-- household_policies mechanism (same table `ride_cost_cap_usd` already uses), rule
-- 'invite_daily_budget_usd'. The cost-per-generation is a SQL constant (`v_cost_usd` in
-- invite_budget_reserve below) — never a caller-supplied argument. See "server-side only" below.
--
-- Cache hits are not paid generations. The live image client (src/rosina/inviteImage.ts) caches
-- by prompt hash; a cache hit returns the same bytes without a new provider call and is NOT
-- billed. invite_budget_settle takes a `p_cached` FACT (observed by the caller, not a price) and
-- the function itself — never the caller — decides the actual charged cost: $0.00 on any cache
-- hit or non-SUCCEEDED outcome, the full reserved $0.01 only for a real, uncached, successful
-- generation.
--
-- Uncertain outcomes are charged conservatively, not refunded by default. A provider call can
-- fail in two meaningfully different ways: (1) CONFIRMED not billed — the provider responded with
-- a clear error status before any image was produced; safe to release. (2) UNCERTAIN — a network
-- timeout/abort AFTER the request was sent, or a local validation failure on an otherwise-200
-- response (e.g. an oversized or malformed body) — the provider may well have generated (and
-- billed for) the image even though this process never got a usable result. invite_budget_settle
-- accepts 'UNCERTAIN' as a third terminal status: like SUCCEEDED, it stays counted in today's
-- spend (never refunded); unlike SUCCEEDED, it is never shown as a delivered asset anywhere.
--
-- Cost and settlement are decided SERVER-SIDE ONLY. Neither invite_budget_reserve nor
-- invite_budget_settle accepts a caller-supplied dollar figure — reserve charges the one fixed
-- per-generation constant; settle computes the ACTUAL charged cost itself from (status, cached),
-- never from an argument. The caller conveys FACTS about what it observed (which of the three
-- closed outcomes occurred; whether this was a cache hit) — it never sets a price, and the set of
-- valid outcomes is closed (PENDING/SUCCEEDED/FAILED/UNCERTAIN), not a free-form string.
--
-- Never reset: NOT added to ID_TABLES/RESET_SCOPED/SANDBOX_TABLES in src/demo/reset.ts, so
-- resetDemo() never touches it — a demo reset must not reset the spending ledger (proof:
-- ops/invite-budget-proof.mjs).
--
-- Private: no select/insert/update/delete grant to `authenticated` at all. Every access is
-- through the two RPCs below (reserve/settle), both parent-authorized, both returning ONLY a
-- boolean + a remaining-dollar figure for THIS child — never another family's data, never a
-- model name, prompt, hash or raw cost figure to any client. Matches "keep credentials and
-- provider accounting out of client responses" exactly.
--
-- SETTLEMENT IS TRUSTED SERVER WORK, NOT A CALLER-REPORTED FACT. Removing `p_cost_usd` and
-- closing `status` to an enum (done in the prior correction round) stops a caller from naming
-- its own PRICE, but it does nothing to stop the reservation's own legitimate owner from calling
-- invite_budget_settle directly (via GraphQL OR this RPC) and simply LYING about the outcome —
-- claiming FAILED, or SUCCEEDED+cached:true, to falsely release/zero a reservation that was in
-- fact a real, billed, uncached generation. `status`/`cached` are genuinely knowable ONLY by
-- whoever made the real provider call — Rosina's own backend process
-- (src/rosina/inviteLedgerBudget.ts) — which holds a secret no browser, no ordinary authenticated
-- caller, and no direct RPC caller ever has. `invite_budget_settle` therefore requires a 6th
-- argument, `p_proof`: hmac-sha256 of the settlement facts, keyed with a secret configured here
-- as the `app.invite_settlement_hmac_secret` database setting (set OUT OF BAND when 0085 is
-- applied — e.g. `alter database postgres set app.invite_settlement_hmac_secret = '<secret>'` —
-- matching Rosina's own `INVITE_SETTLEMENT_HMAC_SECRET` env var; never written into any migration
-- file). An unset secret or any proof mismatch fails CLOSED (uniform `false`, same as an unowned
-- or already-settled reservation — no oracle distinguishing why a settle attempt was refused).
-- This protects BOTH interfaces identically: the check lives inside the SQL function itself, so
-- it cannot be bypassed by calling the RPC directly instead of going through GraphQL, and it is
-- not a UI-only restriction — see ops/invite-budget-proof.mjs's forged-proof checks.

begin;

create extension if not exists pgcrypto;

create table if not exists invite_generations (
  id             text primary key default ('ig_' || substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 20)),
  child_id       text not null references children(person_id),
  person_id      text not null references people(id),
  status         text not null check (status in ('PENDING', 'SUCCEEDED', 'FAILED', 'UNCERTAIN')),
  source         text not null check (source in ('MUSE_IMAGE', 'FIXTURE')),
  model          text,
  prompt_hash    text not null,
  output_sha256  text,
  cached         boolean not null default false,
  -- The ACTUAL charged amount, computed server-side at settle time (or at reserve time for the
  -- conservative PENDING estimate) — never a value the caller supplied directly.
  cost_usd       numeric(8,4) not null check (cost_usd >= 0),
  created_at     timestamptz not null default now(),
  settled_at     timestamptz
);

-- Today's (America/Detroit) spend for a child is everything NOT confirmed-free: PENDING (an
-- in-flight reservation, charged conservatively until settled), SUCCEEDED (real spend, $0 only if
-- it was a cache hit), and UNCERTAIN (the provider may have billed — charged conservatively, never
-- refunded by default). Only a CONFIRMED FAILED generation (a clean provider error, never reached
-- generation) costs nothing and is excluded.
create index if not exists invite_generations_child_day_idx
  on invite_generations (child_id, status, created_at);

alter table invite_generations enable row level security;
alter table invite_generations force row level security;
revoke all on invite_generations from public, anon, authenticated;

-- Reserve BEFORE the image call (mirrors the old GenerationBudget.tryConsume()): inserts a
-- PENDING row counted toward today's cap immediately, so two concurrent requests for the same
-- child cannot both pass the check before either writes. pg_advisory_xact_lock serializes
-- concurrent callers for the SAME child only; a different child's request is never blocked by
-- this one. The per-generation cost is a FIXED SERVER-SIDE CONSTANT — $0.01, Muse Image's real
-- published per-image price — never a caller argument.
create or replace function invite_budget_reserve(
  p_child text, p_source text, p_prompt_hash text
) returns table (allowed boolean, generation_id text, remaining_usd numeric)
language plpgsql security definer set search_path = public as $$
declare
  v_cost_usd constant numeric := 0.01; -- Muse Image, per-generated-image, per Meta's published docs
  v_cap numeric; v_used numeric; v_today date; v_id text;
begin
  if current_person() is null then raise exception 'UNAUTHENTICATED'; end if;
  if not is_parent_of(p_child) then raise exception 'UNAUTHORIZED'; end if;
  if p_source not in ('MUSE_IMAGE', 'FIXTURE') then raise exception 'BAD_SOURCE'; end if;

  perform pg_advisory_xact_lock(hashtext('invite_budget:' || p_child));

  v_cap := coalesce(
    (select hp.value::numeric from household_policies hp
       join household_members hm on hm.household_id = hp.household_id
      where hm.person_id = p_child and hp.rule = 'invite_daily_budget_usd'
      order by hp.household_id limit 1),
    1.00
  );
  v_today := (now() at time zone 'America/Detroit')::date;
  select coalesce(sum(cost_usd), 0) into v_used
    from invite_generations
   where child_id = p_child and status in ('PENDING', 'SUCCEEDED', 'UNCERTAIN')
     and (created_at at time zone 'America/Detroit')::date = v_today;

  if v_used + v_cost_usd > v_cap then
    return query select false, null::text, greatest(v_cap - v_used, 0);
    return;
  end if;

  insert into invite_generations (child_id, person_id, status, source, prompt_hash, cost_usd)
  values (p_child, current_person(), 'PENDING', p_source, p_prompt_hash, v_cost_usd)
  returning id into v_id;

  return query select true, v_id, greatest(v_cap - v_used - v_cost_usd, 0);
end $$;

revoke all on function invite_budget_reserve(text, text, text) from public, anon;
grant execute on function invite_budget_reserve(text, text, text) to authenticated;

-- Settle AFTER the image call resolves. The caller reports FACTS — which of the three closed
-- outcomes occurred, and whether this was a cache hit — never a price. This function alone
-- decides the actual charged cost_usd:
--   SUCCEEDED, cached      -> $0.00  (no new provider call was made)
--   SUCCEEDED, not cached  -> the reserved $0.01 (the real, billed generation)
--   UNCERTAIN (either way) -> the reserved $0.01, UNCHANGED — the provider may have billed for it,
--                              so it is charged conservatively, never refunded by default
--   FAILED                 -> $0.00  (a CONFIRMED pre-generation refusal — the caller is only
--                              expected to report FAILED when it is certain nothing was billed;
--                              see src/rosina/inviteImage.ts's error classification)
-- Caller must own the reservation (own person_id) — a forged generation_id from another caller's
-- reservation is refused. A reservation can be settled exactly ONCE (status must still be
-- PENDING) — settling an already-terminal reservation again is refused, so a caller cannot
-- replay/override a prior outcome.
--
-- p_proof: hmac-sha256(secret, generation|status|cached|model|output_sha256), keyed with the
-- `app.invite_settlement_hmac_secret` database setting — a secret only Rosina's own backend
-- process holds (see the top-of-file note). Ownership of the reservation is necessary but NOT
-- sufficient: even the reservation's own legitimate owner is refused without a valid proof, so a
-- caller cannot simply claim FAILED or cached:true to falsely release/zero a real charge.
create or replace function invite_budget_settle(
  p_generation text, p_status text, p_model text, p_output_sha256 text, p_cached boolean, p_proof text
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_updated int; v_actual_cost numeric; v_reserved numeric;
  v_secret text; v_message text; v_expected text;
begin
  if current_person() is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_status not in ('SUCCEEDED', 'FAILED', 'UNCERTAIN') then raise exception 'BAD_STATUS'; end if;

  -- Fails CLOSED: an unconfigured secret or any proof mismatch refuses the settle, identically
  -- to an unowned or already-settled reservation (uniform `false` — no oracle for which check
  -- failed). This runs BEFORE touching the row at all, so a forged settle attempt never even
  -- locks a reservation it has no valid claim to.
  v_secret := current_setting('app.invite_settlement_hmac_secret', true);
  if v_secret is null or v_secret = '' then return false; end if;
  v_message := p_generation || '|' || p_status || '|' || p_cached::text || '|' || coalesce(p_model, '') || '|' || coalesce(p_output_sha256, '');
  v_expected := encode(hmac(v_message, v_secret, 'sha256'), 'hex');
  if p_proof is distinct from v_expected then return false; end if;

  select cost_usd into v_reserved from invite_generations
   where id = p_generation and person_id = current_person() and status = 'PENDING'
   for update;
  if v_reserved is null then return false; end if;

  v_actual_cost := case
                     when p_status = 'FAILED' then 0
                     when p_status = 'SUCCEEDED' and p_cached then 0
                     else v_reserved -- SUCCEEDED (not cached), or UNCERTAIN: charged conservatively
                   end;

  update invite_generations
     set status = p_status, model = p_model, output_sha256 = p_output_sha256,
         cached = p_cached, cost_usd = v_actual_cost, settled_at = now()
   where id = p_generation and person_id = current_person() and status = 'PENDING';
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end $$;

revoke all on function invite_budget_settle(text, text, text, text, boolean, text) from public, anon;
grant execute on function invite_budget_settle(text, text, text, text, boolean, text) to authenticated;

commit;
