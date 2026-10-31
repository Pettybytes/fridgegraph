# Evidence 51 — resetDemo (sandbox-scoped demo restore)

_Branch `feat/reset-demo`. Backend operation complete. App button NOT wired; browser integration NOT proven._

## What it does

`resetDemo()` restores ONLY demo state, in one transaction under `pg_advisory_xact_lock`, then calls
`dropPersonaSessionCache()` **after** commit. It never calls `db:reset`.

`POST /api/demo/reset` is loopback-only, demo-session-only, refuses the Demo guide, and is rate-limited
to one reset per person per 30 s.

## The append-only exception (option 1, narrowly scoped)

`orbit_responses` stays append-only for UPDATE and ordinary DELETE; INSERT via `orbitRespond` was never
guarded and still works. Deletion is reachable only through `reset_demo_orbit()` (`SECURITY DEFINER`,
`EXECUTE` revoked from `public, anon, authenticated`), which:

- computes eligibility **once, while all rows exist**, into a session temp table;
- accepts that snapshot only if its owner is the function's own definer context;
- requires the alert to be `sandbox`, **not** tied to the consented real-call path
  (`real_call_authorizations.job_id`, `attempts.real_consent_authorization_id`), and **every** audience
  outcome `SIMULATED`/`TEST_RESPONDER` — **NULL is ineligible**;
- writes `demo_reset_audit` (actor, time, per-table counts) inside the same transaction.

`demo_caller = true` is **not** a real-consent marker; excluding it inverted the guard and was corrected.

## Proofs

`ops/reset-demo-proof.mjs` — **18/18**: ordinary DELETE fails; GUC alone fails on a non-disposable
record; RLS stops a forged delete; browser/RPC refused (403); responded disposable alert resets;
non-disposable survives; reset audited; protected hash unchanged; totals unchanged (40/9/9/91); audit
history preserved; injected failure throws with no audit row and no partial state; clean reset after.

`ops/forgery-trigger-check.mjs` — **4/4**: with RLS bypassed so the row reaches the trigger, the forged
DELETE is refused with SQLSTATE **42501** / `ORBIT_RESPONSES_APPEND_ONLY`, row intact.

`ops/reset-demo-api-proof.mjs` — **16/16**: `orbitDraft` → `orbitPreview` → `orbitActivate` →
`orbitRespond` through the **real mutations**; `responseId` captured, verified **present before** reset
and **gone after**; seeded reads restored (`myChildren`, `careFacts`, `checkInStatus`, `orbitVocabulary`,
`effectiveScheduleFor` Thanksgiving, `jobTimeline`).

Note: `orbitPreview` is a **Mutation** — a query document naming it produced `Variable "$d" is never
used`, which is what sent the earlier investigation down the wrong path.
