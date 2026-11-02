# 0082 apply-window plan — verifying `db:checksum` end to end

**Status: PLAN ONLY. No window is open. Nothing scheduled, nothing executed.**
Companion to `hosting-window-plan.md`; kept separate on purpose.

---

## 1. Why this exists

`npm run db:checksum` reads **through PostgREST** (`SUPABASE_URL` → `/rest/v1/<table>`), not through a
direct Postgres connection. The 0082 rehearsal on `fg81` therefore proved the **SQL privilege delta**
only: `service_role` gained `SELECT`, writes stayed refused, `anon` and `authenticated` unchanged. It
could not prove the command that actually broke.

## 2. What "proven" means — the sequence, unchanged

The window is done when this exact sequence holds **against one target**:

| # | Step | Condition |
| --- | --- | --- |
| 1 | **Reproduce the 403** on the pre-0082 posture | `db:checksum` fails on `shared_statuses`; other tables read normally |
| 2 | **Apply** `0082_shared_statuses_service_role_select.sql` | the reviewed single file, one connection |
| 3 | **Re-run** the same command, same endpoint, same base data | success; per-table counts and hashes recorded |
| 4 | **Other tables unchanged** | `care_facts`/`routines`/`grants` values match step 1 |

Step 1 is the one that gets skipped. Reproducing the failure is what makes step 3 mean something.

### Guardrails on the baseline — non-negotiable

- **Observe pre-apply privileges; never revoke an existing live privilege to manufacture a failing
  baseline.** If `service_role` already holds `SELECT` on the project before the window, the 403
  simply will not reproduce. Record that as the finding, capture the existing grant, and proceed.
  Revoking a live privilege to produce a red result is forbidden: it degrades the environment to
  manufacture evidence.
- **Verify unchanged write privileges through catalogue checks, not live mutation attempts.** Ask the
  catalogue with `has_table_privilege('service_role','public.shared_statuses','INSERT'|'UPDATE'|'DELETE')`
  (and the same for `anon` and `authenticated`). Do **not** issue probe INSERT/UPDATE/DELETE against
  the live project to "prove" a refusal — a catalogue read answers the question and modifies no data.

## 3. Where the verification runs

**Live verification runs against the intended Supabase PostgREST endpoint** — the project the command
is actually failing against — inside a **freshly reserved window** after Bryan merges. That is the
authoritative result, and it needs:

- the window reserved and posted first;
- the endpoint named in the receipt (host only; credentials never printed);
- the same sequence in §2: reproduce → apply → re-run → other tables unchanged.

**A local PostgREST is optional, and only ever for an offline HTTP rehearsal.** It lets the command be
exercised before the window without touching the project. It is **not a prerequisite for the apply**,
and its absence must never block the window.

## 4. Offline rehearsal (optional)

If a local endpoint is wanted first:

- PostgREST binary against the already-rehearsed `fg81` on **`127.0.0.1:55434`**, itself loopback-only;
- bind the rehearsal endpoint to `127.0.0.1` only;
- point `SUPABASE_URL` at it **inside the rehearsal process environment only**, never in `.env`;
- throwaway JWTs minted from a rehearsal-only secret (never a real project secret).

Runner rule: refuse any endpoint whose host is not `127.0.0.1`/`localhost`, and refuse if the URL
equals `SUPABASE_URL`. Refusal is an error, not a warning.

Skipping this section entirely is a valid choice. The live sequence in §2 is the proof.

## 5. What SELECT does not repair

0082 grants `SELECT` to `service_role` and nothing else. It leaves the **maintenance write paths**
unresolved, and the two paths are genuinely different:

- the **canonical reset** uses its **own server-side PostgreSQL connection**, so this grant is
  irrelevant to it;
- `scripts/db.ts` **seed/reset** goes through **service-role PostgREST**, so those writes remain
  ungranted and unfixed by 0082.

Neither is a live breakage today — both must be stated accurately rather than described as "works as
the caller". Repairing either is a separate decision with its own proof.

## 6. Window steps (draft)

1. **Reserve**; record the target endpoint up front.
2. **Verify the target**: for the live path, confirm it is the intended project; for an offline
   rehearsal, confirm `127.0.0.1` and that `fg81` is still on `127.0.0.1:55434`. Abort otherwise.
3. **Establish the pre-0082 posture** on the chosen target.
4. **Observe pre-apply privileges first** (catalogue: `service_role`, `anon`, `authenticated` on
   `shared_statuses`). **Then** reproduce the 403 (§2 step 1) and record the exact body. If it does
   not reproduce because the privilege is already present, record that honestly — do **not** revoke
   anything to create the failure.
5. **Apply 0082** — reviewed single file, one connection, no ledger push.
6. **Re-run** the same command (§2 step 3).
7. **Confirm other tables unchanged** (§2 step 4).
8. **Confirm writes still refused — catalogue only**: `service_role` INSERT/UPDATE/DELETE remain
   `false`; `anon` unchanged; `authenticated` unchanged. **No mutation is attempted against live
   data.**
9. **Tear down** any optional local endpoint and rehearsal tokens; say what was left running.
10. **Receipt** with both runs, the exact command, the endpoint, and the revocation.

## 7. Limitations to state in the receipt

- A local PostgREST proves **grant + PostgREST role switching** semantics. It does **not** prove
  Supabase's JWT verification, its `authenticator`→role switch, or RLS under real claims. That is
  exactly why the live run against the project is the authoritative one.
- `fg81` is a **replica**, not the project schema. A pass there proves the 0082 delta, not that the
  project's other tables read identically.

## 8. Non-goals

- No `db push`, no ledger-driven apply, no change to `0076`.
- No apply to the live project inside this plan without its own reservation and receipt.
- No blocker invented from a missing local PostgREST.
