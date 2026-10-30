# Evidence 34 — E0: the real-call mint path with one consumption point

_Group 1, branch `feat/e-group1` off `a5a9ae9` (PR #9 not yet merged). 2026-10-30._

## 1. What the dispatcher and consumption did before this change

Stated from the code, not assumed:

- `ops/dispatcher.mjs` had **no call to `consume_real_call_authorization`** and no PostgREST access
  at all — `grep` for `rest/v1/rpc` and `SERVICE_ROLE` in the file returned nothing. It validated the
  calling window, then POSTed `{attemptId, contactId, channel}` to the n8n Dispatch webhook.
- Consumption existed as a **manual runbook step** (§3.3 of the old runbook): the operator called the
  RPC by hand before tagging. The n8n Dispatch workflow does not consume either — it writes the
  contact's `fg_` fields.
- `open_attempt(..., 'REAL_CONSENTED')` consumed **nothing**; it only required a valid authorization
  to exist. So before this change there was a manual, skippable consumption point, and the session-3
  arming had to use a direct job insert to get a REAL_CONSENTED attempt at all (evidence 33 §2).

## 2. The new shape

```
request_pickup            -> job + PENDING evaluations + one TEST_RESPONDER attempt per candidate
issue RealCallAuthorization -> bound to job + candidate + GHL contact + request_version
promote_attempt_to_real_consented(attempt, contact)
                          -> VALIDATES the authorization, rewrites the attempt in place
                          -> attaches authorization.attempt_id
                          -> DOES NOT CONSUME
dispatch                  -> consume_real_call_authorization(attempt, contact)  == true
                          -> only then POSTs to the Dispatch webhook
```

No second attempt is opened, so the `(job_id, candidate_id)` unique constraint is never in play. The
runbook no longer contains a direct job insert.

## 3. Migration `0023_promote_real_consented.sql`

Applied. Signature `promote_attempt_to_real_consented(p_attempt text, p_contact text)`, granted to
`service_role` only (`postgres:EXECUTE, service_role:EXECUTE`; revoked from `public`, `anon`,
`authenticated`).

Refusals are raises, never fallbacks: `PROMOTE_ARGS_REQUIRED`, `ATTEMPT_NOT_FOUND`,
`ATTEMPT_CLOSED`, `ALREADY_REAL_CONSENTED`, `BAD_DESTINATION_MODE`, `JOB_NOT_DISCOVERING`,
`REAL_CALL_NOT_AUTHORIZED`.

## 4. Dry run — `node ops/0023-dry-run.mjs`

**23/23 PASS**, everything inside one transaction that was rolled back. Fixtures used real `people`
ids (the one-open-attempt index is per candidate across all jobs, so each case needs its own person).

| Case | Result |
|---|---|
| args / contact required | `PROMOTE_ARGS_REQUIRED` |
| unknown attempt | `ATTEMPT_NOT_FOUND` |
| promotion without an authorization | `REAL_CALL_NOT_AUTHORIZED`; attempt left `TEST_RESPONDER` |
| authorization for another recipient | `REAL_CALL_NOT_AUTHORIZED` |
| request-version mismatch | `REAL_CALL_NOT_AUTHORIZED` |
| valid promotion | `promoted:<attempt>`; mode `REAL_CONSENTED`; destination = contact; authorization attached both ways |
| **promotion consumed?** | **no** — `consumed_at` null after promotion |
| promote twice | `ALREADY_REAL_CONSENTED` |
| promote a closed attempt | `ATTEMPT_CLOSED` |
| dispatch consumes once | first `true`, second `false` |
| rolled back | jobs 0→0, attempts 0→0, authorizations 0→0, evaluations 0→0 |

## 5. Dispatcher change

`consumeRealCallAuthorization(attemptId, contactId)` calls the RPC with the service role and returns
the boolean. `dispatchAttempt` calls it **after** the window guard and **before** the webhook POST:

```js
const consumed = await consumeRealCallAuthorization(attemptId, contactId)
if (consumed !== true) throw new Error('CONSUME_REFUSED — no call placed')
```

`--dry` still performs every read and **consumes nothing** — the call is inside the non-dry branch.

## 6. Boundaries

- The n8n Dispatch workflow is unchanged; it still writes `fg_` fields. The consumption now happens
  in the caller, one step earlier, and a failed consumption aborts before any request leaves.
- A promoted attempt can still be closed by the normal outcome or by rollback; the authorization is
  consumed at most once regardless.
- **Rosina tools:** none added. This step introduces a mutation path, and mutations are never exposed
  to Rosina as tools.

## 7. What this unblocks

- Codex W4 / calendar work can mint a pickup through `request_pickup` and promote a candidate without
  a second attempt or a direct insert.
- The Claude Code Rosina service keeps calling the read-only voice-turn path; nothing in its contract
  changed.
