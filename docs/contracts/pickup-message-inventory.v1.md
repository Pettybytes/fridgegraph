# Message inventory v1 — outbound copy, parts, and exact limits

**Status:** proposal. Drives the caps in `pickup-sms-dispatch.v1.md` §4.2.

---

## 1 · Copy set

ASCII-only, GSM-7, no emoji, no smart quotes — Unicode forces 70 chars/part and changes every number below.

| ID | Purpose | When | Copy (draft) | Chars | Parts |
| --- | --- | --- | --- | --- | --- |
| `m_request` | initial ask | dispatch claim accepted | `FridgeGraph demo: can you pick up Nora today at 3:00 PM? Reply YES or NO.` | 74 | **1** |
| `m_identity` | unattributed reply | only if a reply cannot be bound | `FridgeGraph demo: reply YES or NO to confirm you can pick up Nora today.` | 79 | **1** |
| `m_nudge` | no response | only once, inside window | `FridgeGraph demo: still need an answer for Nora's pickup today. YES or NO.` | 76 | **1** |

All three sit under 160 GSM-7 chars, so **1 part each** at current copy. Any rewrite that pushes past 160, or introduces a non-GSM character, must update this table before the cap is used.

## 2 · Worst-case sends per dispatch

| Path | Messages | Parts |
| --- | --- | --- |
| happy path (request → reply) | 1 | 1 |
| ambiguous reply (identity prompt) | 2 | 2 |
| no reply (request + one nudge) | 2 | 2 |
| worst case (all three) | 3 | 3 |

## 3 · Outbound caps (operator-set, authoritative)

These replace the earlier illustrative limits. They are **not derived from the copy** — they are set policy.

| Cap | Value | Window |
| --- | --- | --- |
| Per run | **50 outbound SMS segments** | one run |
| Per recipient | **15 segments** | one run |
| All runs combined | **150 segments** | per America/Detroit calendar day |

**Unit is the SMS segment**, because that is the billing unit. A message of 2 parts consumes 2 of the allowance. The copy table in §1 shows each message is currently 1 part, so 50 segments ≈ 50 single-part messages — but the cap is enforced on segments, not messages.

**All outbound messages count**: every pickup request, every identity prompt, every follow-up. There is no uncounted message class.

## 3a · Reservation rules

- Allowance is **reserved atomically before provider handoff** — the same transaction as the dispatch claim. A send cannot proceed on unreserved allowance.
- An **uncertain outcome keeps its reservation.** `UNKNOWN` never returns allowance, because the message may have been sent.
- **Reset and restart must not replenish allowance.** Neither may reset the counters, and neither may return `UNKNOWN` reservations.
- **Never automatically resend to consume remaining allowance.** Leftover allowance is not a reason to send; it is simply unused.
- **Hitting a cap blocks the send and records the reason** (`LIMIT_RUN`, `LIMIT_RECIPIENT`, `LIMIT_DAY`), with used/remaining at the moment of refusal.

## 3b · Operator receipt

Every run receipt must show, for each cap: **used / remaining**, plus the count of `UNKNOWN` dispatches holding reservations. A receipt that reports only totals, without remaining headroom, does not satisfy this.

## 4 · Spend (informational — segments are the enforced cap)

The binding limits are the **segment caps in §3**. Spend is shown so cost is not invisible, not as the primary gate.

Assumed unit rate **~$0.0079 per segment** (US destination):

| Case | Segments | Approx cost |
| --- | --- | --- |
| Expected run (3 responders × 3 messages) | 9 | ~$0.071 |
| Run at the 50-segment cap | 50 | ~$0.40 |
| Day at the 150-segment cap | 150 | ~$1.19 |

A **$1.00** backstop is retained **per run** so a runaway cannot exceed the day cap in one incident. It does not replace the segment caps, and exhausting it blocks sends exactly like a cap.

**The unit rate is an assumption** and must be confirmed from the GHL/Twilio billing rate before the window. If it is higher, the segment caps still stand and the dollar backstop is recomputed — it is never raised silently to make a run fit.

## 5 · Counting rules

- An **identity prompt** is a send.
- A **follow-up** is a send.
- **Each SMS segment** counts toward the caps — a 2-part message consumes 2.
- An `UNKNOWN` outcome **retains** its reserved allowance.
- Provider **reconciliation reads** are not sends; their cost is shown but consumes no segment allowance.
- A refused dispatch (suppressed, cap, window, kill switch) consumes **no** allowance.
- Remaining allowance is never a reason to send.
