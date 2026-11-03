-- 0086 — adult_availability_free_busy: targeted hardening (security_barrier, explicit revokes).
-- STAGED ONLY — never applied by this PR. Forward-only; 0001-0085 never edited.
--
-- Inspected first against a REAL disposable-Postgres catalog (not assumed from reading 0027's
-- SQL text): the view is owned by the migration-applying role, has no security_barrier set
-- (reloptions is null), and already has no PUBLIC/anon grant at all — confirmed with
-- has_table_privilege() for anon/authenticated/public/service_role directly, not inferred. The
-- base table adult_availability is RLS-enabled, NOT forced (irrelevant here: FORCE only changes
-- behavior for the table OWNER's own queries, and none of authenticated/anon/service_role is ever
-- the owner), with two self-only policies (`adult_availability_own` SELECT, `adult_availability_
-- own_write` ALL, both `person_id = current_person()`). The dependent SECURITY DEFINER helpers
-- (current_person, shares_village_with, is_demo_guide) all pin `search_path = public`, so this
-- migration does not touch them. The view IS Postgres auto-updatable
-- (information_schema.views.is_insertable_into = 'YES' — a simple single-table view with no
-- DISTINCT/GROUP BY/aggregate) — it is write-safe TODAY only because no INSERT/UPDATE/DELETE
-- grant exists, not because Postgres structurally refuses one. This migration makes that explicit
-- rather than implicit. Bounded audit: this is the ONLY view or materialized view anywhere in the
-- public schema (checked directly; see docs/security/0086-availability-view.md for the full
-- catalog read).
--
-- SECURITY_BARRIER ADDED, security_invoker DELIBERATELY NOT TOUCHED. This view's WHERE clause
-- (self, OR shares_village_with(person_id), OR is_demo_guide() AND sandbox) IS the sharing rule.
-- The base table's own RLS only ever admits the OWNER of a row — an invoker-rights read through
-- this view would show every caller ONLY their own rows, exactly as if the view did not exist,
-- silently deleting the free/busy sharing feature 0027 built. That is why 0027 itself states
-- "Definer semantics are intentional here." Switching security_invoker on would not "fix" an
-- advisor finding; it would remove the feature — explicitly refused per this PR's own brief
-- ("don't switch security_invoker on merely to silence the advisor"), and no test in
-- ops/availability-view-proof.mjs demonstrates an invoker-rights equivalent that still shares
-- correctly, so intentional owner/definer semantics are preserved as-is.
--
-- What WAS actually missing: a guarantee that the planner evaluates this view's OWN WHERE clause
-- before any caller-supplied qual on the same output columns. Without security_barrier, Postgres
-- is free to push a caller's own filter predicate (e.g. `where state = 'busy'`) below the view's
-- security OR-clause for efficiency — the textbook "leaky view" class security_barrier exists to
-- close (PostgreSQL's own documented reason for the option). It changes EVALUATION ORDER, not WHO
-- can see what — the exact kind of change the brief calls for ("this view enforces row visibility
-- itself"). Proven directly with an adversarial caller predicate in
-- ops/availability-view-proof.mjs (a volatile/side-effecting function in the caller's own WHERE
-- clause must never observe a forbidden row's columns).
--
-- TRUSTED BACKEND / SERVICE-ROLE ACCESS: none exists, and none is added. This project's
-- established architecture (consistent across every subgraph/service touched this session) has no
-- backend service-role data client — every read and write runs AS THE CALLER, through the
-- caller's own JWT. The view's own owner-style execution (above) already IS the one "elevated
-- execution" mechanism in play for this feature; service_role holds no grant on this view or its
-- base table today and gets none here. This migration does not and cannot make a claim about
-- denying a database owner or admin connecting directly with superuser/BYPASSRLS privileges —
-- that access exists outside any grant this migration controls, and is out of scope for a view
-- hardening migration.

begin;

alter view adult_availability_free_busy set (security_barrier = true);

comment on view adult_availability_free_busy is
  'Free/busy sharing projection over adult_availability (0027). Intentionally owner-executed '
  '(no security_invoker): the base table''s own RLS is self-only (person_id = current_person()), '
  'so this view performs the ACTUAL sharing rule itself in its WHERE clause (self, OR '
  'shares_village_with(person_id), OR is_demo_guide() AND sandbox) and projects away the private '
  '`reason` column by omission, not by RLS. security_barrier=true (0086) additionally guarantees '
  'the planner evaluates that WHERE clause before any caller-supplied qual on the same columns, '
  'closing a planner-pushdown side-channel without changing who can see what. authenticated has '
  'SELECT only (explicit); PUBLIC, anon and service_role have nothing (explicit, 0086 — and never '
  'did). No INSERT/UPDATE/DELETE grant exists or is intended on this view, though it is '
  'Postgres-auto-updatable by shape: a person''s own availability is written through the base '
  'table''s own adult_availability_own_write policy directly, never through this view. See '
  'docs/security/0086-availability-view.md for the full privilege matrix and proof results.';

-- Explicit, not inferred from "nothing was ever granted" — the same defense-in-depth posture
-- every other view/RPC grant in this schema already uses, and insurance against this
-- (confirmed auto-updatable) view ever silently becoming writable through a future accidental
-- grant. service_role is included even though this project's architecture never uses it as a
-- data client, for the same reason.
revoke all on adult_availability_free_busy from public;
revoke all on adult_availability_free_busy from anon;
revoke all on adult_availability_free_busy from service_role;
revoke all on adult_availability_free_busy from authenticated;
grant select on adult_availability_free_busy to authenticated;

commit;

-- ---------------------------------------------------------------- rollback (manual)
-- begin;
--   alter view adult_availability_free_busy reset (security_barrier);
--   comment on view adult_availability_free_busy is null;
--   -- grants revert to 0027's shape automatically: 0027 is still the only migration that ever
--   -- granted SELECT to authenticated, and this migration's revokes only make explicit what was
--   -- already true, so there is nothing else to restore.
-- commit;
