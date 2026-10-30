# Rosina — "Pickup decision" Custom Action

> **STATUS: SPECIFIED FOR BRYAN TO ATTACH IN THE GHL UI.** Nothing was attached through the API.
> Rosina's number is live, so the action must not be enabled until the rehearsal in step 9 passes.

## Chain

```
GHL Custom Action ──► n8n webhook ──► tunnel ──► voice-turn server
   (this config)      (adds a fresh     https://fridgegraph.loomz.stream/voice-turn
                       timestamp +       127.0.0.1:4118
                       the secret)
```

GHL Custom Action headers are **static**, and `/voice-turn` requires a timestamp within ±300 s, so
GHL can never call the endpoint directly. The n8n workflow `FridgeGraph - Voice Turn` (id
`xOfmO6T4mKbYnjqb`, active) is the adapter. This is the same pattern as Jasmine's
`check_availability`.

## Request — the fields to enter in GHL

| Field | Value |
| --- | --- |
| Method | `POST` |
| URL | `https://fns2.app.n8n.cloud/webhook/fridgegraph-voice-turn` |
| Content type | `application/json` |
| Timeout | **10 s** |
| Retry | **off** |
| Headers | none — the secret and the timestamp are added by n8n, never stored in GHL |

Body:

```json
{
  "attemptId": "{{contact.fg_attempt_id}}",
  "decision": "CONTINUE | ACCEPTED | DECLINED | ESCALATE | END_CALL",
  "declineReason": "BUSY | NO_TRANSPORT | OTHER"
}
```

- **`attemptId` must come from `{{contact.fg_attempt_id}}`** and must be passed through unchanged.
  It is never AI-collected and never spoken by the caller. The server binds every request to an
  existing `Attempt` and that job's `requestVersion`; a mismatch is rejected and nothing is written.
- `decision` enum: **CONTINUE, ACCEPTED, DECLINED, ESCALATE, END_CALL**
- `declineReason` enum: **BUSY, NO_TRANSPORT, OTHER** (only meaningful with `DECLINED`)

## Response mapping

| | |
| --- | --- |
| Response field Rosina speaks | **`say`** |
| Rule | Say `say` **word for word** and nothing else (`rosina-kb.md` §5, §16) |

The n8n workflow returns the server's JSON unchanged on success. If the endpoint cannot be reached,
n8n returns `{"status":"FAILED","note":"voice_turn_unavailable","say":"Thank you. I couldn't confirm
your answer was recorded. If this is time-sensitive, please contact the family directly."}` — so
Rosina never improvises a confirmation.

## Statuses

| Status | When Rosina sends it | Effect |
| --- | --- | --- |
| `CONTINUE` | after the identity check passes, before the pickup question — or any turn with no answer to record | **none** |
| `ACCEPTED` | a clear yes to the time asked (guide §6) | records availability; the parent must still approve |
| `DECLINED` | a clear no; `declineReason` `NO_TRANSPORT` when they say they have no car | records the refusal |
| `ESCALATE` | emergency (§12), upset caller (§13), or anything the guide says to pass along | **none** |
| `END_CALL` | wrong person, bad time, voicemail, goodbye | **none** |

## What this action must never do

- **It cannot approve anything.** No route reaches `approve_pickup` and no `Confirmation` is created.
  Its only write is `accept_pickup_webhook`, which records availability.
- It must never be given a prompt that lets the model invent a status: the status is chosen by the
  flow, not generated.
- It must never carry the webhook secret. The secret lives only in the n8n credential
  `FridgeGraph Voice Turn`.
- It must never point at the tunnel host directly — that path cannot produce a fresh timestamp.

## Pre-attachment checklist

1. `FridgeGraph - Voice Turn` is **active** and its HTTP URL is
   `https://fridgegraph.loomz.stream/voice-turn` (verified: 7d returned 200 `CONTINUE`).
2. `fg_attempt_id` populated on the "Loretta Brooks (demo)" contact before the Web Call.
3. One Web Call rehearsal against the live chain before the agent is left attached.
