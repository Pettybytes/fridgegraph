# Security hardening — `public.adult_availability_free_busy` (migration 0086)

**Status: STAGED, not applied anywhere.** Fresh branch `fix/availability-view-hardening` off
current `main`, draft PR, never merged. Nothing in this document describes a live, deployed
state — every finding below was observed against a real but **disposable** Postgres container
(`ops/availability-view-proof.mjs`), built by applying this repo's own migration set, never the
real project database. Bentley verifies the deployed catalog state and applies the reviewed
migration only in his own authorized window.

## 1. The advisor finding, exactly

Supabase's linter (and the underlying Postgres security advisor class it's built on) flags
`adult_availability_free_busy` as a **"Security Definer View"**: a view with no
`security_invoker` setting executes with its *owner's* privileges against the base table, not the
calling user's — the advisor's default assumption is that this is usually accidental and should
be turned off. Two things make this view's actual situation different from that default
assumption, confirmed by direct catalog inspection before writing any fix:

- **The "definer" execution is the whole point, not an oversight.** `adult_availability`'s own RLS
  (`adult_availability_own`, `SELECT ... person_id = current_person()`) admits **only the row's
  owner**. The free/busy *sharing* feature — the reason this view exists at all — depends on
  running with elevated (owner) privilege so its own `WHERE` clause (`self OR
  shares_village_with(person_id) OR (is_demo_guide() AND sandbox)`) can be the actual
  authorization check. Flip `security_invoker` on and the view's `WHERE` clause becomes
  irrelevant: RLS alone would apply first and strip every row down to "only my own," identical to
  querying the base table directly — the sharing feature silently stops working for everyone. This
  is stated explicitly in the original migration (0027): *"Definer semantics are intentional
  here."*
- **What the advisor finding does NOT by itself establish is safety** — a definer view that does
  its own row-level authorization in a `WHERE` clause has a *second*, separate, well-documented
  Postgres risk: without `security_barrier`, the query planner is free to evaluate a
  caller-supplied predicate on the view's output columns **before** the view's own security
  predicate, for efficiency. A caller can smuggle a side-effecting or observable function into
  their own `WHERE` clause and have it invoked against rows they are not authorized to see, even
  though those rows are correctly excluded from the final result set. This is Postgres's own
  documented reason `security_barrier` exists (the "leaky view" problem) — not a hypothetical for
  this repo: **proven real** on this exact view, pre-hardening (§4, check 8).

So: intentional owner/definer semantics, confirmed and preserved. The actual gap was the missing
`security_barrier`, now closed — not `security_invoker`, which this PR does not touch.

## 2. What the migration does (0086)

```sql
alter view adult_availability_free_busy set (security_barrier = true);
comment on view adult_availability_free_busy is '...'; -- full sharing rationale, see the migration
revoke all on adult_availability_free_busy from public;
revoke all on adult_availability_free_busy from anon;
revoke all on adult_availability_free_busy from service_role;
revoke all on adult_availability_free_busy from authenticated;
grant select on adult_availability_free_busy to authenticated;
```

- `security_barrier = true` — closes the planner-pushdown gap (§1, §4 check 8). Changes *when* the
  view's own `WHERE` clause is evaluated, never *who* it admits.
- The explicit revokes are **defense-in-depth, not a correction** — catalog inspection (§3)
  confirms `public`/`anon`/`service_role` already held nothing. They are made explicit because the
  view is, by shape, Postgres **auto-updatable**
  (`information_schema.views.is_insertable_into = 'YES'` — a plain single-table view with no
  `DISTINCT`/`GROUP BY`/aggregate) — safe today only because no `INSERT`/`UPDATE`/`DELETE` grant
  exists, not because Postgres structurally refuses one. An explicit, visible revoke is insurance
  against a future accidental grant silently creating a write path that bypasses the view's own
  sharing rule.
- A `COMMENT ON VIEW` records the sharing rationale directly in the catalog (§5 of the brief).

`security_invoker` is **not set**, deliberately (§1).

## 3. Privilege matrix (real catalog read, disposable Postgres, before 0086 applied)

