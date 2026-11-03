# Pickup demo — scenario binding, window, and file ownership (v1.1)

**Status:** proposal. No sends, no stack changes. Corrections marked **[v1.1]**.

---

## 1 · The loop being proven (primary deliverable)

```
authorized pickup request           (existing authenticated app — allowed)
  → SMS to approved test responders (dispatch contract)
  → recorded availability           (caregiver response contract)
  → deterministic recommendation    (existing ranking)
  → parent confirms in the app      (existing app — allowed)
  → automatic app updates           (reader freshness contract)
```

Request creation and final confirmation use the **existing authenticated app**. Parent approval **by SMS stays OFF** and is not on this path.

## 2 · Exact mapping

| Role | Person id | Notes |
| --- | --- | --- |
| Child | `p_nora` (Nora Ellison) | canonical child key |
| Requester | `p_mom` (Kendra) | parent, authenticated app |
| Responder (recipient) | `p_gma` (Loretta) | **responder only, never approver** |
| Additional responders | `p_tasha`, `p_bryan` | fan-out phase only |
| Approver | `p_mom` (Kendra) | in-app confirmation only |

Private person↔phone mapping: `~/.openclaw/private/pickup-responders/2026-11-03.map.json` (outside git; numbers in GHL + gitignored env).

## 3 · Outcomes to keep distinct

| Outcome | Record | What the app may say |
| --- | --- | --- |
| Driver available | availability + transport capability recorded | "available" with the stored recommendation |
| Willing without transport | willingness recorded, transport absent | "willing, no transport" — never recommended as the ride |
| No response | timeout/sweeper closes the attempt | "no response" — never "approved", never "declined" |

**Loretta's willingness must come from her actual recorded response.** No pre-seeded yes, no inferred willingness, no fixture dressed as a reply.

Ride cost: display the **stored** estimate and its **basis**. An approval is never presented as a booked ride.

## 4 · Boundaries **[v1.1]**

- A recipient qualifies only with **both** the GHL `fg-test-responder` tag **and** membership of the approved run roster (`p_gma`, `p_tasha`, `p_bryan`), plus the private mapping. Tag alone or roster alone is not enough.
- **A new job version never authorizes fresh outreach by itself.** It creates a new dispatch identity; tag, roster, suppression, cap and window gates still apply in full.
- **Sending window 08:00–20:00 America/Detroit**, evaluated at handoff. Outside it the dispatch waits; it does not send early.
- Only approved channels. **No cross-family outreach.**
- **No automatic voice fallback.** Voice AI is not an automatic escalation of a silent SMS.
- Suppression + kill switch enforced at the final handoff boundary; consent does not replace honoring STOP.
- Reset must not erase opt-outs, spend consumption or send-dedupe records.

## 5 · Proposed window **[v1.1]**

| Item | Value |
| --- | --- |
| Rehearsal | local/disposable only — no window needed |
| Live execution | **60 minutes**, inside 08:00–20:00 Detroit |
| Rollback reserve | **20 minutes** |
| Hard stop | **80 minutes** |

Stop rules: any duplicate send, any approval without a matching record, any write outside the named scenario, any send outside the window → stop, roll back, report.

## 6 · Proof sequence **[v1.1]**

1. **Single-responder loop first** — Loretta only: request → SMS → her recorded availability → recommendation → parent confirms in the app → all three readers update. Nothing else runs until this passes.
2. **Three-responder fan-out** — only after (1) passes, with the tag + roster gate enforced.

### Offline rehearsal matrix (disposable only, no provider)

| # | Case |
| --- | --- |
| 1 | duplicate workers claim the same dispatch — exactly one sends |
| 2 | crash after handoff — stays `UNKNOWN`, no resend after restart |
| 3 | uncertain acceptance (timeout / 5xx) — `UNKNOWN`, allowance retained |
| 4 | stale reply for a closed attempt — rejected, availability unchanged |
| 5 | `STOP` — suppressed before any further dispatch |
| 6 | kill switch on mid-run — new handoffs block, no recall claimed |
| 7 | concurrent cap exhaustion — atomic refusal, no oversend |
| 8 | reset — suppression, spend and dedupe survive |
| 9 | persona isolation — no cross-family reads or sends |

Every case records its outcome; a case that cannot run reports **BLOCKED**, never pass.

## 7 · File ownership

| Area | Files | Owner |
| --- | --- | --- |
| Contracts | `docs/contracts/pickup-*.v1.md`, `reader-freshness.v1.md` | Bentley |
| Dispatch/suppression/spend schema | new `supabase/migrations/00xx_*.sql` | backend/db |
| Approval + ranking | `src/subgraphs/coordination.ts` | backend |
| Caregiver reply | `ops/voice-turn-server.mjs`, `docs/n8n/*` | n8n/ops |
| SMS transport config | GHL workflow (not in repo) | Bryan |
| Readers | `web/src/features/{mission-control,activity,rosina}` | web |

## 8 · Gate

Contract review → local build and rehearsal → window request. **No live send, no shared-stack change, no invented authorization.**
