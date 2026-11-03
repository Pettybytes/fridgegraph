# Pickup demo — scenario binding, window, and file ownership

**Status:** proposal. No sends, no stack changes.

---

## 1 · The loop being proven (primary deliverable)

```
authorized pickup request           (existing authenticated app — allowed)
  → SMS to approved test responders (dispatch contract)
  → recorded availability           (caregiver response contract)
  → deterministic recommendation    (existing ranking)
  → parent approval                 (existing app — allowed)
  → automatic app updates           (reader freshness contract)
```

Request creation and final approval use the **existing authenticated app**. Parent approval **by SMS** is a separate contract and is **not** on this path.

## 2 · Exact mapping

| Role | Person id | Notes |
| --- | --- | --- |
| Child | `p_nora` (Nora Ellison) | canonical child key selects the pack/context |
| Requester | `p_mom` (Kendra) | parent, authenticated in app |
| Responder (recipient) | `p_gma` (Loretta) | grandmother; **responder only, never approver** |
| Approver | `p_mom` (Kendra) | in-app approval only, this phase |

Authority checks: requester and approver are parents of `p_nora` via `_is_approver_for`. The responder is in the village relationship graph as a caregiver-side contact and is contacted **only** through the approved run roster.

## 3 · Outcomes to keep distinct

| Outcome | Record | What the app may say |
| --- | --- | --- |
| Driver available | availability + transport capability recorded | "available" with the stored recommendation |
| Willing without transport | willingness recorded, transport absent | "willing, no transport" — never recommended as the ride |
| No response | timeout/sweeper closes the attempt | "no response" — never "approved", never "declined" |

**Loretta's willingness must come from her actual recorded response.** No pre-seeded "she said yes", no inferred willingness, no fixture dressed as a reply.

Ride cost: display the **stored** estimate and its **basis** (`stored road distance` vs labelled haversine fallback). Never present an approval as a booking, and never present an estimate as a promise.

## 4 · Boundaries

- Only the **approved run roster and channels**. No cross-family outreach.
- **No automatic voice fallback.** Voice AI is not an automatic escalation of a silent SMS.
- Suppression + kill switch enforced at dispatch (see dispatch contract §6); consent does not replace honoring STOP.
- Reset must not erase opt-outs, spend limits or send-dedupe records.

## 5 · Proposed window

| Item | Value |
| --- | --- |
| Rehearsal | local/disposable only — no window needed |
| Live execution | **60 minutes** |
| Rollback reserve | **20 minutes** |
| Hard stop | **80 minutes** |

Stop rules: any duplicate send, any approval without a matching record, any write outside the named scenario → stop, roll back, report.

## 6 · File ownership (proposed)

| Area | Files | Owner |
| --- | --- | --- |
| Contracts | `docs/contracts/pickup-sms-dispatch.v1.md`, `reader-freshness.v1.md`, `pickup-parent-sms-approval.v1.md` | Bentley |
| Dispatch/suppression/spend schema | new `supabase/migrations/00xx_*.sql` | backend/db |
| Approval + ranking | `src/subgraphs/coordination.ts` | backend |
| Caregiver reply | `ops/voice-turn-server.mjs`, `docs/n8n/fridgegraph-voice-turn.workflow.json` | n8n/ops |
| SMS transport config | GHL workflow (not in repo) | Bryan |
| Readers | `web/src/features/{mission-control,activity,rosina}` | web |

## 7 · Gate

Contracts reviewed by Bryan → local build/rehearsal → **only then** request a window. No live send, no shared-stack change, and no invented authorization before that.