| Role | Object | SELECT | INSERT/UPDATE/DELETE | Source |
| --- | --- | --- | --- | --- |
| `anon` | `adult_availability_free_busy` | **no** | no | `has_table_privilege()` — false for all 4; no direct grant row in `information_schema.table_privileges` |
| `public` (pseudo-role) | `adult_availability_free_busy` | **no** | no | same |
| `service_role` | `adult_availability_free_busy` | **no** | no | same — this project has no backend service-role data client anywhere (every read/write runs AS THE CALLER); confirmed, not assumed |
| `authenticated` | `adult_availability_free_busy` | **yes** (not grantable) | no | one explicit `GRANT SELECT` (0027); no other grant ever issued |
| owner (`postgres`, the migration-applying role) | `adult_availability_free_busy` | yes | yes (owner right, not a grant) | `pg_class.relowner` |
| `authenticated` (self only) | `adult_availability` (base table) | yes, `person_id = current_person()` rows only | yes, same scope (`adult_availability_own_write`, `cmd = ALL`) | `pg_policies` |
| `anon`/`service_role`/`public` | `adult_availability` (base table) | no | no | RLS forced by policy absence — no policy admits these roles at all |

**Default privileges for the migration-applying role**: `pg_default_acl` is **empty** — no
`ALTER DEFAULT PRIVILEGES` has ever been configured, so a newly created object (view, table,
function) in this schema gets **no** automatic grant to anyone. Every grant anywhere in this
codebase is explicit, including the one this migration adds.

**Dependent helpers** (`current_person`, `shares_village_with`, `is_demo_guide`) are all
`SECURITY DEFINER`, owned by the same role as the view, and all pin `SET search_path = public` —
the standard defense against a `SECURITY DEFINER` search-path hijack. None of the three was
altered by this migration; none needed to be.

## 4. Proof results (`ops/availability-view-proof.mjs`, real disposable Postgres, 10/10 checks)

Fixtures: Kendra (`p_mom`) and Andre (`p_dad`) already share Nora's village (`v_nora`:
households `h_a`/`h_b`) in the baseline seed (0002) — used as owner / authorized-village-member.
Dana (`p_dana`, village `v_jax`) is a genuinely unrelated family, also already seeded. One
`sandbox = true` row was added for the demo-guide check.

| # | Check | Result |
| --- | --- | --- |
| 1 | `anon`: queries the view | **permission denied** (a real Postgres error, not an empty read) |
| 2 | Adult owner (Kendra) reads her own free/busy rows | all 3 rows, unchanged |
| 3 | Authorized village member (Andre) reads Kendra's free/busy rows | sees `id`/`person_id`/`start_at`/`end_at`/`state`; `reason` is not a column of the view — `SELECT reason` fails with "column does not exist," not a permission error, because it structurally cannot be asked for |
| 4 | Unrelated family (Dana, different village) | **zero rows** — identical shape to a nonexistent id, no oracle |
| 5 | Demo guide | sees **only** the `sandbox = true` row; Kendra's two real rows are invisible to the guide |
| 6 | `authenticated` direct base-table read | Andre gets **zero rows** querying `adult_availability` directly for Kendra's `reason` (RLS is self-only regardless of what the view shares); Kendra reads her own `reason` directly, as expected |
| 7 | Application writes through the view | `UPDATE`/`INSERT` through `adult_availability_free_busy` both refused: "permission denied for view" |
| 8 | **Adversarial caller predicate, pre-hardening** | Dana's query embeds a side-effecting probe function in her own `WHERE` clause against Kendra's forbidden rows. **Without `security_barrier`, the probe was invoked 3 times** — once per one of Kendra's rows — even though zero rows were ultimately returned to Dana. The gap is real on this exact view/query shape, not theoretical. |
| 9 | Alternate-disclosure inspection | `adult_availability_free_busy` is the **only** view or materialized view in the entire `public` schema; nothing else references `adult_availability.reason`; all three dependent helpers return a scalar (`text`/`boolean`), never a row — no other path exists to leak `reason` |
| 10 | Before/after comparison + full re-run post-0086 | Andre's authorized result set is **byte-for-byte identical** before and after 0086. The **same adversarial predicate from check 8, re-run after `security_barrier = true`, invokes the probe function zero times** — the exact gap check 8 demonstrated is closed. Checks 1/4/7 (anon refusal, unrelated-family refusal, write refusal) hold identically post-migration. |

