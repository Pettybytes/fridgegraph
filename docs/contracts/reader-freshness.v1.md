# Contract v1 — Reader freshness (Ask Rosina · Activity · Mission Control)

**Status:** proposal. Nothing implemented. Applies to the three readers named in the pickup demo.

---

## 1 · Requirement

From a **persisted** event to a **visible** update in the app: **≤ 5 seconds, without a manual refresh.**

- "Persisted" means the row/record exists (dispatch, response, recommendation, approval).
- "Visible" means the reader shows the new state — not a toast, not a console log.
- Manual refresh is not a fallback that satisfies this; it is evidence the criterion failed.

## 2 · Mechanism (smallest reliable)

**Bounded foreground polling.** No push/subscription exists today, and adding one is a larger change than this demo needs.

Rules:
- Poll only while the surface is **mounted and foregrounded** (`visibilityState === 'visible'`).
- Interval bounded, and the reader stops polling while a request is in flight (no overlapping requests).
- Back off on repeated failure; do not spin.
- Each poll is an **authorized read with the caller's token** — freshness must not be achieved by widening reads.

## 3 · Lifecycle

| Condition | Behaviour |
| --- | --- |
| Reconnect after a drop | Re-read immediately, then resume the interval. Never replay a queued response. |
| Unmount | Stop polling. No late write may land on an unmounted surface. |
| Persona or child change | Discard in-flight results, clear displayed state, re-read for the new scope. A response from the previous scope must never render. |
| Scope mismatch on arrival | Discard. Stale-by-scope is a discard, not a merge. |

## 4 · Correctness over speed

- A reader may show "no response yet" or "waiting for approval" — it may **never** infer a state from timing.
- Approval is shown only when the approval record exists.
- A caregiver availability is shown as availability, never as an approval.
- If an event is `REJECTED_BINDING` / `REJECTED_STATE`, the reader shows the settled fact, not an error banner implying the request failed.

## 5 · Acceptance

Measured per surface, recorded as: `persistedAt` → `firstVisibleAt`, with the polling interval and the number of polls required.

**If any surface exceeds 5 s, it is reported as an unmet acceptance criterion with its measured value.** It is not rounded down, averaged away, or described as "near real-time".
