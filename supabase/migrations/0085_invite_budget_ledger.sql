-- 0085 — Invites (slim) FIRST SLICE: per-child generation budget + private usage/cost ledger.
-- STAGED ONLY — never applied by this PR. Forward-only; 0001-0084 never edited.
--
-- Money-adjacent (AGENTS.md §1.6: senior-only, Claude only on explicit instruction, human review
-- required before any apply) AND schema/data (AGENTS.md: senior-only, forward-only, never rewrite
-- an applied migration). Both apply here — this migration stays unapplied until reviewed.
--
-- Replaces the existing process-wide, in-memory GenerationBudget (src/rosina/inviteBudget.ts) —
-- which is NOT per-family and does not survive a process restart or record anything — with a
-- real per-CHILD daily budget and a private, append-only ledger. "Per family" is scoped to the
-- CHILD, not a household: a co-parented child (two households, e.g. p_nora's h_a/h_b) shares ONE
-- budget regardless of which parent is asking, since the invitation is for that child's party
-- either way and a per-household split would let the same party be re-generated twice for free
-- by switching parents. Documented in docs/contracts/invites.md.
--
-- Cost model: Muse Image has no public price list (it is this project's own fictional provider
-- abstraction, mirroring the OpenAI-compatible Images shape — src/rosina/inviteImage.ts). Modeled
-- on DALL-E 3's published Standard 1024x1024 price ($0.04/image, the same resolution this
-- endpoint requests) since that is the closest real, currently-published comparable. Default cap
-- $1.00/child/day -> 25 generations/day, overridable per child's household via the EXISTING
-- household_policies mechanism (same table `ride_cost_cap_usd` already uses), rule
-- 'invite_daily_budget_usd'.
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

begin;

create table if not exists invite_generations (
  id             text primary key default ('ig_' || substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 20)),
  child_id       text not null references children(person_id),
  person_id      text not null references people(id),
  status         text not null check (status in ('PENDING', 'SUCCEEDED', 'FAILED')),
  source         text not null check (source in ('MUSE_IMAGE', 'FIXTURE')),
  model          text,
  prompt_hash    text not null,
  output_sha256  text,
  cost_usd       numeric(8,4) not null check (cost_usd >= 0),
  created_at     timestamptz not null default now(),
  settled_at     timestamptz
);

-- Today's (America/Detroit) spend for a child is PENDING+SUCCEEDED only — a FAILED generation
-- (the image call errored, or the PII guard refused it) cost nothing and is excluded, same
-- refund semantics the existing in-memory budget already has.
create index if not exists invite_generations_child_day_idx
  on invite_generations (child_id, status, created_at);

alter table invite_generations enable row level security;
alter table invite_generations force row level security;
revoke all on invite_generations from public, anon, authenticated;

-- Reserve BEFORE the image call (mirrors GenerationBudget.tryConsume()): inserts a PENDING row
-- counted toward today's cap immediately, so two concurrent requests for the same child cannot
-- both pass the check before either writes. pg_advisory_xact_lock serializes concurrent callers
-- for the SAME child only; a different child's request is never blocked by this one.
create or replace function invite_budget_reserve(
  p_child text, p_cost_usd numeric, p_source text, p_prompt_hash text
) returns table (allowed boolean, generation_id text, remaining_usd numeric)
language plpgsql security definer set search_path = public as $$
declare v_cap numeric; v_used numeric; v_today date; v_id text;
begin
  if current_person() is null then raise exception 'UNAUTHENTICATED'; end if;
  if not is_parent_of(p_child) then raise exception 'UNAUTHORIZED'; end if;

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
   where child_id = p_child and status in ('PENDING', 'SUCCEEDED')
     and (created_at at time zone 'America/Detroit')::date = v_today;

  if v_used + p_cost_usd > v_cap then
    return query select false, null::text, greatest(v_cap - v_used, 0);
    return;
  end if;

  insert into invite_generations (child_id, person_id, status, source, prompt_hash, cost_usd)
  values (p_child, current_person(), 'PENDING', p_source, p_prompt_hash, p_cost_usd)
  returning id into v_id;

  return query select true, v_id, greatest(v_cap - v_used - p_cost_usd, 0);
end $$;

revoke all on function invite_budget_reserve(text, numeric, text, text) from public, anon;
grant execute on function invite_budget_reserve(text, numeric, text, text) to authenticated;

-- Settle AFTER the image call resolves. SUCCEEDED keeps the reserved cost counted; FAILED (the
-- model call errored, or the PII guard refused post-reservation) drops it from today's sum —
-- the refund the in-memory budget already does, now persisted. Caller must own the reservation
-- (own person_id) — a forged generation_id from another caller's reservation is refused.
create or replace function invite_budget_settle(
  p_generation text, p_status text, p_model text, p_output_sha256 text
) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_updated int;
begin
  if current_person() is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_status not in ('SUCCEEDED', 'FAILED') then raise exception 'BAD_STATUS'; end if;

  update invite_generations
     set status = p_status, model = p_model, output_sha256 = p_output_sha256, settled_at = now()
   where id = p_generation and person_id = current_person() and status = 'PENDING';
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end $$;

revoke all on function invite_budget_settle(text, text, text, text) from public, anon;
grant execute on function invite_budget_settle(text, text, text, text) to authenticated;

commit;
