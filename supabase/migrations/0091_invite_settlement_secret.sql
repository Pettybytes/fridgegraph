-- 0091 — Invite settlement secret: private table fallback for 0085's `invite_budget_settle`.
--
-- WHY THIS EXISTS. 0085 reads the settlement HMAC key from the database setting
-- `app.invite_settlement_hmac_secret` and fails CLOSED when it is unset. On this Supabase
-- project the migration role (`postgres`) is the database owner but is **not** a superuser, and
-- PostgreSQL 15+ parameter ACLs refuse `ALTER DATABASE ... SET app.<custom>` / `ALTER ROLE ...
-- SET app.<custom>` for it (verified: SQLSTATE 42501 on both, direct and pooled connections;
-- `supabase_admin` is not reachable). There is therefore no out-of-band way to install the
-- setting on this platform.
--
-- This migration keeps 0085's fail-closed contract and its exact signature, and adds ONE
-- fallback: when the GUC is unset, the function reads the secret from a private, grant-less
-- single-row table. Both sources are database-resident; neither is readable by `anon`,
-- `authenticated` or `service_role`. The function remains SECURITY DEFINER and the only reader.
-- An empty table still returns `false` — configuration is never optional.
--
-- Forward-only. 0085 is NOT edited (already applied); this replaces only the function body.
-- The secret itself is inserted out of band after this migration, exactly like 0085's GUC was
-- meant to be, and is never written into a migration file or committed anywhere.

begin;

create table if not exists invite_settlement_config (
  singleton boolean primary key default true check (singleton),
  secret text not null check (length(secret) >= 32),
  updated_at timestamptz not null default now()
);

alter table invite_settlement_config enable row level security;
alter table invite_settlement_config force row level security;
-- No policy exists, so nobody but a BYPASSRLS role can see the row; and no role but the
-- SECURITY DEFINER owner (postgres) has a grant at all.
revoke all on invite_settlement_config from public, anon, authenticated, service_role;

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
  v_secret := nullif(current_setting('app.invite_settlement_hmac_secret', true), '');
  if v_secret is null then
    -- Platform fallback (see header): the same secret, stored privately in-database.
    select secret into v_secret from invite_settlement_config where singleton;
  end if;
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
