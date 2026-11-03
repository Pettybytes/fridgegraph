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

## 3 · Proposed limits

Derived from the table above, not chosen for roundness:

| Limit | Value | Basis |
| --- | --- | --- |
| Per recipient, per run | **3 sends** | worst case `m_request` + `m_identity` + `m_nudge` |
| Per run (3 responders) | **9 sends** | 3 × 3 |
| Per day | **12 sends** | one run (9) + 3 for manual reconciliation follow-ups |
| Spend allowance | **$0.50** | see §4 |

## 4 · Spend

Assumed unit rate **~$0.0079 per part** (US destination). Worst case for a run: 9 parts ≈ **$0.071**.

The allowance is set at **$0.50** — roughly 7× the run cost — to absorb reconciliation reads, a duplicate that somehow slipped a gate, and manual review. It is deliberately not 10×: a cap that cannot be reached is not a cap.

**The unit rate is an assumption and must be confirmed from the actual GHL/Twilio billing rate before the window.** If the real rate is higher, the parts-based limit stands and the dollar allowance is recomputed — the limit must not be raised silently to make the run fit.

## 5 · Counting rules

- An **identity prompt** is a send.
- A **follow-up** is a send.
- **Each SMS part** counts toward spend and toward the send count.
- An `UNKNOWN` outcome **retains** its reserved allowance (the message may have been sent).
- Provider **reconciliation reads** are not sends, but their cost counts against the spend allowance.
- A refused dispatch (suppressed, cap, window, kill switch) consumes **no** send allowance.
