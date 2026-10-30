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
