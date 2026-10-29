# Rosina — "Pickup decision" Custom Action (config, NOT attached)

> **STATUS: PREPARED, NOT ATTACHED.** Rosina's number is live. An action pointing at an endpoint
> that is not yet reachable through the tunnel would break real calls, so this document specifies
> the configuration and nothing was attached to the agent.

## Request

| | |
| --- | --- |
| Method | `POST` |
| URL | `https://<tunnel-host>/voice-turn` |
| `content-type` | `application/json` |
| `X-FridgeGraph-Webhook-Secret` | value held in the tunnel/Custom Action's secret setting — never in this file, never in a node |
| `X-FridgeGraph-Timestamp` | Unix seconds at send time, required; the endpoint rejects ±300 s |
| Timeout | 3 s (the endpoint answers in ~0.2–0.5 s locally) |

```json
{
  "attemptId": "<fg_attempt_id, passed through unchanged from dispatch>",
  "decision": "CONTINUE | ACCEPTED | DECLINED | ESCALATE | END_CALL",
  "declineReason": "BUSY | NO_TRANSPORT | OTHER",
  "eventId": "<optional; if omitted the endpoint derives voice:<attempt>:<decision>:<requestVersion>>"
}
```

`attemptId` must come from `fg_attempt_id` and must be round-tripped unchanged. The endpoint binds
every request to an existing `Attempt` and that job's `requestVersion`; a mismatch is rejected and
nothing is written. Identity is never taken from what the caller said.

## Response

```json
{ "status": "ACCEPTED", "note": "recorded", "say": "<one line>" }
```

Rosina says `say` **word for word** and nothing else (`rosina-kb.md` §5, §16).

## Statuses

| Status | When Rosina sends it | Effect |
| --- | --- | --- |
| `CONTINUE` | after the identity check passes, before the pickup question — or any turn with no answer to record | **none** |
| `ACCEPTED` | a clear yes to the time asked (guide §6) | records availability; the parent must still approve |
| `DECLINED` | a clear no; `declineReason` `NO_TRANSPORT` when they say they have no car | records the refusal |
| `ESCALATE` | emergency (§12), upset caller (§13), or anything the guide says to pass along | **none** |
| `END_CALL` | wrong person, bad time, voicemail, goodbye | **none** |

## What this action must never do

- **It cannot approve anything.** The endpoint has no route to `approve_pickup` and cannot create a
  `Confirmation`. Its only write is `accept_pickup_webhook`, which records availability.
- It must never be given a prompt that lets the model invent a status: the status is chosen by the
  flow, not generated.
- It must never be pointed at a host that is not the tunnel, and never carry the secret inline.

## Pre-attachment checklist

1. Tunnel reachable and only `/voice-turn` + the reply path exposed (default deny).
2. `X-FridgeGraph-Webhook-Secret` present in the action's secret setting and matching the server.
3. `fg_attempt_id` populated on the contact/call context at dispatch time.
4. One Web Call rehearsal against the live tunnel with a fictional responder before the agent is
   left attached.
