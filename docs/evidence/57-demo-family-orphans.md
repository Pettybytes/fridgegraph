# 57 — an aborted family creation can no longer strand an auth account

## The leak

`createDemoFamily()` creates the Supabase Auth user **first**, then the rows, then the mappings.
`compensate()` deletes the account on any *thrown* error, which is why the fault-injection proof never
reproduced the leak: every injected failure was an exception, and every exception was cleaned up.

What leaked was a **killed process**. No catch block runs, so the account survives. And it was
invisible to the existing sweeps: `purgeFamilyArtifacts()` only walks accounts reachable through a
*file* entry, and an aborted run never writes one. Those accounts were unmapped on both paths — they
resolve to nobody, but they exist forever.

## Fix

| Piece | Behaviour |
|---|---|
| **0049/0051** | `demo_families.auth_user_id` is nullable again; `status ∈ pending · active · aborted`; `aborted_at`, `reconciled_at` |
| **marker first** | a `pending` row is written **before** the auth user exists, carrying the email — the handle a reconciler needs; the id is recorded on it the moment the account exists (autocommit, outside the transaction) |
| **commit flips it** | the same row is updated to `active` inside the transaction, so family data and registration commit together |
| **`compensate()`** | deletes the marker in **both** branches — a rollback does not remove a row written before the transaction began |
| **`reconcileAbandonedFamilies()`** | eligibility is by **exclusion** against an allow-set of *active* registry rows: any `family.*@example.com` account that is not active is stray. Deletes account + rows + both mappings + marker. Counts only. |
| **reset** | runs the reconciler after `purgeFamilyArtifacts()`, so the stated end state holds |

Nothing outside the `family.*@example.com` shape is ever considered, and the active allow-set means a
healthy family is never swept.

## Proof — `ops/orphan-reconcile-proof.mjs`: **10/10 PASS**

The crash is a **real SIGKILL at the `after-auth` stage**, not a thrown error:

| # | Assertion | Result |
|---|---|---|
| 1 | an active family is created with `status = active` | PASS |
| 2 | the child process is really killed — `signal=SIGKILL`, not an exception | PASS |
| 3 | the killed run left an auth account | PASS |
| 4 | the killed run left a `pending` marker carrying the handle | PASS |
| 5 | reconciliation deletes exactly the strays | PASS |
| 6 | the **active** family survives reconciliation | PASS |
| 7 | only the active family account remains | PASS |
| 8 | no pending marker remains | PASS |
| 9 | reset removes the active family | PASS |
| 10 | **zero family accounts remain** | PASS |

## Reconcile the known orphans — before / after

Counts only; no ids or emails.

| Measurement | Value |
|---|---|
| Known orphans when this work started | **4** |
| At sweep time (one more leaked during the refresh verification) | **5** |
| Reconciled by `reconcileAbandonedFamilies()` | **5** |
| Family accounts after | **0** |
| `demo_families` rows / pending markers after | **0 / 0** |

The sweep is idempotent: re-running it on a clean stack deletes nothing (the proof above starts from
`BEFORE: 0 known orphans` and still passes 10/10 by creating and reconciling its own stray).