## 5. Bounded view audit

The entire `public` schema (79 real, already-applied migrations, the full baseline) contains
**exactly one view and zero materialized views**: `adult_availability_free_busy` itself (§4 check
9, confirmed directly via `pg_class` — not inferred). There is nothing else to inventory in this
PR's scope. If a second view is ever added to this schema, it needs its own, separate review —
this migration does not and cannot generalize to it.

No blanket `REVOKE` across `public` and no global `ALTER DEFAULT PRIVILEGES` change was made or is
proposed — both explicitly out of scope per this PR's own brief, and unnecessary: `pg_default_acl`
is already empty (§3), so there is nothing to "fix" at that level, and a blanket revoke across
`public` would touch objects this PR never inspected.

## 6. Residual limitations — stated, not hidden

- **Database owners/admins are out of scope.** This migration controls object-level `GRANT`s. A
  role with `BYPASSRLS` (a real Postgres superuser, or any role explicitly granted that attribute)
  sees every row in `adult_availability` directly, `reason` included, regardless of any grant or
  policy here — that access exists outside anything a view-hardening migration can or should
  constrain, and no claim is made that it is denied.
- **The view remains Postgres-auto-updatable by shape** (`is_insertable_into = 'YES'`). This
  migration's explicit revokes are the control, not a structural change to the view's shape (e.g.
  adding a dummy `GROUP BY` to force it non-updatable) — a structural change was judged
  unnecessary and would complicate the view's own query plan for no safety benefit, since the
  explicit revoke already closes the actual path. Recorded here so a future reviewer re-adding
  write access to this view does so with full knowledge of what they're re-opening.
- **`security_barrier` can measurably affect query plans** (it restricts certain plan
  transformations, specifically to prevent exactly the pushdown this migration is defending
  against). No performance regression was observed in the proof's query shapes, but the proof's
  fixture size (a handful of rows) is not a load test — this is noted as a residual, not measured
  at production scale.
- **This review is complete, not merely asserted.** Every item in the brief's checklist (contract
  verification, targeted hardening, bounded audit, real proof with an adversarial predicate) was
  actually run against a real disposable Postgres container before this document was written —
  this is not being labelled an "accepted exception" in place of doing the work; the work is done
  and its results are above.

## 7. Migration hash, rollout, compatibility

- **0086 content hash**: computed and recorded in the PR description (`shasum -a 256
  supabase/migrations/0086_availability_view_hardening.sql`) at push time — reservable only once
  the file is final, since any further edit changes it while the migration remains unapplied.
- **Rollout**: additive and reversible. `ALTER VIEW ... SET (security_barrier = true)` and
  `COMMENT ON VIEW` are both metadata-only changes — no table rewrite, no lock beyond a brief
  `ACCESS EXCLUSIVE` on the view's own catalog row (not the underlying table), no data touched.
  The explicit revokes/re-grant reproduce the exact privilege state that already existed (§3) —
  functionally a no-op for any correctly-behaving client, by construction (§4 check 10).
- **Compatibility risk: effectively none for correct callers.** Any client reading this view today
  through `authenticated` with `SELECT` continues to work identically (§4 check 10's whole point).
  A client that was relying on `security_barrier`'s *absence* to push a filter and observe timing
  or side effects on forbidden rows — i.e., exploiting the exact gap this migration closes — loses
  that ability, which is the intended effect, not a compatibility break of anything legitimate.
- **Application**: Bentley verifies the real project database's deployed catalog state for this
  view (matches §3's "before" shape, not already hardened by something else) before applying, in
  his own authorized window. This PR makes no live change, restarts no backend, and is never
  merged by this process.
