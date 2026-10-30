# Evidence 30 — Level B: SMS reply and no-answer (Phase B)

Append-only. Each step is appended when it finishes; earlier sections are never rewritten.
Date: 2026-10-29/30. Worktree: `../fridgegraph-level-b`, branch `feat/level-b-drafts` (PR #9).

---

## B1 — D2 one-open-attempt + D4 no-answer source

**Artifact:** `supabase/migrations/0021_one_open_attempt.sql` (forward-only; 0001-0020 untouched).
**Tools:** `ops/0021-dry-run.mjs`, `ops/0021-apply.mjs`.

### What the migration does

1. `attempts.closed_at` / `closed_reason` / `opened_by`. OPEN means `closed_at is null`.
2. Backfill, in this order: close attempts whose job has left `discovering`
   (`BACKFILL_JOB_INACTIVE`), then close older duplicates per contact keeping the newest
   (`BACKFILL_SUPERSEDED`). Without this the index could not be created on the rehearsal data.
3. `attempts_one_open_per_contact` — a **partial unique index** on `(candidate_id) where
   closed_at is null`. This is the enforcement; there is no read-then-write check.
4. `open_attempt()` — the single write path. Returns `opened:<id>` or `refused:<open id>`.
5. `close_attempt()` — idempotent close.
6. `_close_attempt_on_outcome()` — AFTER UPDATE trigger on `candidate_evaluations`. Any
   `reason_code` distinct from `'PENDING'` (including NULL, which is what an accepted answer with
   no reason code writes) closes that (job, candidate)'s attempt in the same transaction. This is
   what stops an expired discovery window from wedging a contact shut forever.
7. `accept_pickup_webhook()` — rejects a non-open attempt **before** claiming the event id, so a
   stale event produces no state change and **no** `webhook_events` row.
8. `record_no_answer()` — new; claims the event with `source='no_answer'`, closes the attempt,
   writes nothing to `candidate_evaluations`.
9. `webhook_events.source` (default `'reply'`) and outcomes widened with
   `REJECTED_CLOSED_ATTEMPT` / `NO_ANSWER`.

### Dry run — `node ops/0021-dry-run.mjs` — 20/20 PASS, rolled back

```
hash before      : 59354d99f4b53043fc3807357807b930
hash after apply : 907e1924ede4449ecf178a01cb95ed10 (changed)
PASS  partial unique index exists: 1
PASS  index is partial on closed_at is null: true
PASS  index is unique: true
PASS  attempts.closed_at exists: true
PASS  webhook_events.source exists: true
PASS  first attempt opens: true
PASS  second attempt for same contact refused: true
PASS  refusal names the open attempt: true
PASS  still exactly one open for p_bryan: 1
PASS  close_attempt closes it: true
PASS  close_attempt is idempotent: false
PASS  next attempt opens after close: true
PASS  reply to closed attempt rejected: rejected_closed
PASS  webhook_events delta 0 on rejection: 0
PASS  attempt still closed, no late reopen: true
PASS  no-answer recorded: recorded
PASS  no-answer source: no_answer
PASS  no-answer outcome: NO_ANSWER
PASS  no-answer writes nothing to candidate_evaluations: 0
PASS  no-answer closes the attempt: NO_ANSWER
hash after rollback: 59354d99f4b53043fc3807357807b930 (restored ✓)
```

**Limits of the dry run, stated plainly:** a dry run rolls back, so there is no committed index
entry for a second live connection to collide with. It proves the index *definition* and the
sequential semantics. The concurrency race is proven only after apply, below.

### Applied proof — `node ops/0021-apply.mjs`

Backfill on the live rehearsal data:

```
BACKFILL_JOB_INACTIVE  4
BACKFILL_SUPERSEDED   12
open attempts now      4   (one per contact: p_gma, p_bryan, p_tasha, p_monique)
contacts with two open attempts: 0
```

Case 1 — **real two-connection race**, same contact (`p_lbproof`), two discovering jobs:

```
connection A -> opened:att_fe26786df990af17d07a138e
connection B -> refused:att_fe26786df990af17d07a138e
PASS  exactly one concurrent creation opened: 1
PASS  the other was refused: 1
PASS  exactly one open row for the contact: 1
```

Case 2 — closing lets the next legitimate attempt open:

```
before close: {"closed_at":null,"closed_reason":null}
close_attempt -> true
next creation -> opened:att_ac7b56b05321e3d5e22704dc
```

Case 3 — event naming a closed attempt, before/after:

```
result      : rejected_closed
attempt row before: {"id":"att_fe26786df990af17d07a138e","job_id":"job_6c622d70726f6f662d612d3137",
                     "candidate_id":"p_lbproof","closed_at":null,"closed_reason":null}
attempt row after : {"id":"att_fe26786df990af17d07a138e","job_id":"job_6c622d70726f6f662d612d3137",
                     "candidate_id":"p_lbproof","closed_at":"2026-10-30T03:07:24.188Z",
                     "closed_reason":"PROOF_CLOSED"}
PASS  attempt row unchanged (closed_at/closed_reason are the values close_attempt wrote in case 2)
PASS  webhook_events delta: 0
PASS  candidate_evaluations delta: 0
```

Index as created:

```
CREATE UNIQUE INDEX attempts_one_open_per_contact ON public.attempts
  USING btree (candidate_id) WHERE (closed_at IS NULL)
```

Proof fixture: contact `p_lbproof` and jobs `job_…proof…` remain in the dev database, named so they
are recognisable. Nothing was deleted, so the before/after rows above are still queryable.

### What B1 does NOT prove (D2 correlation)

One open attempt **narrows** the window; it does not correlate. Nothing here compares an identifier
from a GHL event against an identifier stored on the attempt. A delayed event from attempt A can
still be read as attempt B once the contact's `fg_attempt_id` has changed — refusal only happens
when the event names an attempt that is already closed. **Stale-event protection is not proven by
these three cases**, and the evidence deliberately does not claim it.

### Gates

```
npm run typecheck  -> clean
npm run check      -> scanned 247 files, 0 findings
```

### B1 addendum — the wedge the first apply exposed (found, fixed, re-proven)

Immediately after the first apply, `ops/voice-turn-check.mjs` fell from 12/12 to 6/12. Cause, not
guesswork: the check asks for a pickup for contacts that already had an open attempt left over from
an older rehearsal job. Migration 0021 correctly refused to create a second attempt, the new job
therefore had no attempt, and the check posted `attemptId: undefined`, which the server rejects as
MALFORMED.

That is not a fixture problem. A job that never leaves `discovering` (nothing sweeps it) would hold
its contact's only slot open forever, so D2 as first written could wedge a real contact shut.

Fix, forward in 0021: `_expire_stale_attempts(candidate)` closes any open attempt whose job is no
longer `discovering` **or** whose job's discovery window has already passed, by TIME and not by a
vote:

```sql
and not exists (select 1 from coordination_jobs j
                 where j.id = a.job_id and j.status = 'discovering'
                   and now() < coalesce(j.created_at, now())
                               + make_interval(secs => coalesce(j.discovery_timeout_seconds, 60)))
```

It runs at the start of `open_attempt()` and once per PENDING candidate inside `_evaluate_candidates`,
in the same transaction as the insert. The partial unique index is still the enforcement.

Re-proven after the change:

```
0021 dry run   -> 20/20 PASS, rollback hash restored
0021 applied   -> all cases PASS (race: opened/refused, one open row, close->reopen, rejected_closed, delta 0)
voice-turn-check -> SUMMARY 12/12 passed
```

One behaviour change worth stating: a replayed decision now returns `note=rejected_closed` instead
of `note=duplicate`, because the first answer already closed the attempt. The observable state is
identical — no second write — and the check still passes.

---

## B4 — the nine-case mutating proof, plus the late reply

**Tool:** `ops/b4-proof.mjs` (re-runnable; every case gets a fresh job and a fresh attempt).
**Parser unit test:** `node --test ops/reply-parser.test.mjs` → 26/26 PASS, including a parity check
that the *deployed* Code node still contains the exact tested source.

No real SMS is sent and no call is placed: each inbound event is injected at the n8n webhook, which
is exactly the boundary GHL calls.

### Full run (62/62 checks pass, exit 0)

```
=== case a: "Yes, I can!" -> ACCEPTED, availability only ===
  before: {"available":null,"decline_reason":null,"accepted_via":null,"reason_code":"PENDING","cost":null,"cost_calculated_at":null,"late_reply":false}
  response 200 {"status":"ACCEPTED","note":"recorded"}
  after : {"available":true,"decline_reason":null,"accepted_via":"WEBHOOK_CALLBACK","reason_code":null,"cost":null,"cost_calculated_at":null,"late_reply":false}
  PASS  HTTP status: 200
  PASS  decision: ACCEPTED
  PASS  available: true
  PASS  accepted_via: WEBHOOK_CALLBACK
  PASS  no cost at reply time: null
  PASS  no cost timestamp at reply time: null
  PASS  attempt closed by the outcome trigger: ANSWERED_YES
  PASS  job still discovering (others unanswered): discovering
  --- a2: row after ranking (same reply) ---
  after ranking: {"available":true,"decline_reason":null,"accepted_via":"WEBHOOK_CALLBACK","reason_code":"APPROVAL_PENDING","cost":null,"cost_calculated_at":null,"late_reply":false}
  PASS  ranking recommended the driver: APPROVAL_PENDING
  PASS  a driver recommendation carries no ride cost: null
  PASS  and no cost timestamp: null
  PASS  job advanced: awaiting_approval

=== case a3: no driver available -> ranking DOES price the paid ride (0019 no-driver branch) ===
  response 200 {"status":"ACCEPTED","note":"recorded"}
  right after reply: {"available":true,"decline_reason":null,"accepted_via":"WEBHOOK_CALLBACK","reason_code":"AVAILABLE_NO_TRANSPORT","cost":null,"cost_calculated_at":null,"late_reply":false}
  PASS  reply recorded AVAILABLE_NO_TRANSPORT: AVAILABLE_NO_TRANSPORT
  PASS  reply wrote no cost: null
  PASS  reply wrote no cost timestamp: null
  after ranking: {"available":true,"decline_reason":null,"accepted_via":"WEBHOOK_CALLBACK","reason_code":"OVER_POLICY","cost":"12.40","cost_calculated_at":"2026-10-30T03:20:14.270Z","late_reply":false}
  cost=12.40 cap=10 -> over cap
  PASS  ranking explored the paid ride: OVER_POLICY
  PASS  ranking wrote a cost: true
  PASS  ranking wrote a cost timestamp: true
  PASS  over-limit is flagged on the job, not hidden: true
  PASS  cost basis is labelled: true

=== case b: curly apostrophe, no car -> DECLINED/NO_TRANSPORT ===
  before: {"available":null,"decline_reason":null,"accepted_via":null,"reason_code":"PENDING","cost":null,"cost_calculated_at":null,"late_reply":false}
  response 200 {"status":"DECLINED","note":"recorded"}
  after : {"available":false,"decline_reason":"NO_TRANSPORT","accepted_via":"WEBHOOK_CALLBACK","reason_code":"AVAILABLE_NO_TRANSPORT","cost":null,"cost_calculated_at":null,"late_reply":false}
  PASS  HTTP status: 200
  PASS  decision: DECLINED
  PASS  available: false
  PASS  decline_reason: NO_TRANSPORT
  PASS  reason_code: AVAILABLE_NO_TRANSPORT
  PASS  cost stays null: null

=== case c: a driver says "I don't have a car today" -> never recommended ===
  p_tasha vehicles on file: 1
  PASS  the caregiver really has a vehicle: true
  response 200 {"status":"DECLINED","note":"recorded"}
  after : {"available":false,"decline_reason":"NO_TRANSPORT","accepted_via":"WEBHOOK_CALLBACK","reason_code":"AVAILABLE_NO_TRANSPORT","cost":null,"cost_calculated_at":null,"late_reply":false}
  PASS  decision: DECLINED
  PASS  decline_reason: NO_TRANSPORT
  PASS  reason_code: AVAILABLE_NO_TRANSPORT
  PASS  never a driver recommendation: 0
  PASS  job not advanced: discovering

=== case d: "yesterday was rough" -> UNPARSED, no change ===
  response 200 {"status":"UNPARSED","note":"no_state_change"}
  before: {"available":null,"decline_reason":null,"accepted_via":null,"reason_code":"PENDING","cost":null,"cost_calculated_at":null,"late_reply":false}
  after : {"available":null,"decline_reason":null,"accepted_via":null,"reason_code":"PENDING","cost":null,"cost_calculated_at":null,"late_reply":false}
  PASS  HTTP status: 200
  PASS  status: UNPARSED
  PASS  evaluation unchanged: {"available":null,"decline_reason":null,"accepted_via":null,"reason_code":"PENDING","cost":null,"cost_calculated_at":null,"late_reply":false}
  PASS  no webhook_events row: 0
  PASS  attempt still open: null

=== case e: "maybe later" -> UNPARSED, no change ===
  response 200 {"status":"UNPARSED","note":"no_state_change"}
  before: {"available":null,"decline_reason":null,"accepted_via":null,"reason_code":"PENDING","cost":null,"cost_calculated_at":null,"late_reply":false}
  after : {"available":null,"decline_reason":null,"accepted_via":null,"reason_code":"PENDING","cost":null,"cost_calculated_at":null,"late_reply":false}
  PASS  HTTP status: 200
  PASS  status: UNPARSED
  PASS  evaluation unchanged: {"available":null,"decline_reason":null,"accepted_via":null,"reason_code":"PENDING","cost":null,"cost_calculated_at":null,"late_reply":false}
  PASS  no webhook_events row: 0
  PASS  attempt still open: null

=== case f: no-answer -> its own source, never a decline ===
  response 200 {"status":"NO_ANSWER","note":"recorded"}
  before: {"available":null,"decline_reason":null,"accepted_via":null,"reason_code":"PENDING","cost":null,"cost_calculated_at":null,"late_reply":false}
  after : {"available":null,"decline_reason":null,"accepted_via":null,"reason_code":"PENDING","cost":null,"cost_calculated_at":null,"late_reply":false}
  PASS  HTTP status: 200
  PASS  status: NO_ANSWER
  PASS  note: recorded
  PASS  evaluation untouched (not a decline): {"available":null,"decline_reason":null,"accepted_via":null,"reason_code":"PENDING","cost":null,"cost_calculated_at":null,"late_reply":false}
  PASS  attempt closed as NO_ANSWER: NO_ANSWER
  event row: {"source":"no_answer","outcome":"NO_ANSWER"}
  PASS  event source: no_answer
  PASS  event outcome: NO_ANSWER

=== case g: event for a closed attempt -> rejected, no change ===
  closed attempt: {"id":"att_3134c4cf211cdc601e36b323","job_id":"job_5139c7f32ae6431da8c278195d30950a","closed_at":"2026-10-30T03:20:20.370Z","closed_reason":"NO_ANSWER"}
  response 200 {"status":"ACCEPTED","note":"rejected_closed"}
  PASS  note: rejected_closed
  PASS  attempt row unchanged: {"id":"att_3134c4cf211cdc601e36b323","job_id":"job_5139c7f32ae6431da8c278195d30950a","closed_at":"2026-10-30T03:20:20.370Z","closed_reason":"NO_ANSWER"}
  PASS  webhook_events delta: 0

=== case h: a second attempt while one is open -> refused ===
  open attempt: att_5e37ef72e5db4b9863cd59cc for p_bryan
  open_attempt -> refused:att_5e37ef72e5db4b9863cd59cc
  PASS  refused: true
  PASS  refusal names the open attempt: true
  PASS  still one open for that contact: 1

=== case i: missing token 403, bad id 400, no mutation ===
  PASS  missing token: 403
  bad id response 400 {"status":"UNKNOWN_ATTEMPT","note":null}
  PASS  bad id: 400
  PASS  no webhook_events: 0
  PASS  no candidate_evaluations: 0

=== case j: a LATE reply, after the discovery window passed ===
  job job_8adf12506552499ebc006b7722156124 created_at moved 1h back; attempt left open (no sweep)
  response 200 {"status":"ACCEPTED","note":"recorded"}
  before: {"available":null,"decline_reason":null,"accepted_via":null,"reason_code":"PENDING","cost":null,"cost_calculated_at":null,"late_reply":false}
  after : {"available":true,"decline_reason":null,"accepted_via":"WEBHOOK_CALLBACK","reason_code":"APPROVAL_PENDING","cost":null,"cost_calculated_at":null,"late_reply":false}
  PASS  late reply accepted: 200
  PASS  recorded: ACCEPTED
  PASS  availability written: true

=== which job states accept a reply (read from the code) ===
  voice-turn-server.mjs: rejects only when j.status is confirmed|failed (409 END_CALL).
  accept_pickup_webhook:  rejects when status in (confirmed,failed) OR request_version
                          differs (REJECTED_STATE); accepted for discovering and
                          awaiting_approval.
  Neither checks the discovery window. The window only drives _rank_and_advance, and
  _expire_stale_attempts closes an attempt only when a NEW attempt-creation sweeps it.

B4 PROOF OK
```

### The separation, stated precisely

Both directions are proven, because 0019 has two branches and only one of them prices anything:

* **Reply path:** never writes a cost. `accept_pickup_webhook` leaves `v_cost` null (0020), so
  `estimated_ride_cost_usd` and `cost_calculated_at` are null immediately after the reply —
  captured in case a and again in case a3.
* **Ranking, driver branch:** recommends the driver and deliberately keeps cost null
  (0019, `estimated_ride_cost_usd = null`). A driver who can drive is not a paid ride.
* **Ranking, no-driver branch:** computes the estimate for a caregiver who is willing but has no
  vehicle. Case a3 shows `12.40` written by the ranking alone, `cost_calculated_at` set, and — being
  over the $10 cap — `OVER_POLICY` with `over_limit_candidate_id` set on the job rather than hidden.

So "the reply did not cost her" is not inferred from ordering; it is two distinct rows over time.

### Which job states accept a reply, and for how long

Read from the code, not assumed:

| Layer | Check | Consequence |
|---|---|---|
| `ops/voice-turn-server.mjs` | `if (row.status === 'confirmed' \|\| row.status === 'failed')` → 409 `END_CALL` | terminal jobs refuse |
| `accept_pickup_webhook` | `if v_status in ('confirmed','failed') or v_rv <> p_request_version` → `REJECTED_STATE` | terminal or stale-version refuse |
| `accept_pickup_webhook` | attempt must have `closed_at is null` (0021) | a closed attempt refuses, delta 0 |
| `accept_pickup_webhook` | `accepted_via is not null` → `duplicate` | a second answer is idempotent |

**Neither layer checks the discovery window.** The window only drives `_rank_and_advance`, and
`_expire_stale_attempts` closes an attempt only when something opens a NEW attempt for that contact.
Case j proves it: a job moved an hour into the past, with its attempt left open, still accepts a
reply and records availability.

Practical lifetime of that window: an answer is still accepted while the job is `discovering` or
`awaiting_approval`, until one of — the job goes terminal, the attempt is closed by an outcome, or a
new attempt-creation for the same contact sweeps the stale attempt. This is the honest bound the
Session 3 runbook must quote; the policy was not changed to make the test pass.
