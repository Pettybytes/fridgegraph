-- 0092 — Give invite_budget_settle the schema that actually holds pgcrypto.
--
-- 0085 (and its 0091 fallback) declare `set search_path = public`. On this Supabase project
-- pgcrypto is installed in the `extensions` schema, so `hmac(...)` cannot be resolved from
-- `public` and every settle call fails at runtime with SQLSTATE 42883
-- ("function hmac(text, text, unknown) does not exist") — reservations stay PENDING forever.
-- The disposable rehearsal did not catch it because it created pgcrypto in public on a bare
-- Postgres cluster.
--
-- `public` stays first so every table/helper reference is unchanged; `extensions` is added only so
-- hmac resolves. Nothing else about the function (signature, owner, SECURITY DEFINER, grants,
-- fail-closed behaviour) changes. Forward-only; 0085/0091 are not edited.

begin;

alter function invite_budget_settle(text, text, text, text, boolean, text)
  set search_path = public, extensions;

commit;
