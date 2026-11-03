# Contract v1.1 — Pickup SMS dispatch, reply binding, safety

**Status:** proposal, corrected after review. Nothing implemented, nothing sent.
Supersedes v1 (still OPEN in #184 — corrections stack on that branch). Changes are marked **[v1.1]**.

**Scope:** one authorized pickup request → one SMS to an approved test responder → one recorded response.
Parent approval by SMS is out of scope and stays OFF (`pickup-parent-sms-approval.v1.md`).

---

## 0 · Event order (normative)

```
authorized request
  → dispatch claimed + allowance reserved        **[v1.1] atomic, before handoff**
  → provider handoff
  → responder reply recorded                     (CAREGIVER_RESPONDED)
  → deterministic ranking / recommendation       (RANKED)
  → parent decision (in app)                     (APPROVED | DECLINED | NONE)
  → readers observe the settled state
```

A caregiver `YES` is recorded availability, **never** an approval.

## 1 · Send once **[v1.1 rewritten]**

### 1.1 Atomic claim

`dispatchId = sha256(attemptId, candidateId, jobVersion)`.

Before any provider handoff, in **one transaction**:

1. `UPDATE dispatch SET state='CLAIMED', claimedBy=<workerId>, claimedAt=now() WHERE dispatchId=$1 AND state='PENDING'` — zero rows affected means another worker owns it; **stop, do not send**.
2. Reserve allowance (run/day/recipient counters and spend) in the same transaction; if any reservation would exceed its limit, the transaction rolls back and the dispatch stays `PENDING` (or `FAILED_FINAL/LIMIT`, per policy) — **no send**.

Concurrent workers therefore cannot both send. Claim order is the only authority; there is no "check then send" window.

### 1.2 Crash and uncertainty

- A crash **before** handoff leaves `CLAIMED` with no provider message id. That is recoverable by lease expiry back to `PENDING` — nothing was sent, so re-claim is safe.
- A crash **after** handoff leaves `UNKNOWN`. **`UNKNOWN` never becomes a resend — not on retry, not on restart, not by an operator shortcut.** The allowance it reserved is retained, not returned.
- Any provider response that does not unambiguously prove acceptance (timeout, 5xx, truncated body, disconnect after write) is `UNKNOWN`.

### 1.3 Reconciliation

Reconciliation is the **only** path out of `UNKNOWN`:

- **Mechanism must be named and tested, not assumed.** If GHL exposes a reliable lookup (by outbound message id, or by conversation + timestamp window), `UNKNOWN` is reconciled to `ACCEPTED` / `FAILED_FINAL` by reading that record.
- **If no reliable lookup exists, `UNKNOWN` stays `UNKNOWN` for manual review.** The responder is not messaged again; an operator decides.
- No reconciliation path may exceed the allowance.

### 1.4 Acceptance is not delivery

Provider acceptance proves the provider took the message, **not** that a handset received it. Delivery is only claimed if a delivery receipt is observed and recorded. Absent a receipt, the record says "accepted", never "delivered".

## 2 · Reply binding **[v1.1 rewritten]**

### 2.1 Payload fields (verify before relying)

The inbound GHL payload must be inspected and its actual field names recorded. Three distinct identifiers exist and must not be conflated:

| Identifier | Role |
| --- | --- |
| **Inbound message ID** | identity of the reply; dedupe key |
| **Outbound message ID** | identity of *our* sent message; the primary binding target |
| **Conversation ID** | thread scope; may span several attempts — never sufficient alone |

Binding is: inbound reply → its conversation/message context → **outbound message id** → `dispatchId`.

### 2.2 Ambiguity and staleness

- Reuse the existing **one-open-attempt-per-caregiver** rule plus timestamps.
- A delayed reply must not bind to a **newer** attempt. Requirement: prove this with a test where attempt N is closed and attempt N+1 is open for the same caregiver, and a reply belonging to N is rejected as `REJECTED_STATE`.
- If attribution is ambiguous between two dispatches, record `REJECTED_BINDING` **without changing availability**.
- **Mutable contact fields are not correlation inputs.** `contact.fg_attempt_id` (or any contact field) may be logged as a hint and must be confirmed by the checks in §2.1–2.2.

### 2.3 Dedupe

Dedupe on **(provider identity × dispatch scope)**. Not on message text: two responders can send identical text, and one responder can send the same text twice for different attempts.

## 3 · Suppression **[v1.1 rewritten]**

- **Normalize to E.164** at ingress and before every dispatch.
- Store the lookup key as a **server-keyed HMAC of the E.164 number** — never the raw number in the suppression table. The key stays server-side.
- `STOP` / `UNSUBSCRIBE` / provider-reported opt-out → suppression is written **before any further dispatch**, and the dispatch boundary checks suppression first.
- `START` restores eligibility **only through verified provider rules**, never by asserting START in our own text parser.
- **Reset never clears suppression** (see §7).
- Provider-level behaviour must be **verified in the authorized window**: what GHL itself suppresses, and whether it will send after a STOP. Reading documentation is not verification.

## 4 · Kill switch and caps **[v1.1 rewritten]**

### 4.1 Kill switch

- One **runtime-readable, default-OFF** send-authorization flag, read at the **final handoff boundary** immediately before the provider call.
- Changing it takes effect **without a restart**.
- It blocks **new** handoffs only. **It cannot recall a message already accepted by GHL** — that limit is stated to the operator, not hidden.

### 4.2 Caps

Enforced **atomically** with the claim (§1.1):

- per run, per day, per recipient, and a spend allowance;
- counting **identity prompts, follow-ups and multipart SMS** as sends, not just the first message;
- `UNKNOWN` outcomes **retain** their reserved allowance;
- exceeding any cap is a recorded refusal (`LIMIT`), never a silent skip.

Exact numbers come from the message inventory: `pickup-message-inventory.v1.md`.

## 5 · Recipients **[v1.1]**

A recipient qualifies only if **all** hold:

1. GHL contact carries `fg-test-responder`;
2. persona is on the approved run roster — `p_gma`, `p_tasha`, `p_bryan`;
3. the private person↔phone mapping for that run exists (outside git; numbers in GHL + gitignored env).

**A new job version alone never authorizes fresh outreach.** It authorizes a new dispatch *identity*; the roster, tag, suppression and caps gates still apply in full.

**Sending window: 08:00–20:00 America/Detroit**, evaluated at handoff. Outside it, the dispatch waits; it does not send early.

## 6 · Reader freshness

Implemented alongside this workflow, not after it — `reader-freshness.v1.md`. Persisted event → visible state within **5 s** on each mounted, foreground surface, without refresh; bounded foreground polling is acceptable; caller scope preserved; late results discarded after persona/child change; **each surface measured separately**.

## 7 · Reset boundary

A demo reset must **not** erase: suppression rows, spend consumption, dispatch claims and dedupe records, or `UNKNOWN` dispatches. These are safety records. Reset clears demo content only, and the exclusion must be **proven**, not asserted.
