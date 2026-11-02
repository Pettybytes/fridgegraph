# 0082 apply-window plan — a local PostgREST endpoint for real `db:checksum` proof

**Status: PLAN ONLY. No window is open. Nothing scheduled, nothing executed.**
Companion to `hosting-window-plan.md`; unrelated to it, deliberately kept separate.

---

## 1. Why this exists

`npm run db:checksum` reads **through PostgREST** (`SUPABASE_URL` → `/rest/v1/<table>` with the
service key), not through a direct Postgres connection. The 0082 rehearsal on `fg81` therefore proved
the **SQL privilege delta** only: `service_role` gained `SELECT`, writes stayed refused, `anon` and
`authenticated` unchanged. It could **not** prove the command that actually broke.

That gap is the whole reason this plan exists. A green rehearsal that cannot run the failing command
is prepared, not proven.

## 2. What "proven" means here

The 0082 window is done when both halves hold on the same target:

| # | Condition | Method |
| --- | --- | --- |
| 1 | **Before 0082**, `db:checksum` fails on `shared_statuses` with HTTP 403 | run against local PostgREST, endpoint verified local first |
| 2 | **After 0082**, the same command succeeds and hashes every table | same command, same endpoint, same base data |
| 3 | The 403 is specific to `shared_statuses` | the failure names that table; others read normally |
| 4 | Nothing else moved | checksum values for `care_facts`/`routines`/`grants` unchanged by the grant |

Condition 1 is the one everybody skips. Reproducing the failure first is what makes condition 2 mean
something.

## 3. Why not just point at the project database

Because that is a **live** database and the command's purpose is to read the **whole** cast. Running
it there to "check" is how a verification tool becomes a live query against production data, and it
proves nothing about a disposable target. The endpoint must be local, disposable, and named.

**Absolute rule:** the runner refuses any endpoint whose host is not `127.0.0.1`/`localhost`, and
refuses if the URL equals `SUPABASE_URL` from `.env`. Refusal is an error, not a warning.

## 4. Options

### Option A (recommended) — PostgREST binary against `fg81`

- `fg81` already runs on **`127.0.0.1:55434`** (loopback-only, recreated in W-DEPLOY-54e8abe, volume
  preserved). It is disposable and already holds the 0076 replica used for the grant rehearsal.
- Run PostgREST on a **loopback-only** port (e.g. `127.0.0.1:3300`) with:
  - `db-uri` → `postgres://…@127.0.0.1:55434/postgres`
  - `db-schemas` → `public`
  - `db-anon-role` → `anon`
  - `jwt-secret` → a **rehearsal-only** secret generated for the run, never a real project secret
- Mint two short-lived rehearsal JWTs from that secret: one `role=service_role`, one `role=authenticated`.
- Point `SUPABASE_URL` at `http://127.0.0.1:3300` **only inside the rehearsal process environment**,
  never in `.env`.

Pros: light, exact command path, uses the artifact already rehearsed.
Cons: does not reproduce Supabase's auth/RLS wiring — only PostgREST's role switching and grants.

### Option B — Supabase CLI local stack

Pros: closest to real (PostgREST + GoTrue + the actual role model).
Cons: pulls images, needs a full local schema, and a local stack that drifts from `fg81` reintroduces
"proved it somewhere else". Higher cost for a one-command verification.

### Option C — PostgREST container on a shared network with `fg81`

Same as A with container plumbing. Choose only if the binary is not installable on this machine.

**Recommendation: A**, falling back to C.

## 5. Window steps (draft — execute only under a posted reservation)

1. **Reserve** the window; record the target endpoint and port before anything starts.
2. **Verify the target is local**: `lsof` shows the PostgREST port bound to `127.0.0.1`; `fg81` still
   bound to `127.0.0.1:55434`. Abort otherwise.
3. **Reset the disposable DB** to the pre-0082 posture (0076 replica: `shared_statuses` with DML to
   `authenticated`, nothing to `service_role`).
4. **Reproduce the failure**: run `db:checksum` against the local endpoint → expect **403 on
   `shared_statuses`**, other tables reading. Record the exact body.
5. **Apply `0082_shared_statuses_service_role_select.sql`** — the reviewed single file, one
   connection, no ledger push.
6. **Re-run the same command** → expect success; record per-table row counts and hashes.
7. **Confirm nothing else moved**: `care_facts`/`routines`/`grants` values match step 4.
8. **Confirm writes still refused**: `service_role` INSERT/UPDATE/DELETE still `permission denied`.
9. **Tear down** the PostgREST process and any minted tokens; leave `fg81` as found or destroyed,
   and say which.
10. **Receipt** with both runs (fail then pass), the exact command, the endpoint, and the revocation.

## 6. Limitations to state in the receipt

- A local PostgREST proves **grant + PostgREST role switching** semantics. It does **not** prove
  Supabase's JWT verification, its `authenticator`→role switch, or RLS under real claims.
- `fg81` is a **replica**, not the project schema. A pass here does not prove the project database's
  other tables read identically; it proves the 0082 delta.
- Rehearsal JWTs are throwaway and must be revoked/unusable after the window. Never reuse a real
  project secret for this.

## 7. Non-goals

- No `db push`, no ledger-driven apply, no touch of `SUPABASE_DB_URL` beyond the existing read path.
- No apply to the live project in this plan; a live apply, if approved, is a **separate** window with
  its own reservation and receipt.
- No change to `0076`.
