# Contract — n8n ↔ GHL ↔ FridgeGraph webhook

Status: **DRAFT — needs Bryan's approval.**

Covers the outbound dispatch and inbound reply path for the pickup job's voice and SMS channels:
FridgeGraph (coordination subgraph) → n8n → GHL (GoHighLevel) → a real channel → a human → GHL →
n8n → FridgeGraph. This is the external half of `docs/contracts/pickup-job.md`; read that first.
States, reasons and the no-prose-confirmation rule are not redefined here — they are **inherited
exactly**.

## 1. Topology

```
FridgeGraph (coordination:4003)
   │  dispatch (HTTPS POST, shared secret)
   ▼
n8n workflow
   │  places/sends via GHL API
   ▼
GHL (GoHighLevel): SMS conversation, or voice call with the "Muse" AI agent
   │  human replies, or Muse's Custom Action fires mid-call
   ▼
n8n workflow (webhook trigger)
   │  reply (HTTPS POST, shared secret)
   ▼
FridgeGraph (coordination:4003)
```

FridgeGraph never calls GHL directly and never holds a GHL credential — n8n is the only thing
that does. FridgeGraph never calls n8n's UI/management API either — only the two webhook
contracts below.

## 2. States and reasons (inherited, not redefined)

The job's state machine is exactly `docs/contracts/pickup-job.md` §5:

```
pending → awaiting_parent → awaiting_adult → confirmed
                 │                 │
                 └─────────────────┴──────> failed
```

`confirmed` and `failed` are terminal. A webhook event **never** moves a terminal job. There is no
separate "webhook reason code" enum — reasons are the same free-text `Candidate.reason` and
attempt/confirmation evidence already defined in the pickup-job contract and its mocks
(`docs/mocks/pickup-job-lifecycle.json`). This contract only adds the wire shape that carries those
same facts across the n8n/GHL boundary. If a future reason needs a stable code (not free text),
that is a change to `pickup-job.md` first, mirrored here second — never the other way round.

## 3. Shared secret

Header name: **`X-FridgeGraph-Webhook-Secret`**.

- Present on every request in both directions (FridgeGraph → n8n dispatch, n8n → FridgeGraph
  reply). Capitalized HTTP-header style, distinct from the internal `x-demo-*` lowercase headers
  in `docs/auth-plan.md` — this is a service-to-service boundary, not a caller-identity header.
- Value is a single shared secret, **one value**, stored in 1Password; the env var name (value
  never recorded here) is `N8N_WEBHOOK_SECRET`. Rotating it is a coordinated action across
  FridgeGraph and the n8n workflow, not a per-worktree decision.
- A request without the header, or with the wrong value, is rejected `401` before any job lookup.
  Rejection is logged with the path and timestamp only — never the submitted value.
- This header proves "this request came from our n8n instance." It does **not** prove which job
  or person the request concerns — that is the correlation id (§4) — and it is not a substitute
  for the per-resolver scope checks in `pickup-job.md` §8.

## 4. Correlation ids

Every outbound attempt already creates an `Attempt` row (`docs/contracts/data-model.md`,
`coordination` subgraph). The **correlation id is that `Attempt.id`.** No second id is minted.

- FridgeGraph includes `attemptId` (and `jobId`, `idempotencyKey` for defense-in-depth) in every
  dispatch payload.
- n8n must round-trip `attemptId` unchanged through GHL — as a custom field on the SMS
  conversation/contact, and as call metadata for voice — and include it, unchanged, on every
  reply and every Custom Action call.
- FridgeGraph indexes inbound events by `attemptId` first. A reply whose `attemptId` does not
  match an `Attempt` that exists and belongs to a non-terminal job is rejected `409` and logged —
  never guessed into the "most recent" job.

## 5. Dispatch payload — FridgeGraph → n8n

`POST https://<n8n-host>/webhook/fridgegraph-dispatch`

```json
{
  "attemptId": "att_01HXYZ",
  "jobId": "job_01HXYZ",
  "idempotencyKey": "pickup:p_nora:2026-10-28:afternoon",
  "channel": "SMS",
  "destination": "+15550100001",
  "destinationLabel": "test-responder:kendra",
  "personId": "p_kendra",
  "personDisplayName": "Kendra Okafor",
  "childId": "p_nora",
  "childDisplayName": "Nora",
  "requesterDisplayName": "Kendra",
  "message": "Hi, this is Muse, an AI assistant with FridgeGraph. I'm calling on behalf of Kendra about Nora's pickup. Is now a good time?",
  "timeoutSeconds": 600
}
```

- `channel` is `SMS` or `CALL` only in this milestone (`pickup-job.md` §7: voice is accommodated,
  not yet live beyond the Custom Action spike below).
- `destination` is always a **test-labelled** fixture number in development — never a real
  person's number. `destinationLabel` makes that unmistakable in the n8n run log.
- `message` for `CALL` is the agent's fixed opening line, reproduced verbatim above. It is not
  template-assembled per call; composing the rest of the conversation is the model's job inside
  the GHL agent, not n8n's.
- `timeoutSeconds` is advisory for n8n's own run bookkeeping; FridgeGraph is the source of truth
  for when an attempt has timed out (§6), not the workflow tool.

n8n responds `202` with `{ "accepted": true, "attemptId": "att_01HXYZ" }` once it has queued the
send. It does not wait for delivery before responding.

## 6. Timeouts

| Channel | No-reply timeout | Why |
| --- | --- | --- |
| `SMS` | 10 minutes | enough time for a person to read and answer; matches the state machine's "no timeout means no state change" rule — FridgeGraph, not n8n, decides when 10 minutes have passed |
| `CALL` | immediate on call-ended-no-answer; otherwise the call's own duration | an unanswered or failed call is an immediate signal, not a timer |

- The timeout is evaluated by FridgeGraph against the `Attempt.at` timestamp it recorded when it
  dispatched — n8n reporting late or not at all does not pause it.
- A timeout does not fail the job; it ends the wait for **that candidate** and returns control to
  the ranking step in `milestone-3-pickup-job.md` §3 ("no reply → next candidate"). Only the
  deadline for the whole job produces `failed`.

## 7. Reply payload — n8n → FridgeGraph (SMS, and voice call-completed)

`POST https://<fridgegraph-host>/webhooks/coordination/reply`

```json
{
  "attemptId": "att_01HXYZ",
  "jobId": "job_01HXYZ",
  "channel": "SMS",
  "receivedAt": "2026-10-28T15:12:04Z",
  "providerMessageId": "test_msg_0001",
  "replyText": "yes I can get her",
  "raw": { "ghlConversationId": "conv_test_001" }
}
```

- `providerMessageId` is required and is the dedupe key (§8) alongside `attemptId`.
- FridgeGraph parses `replyText` only to decide **which InformationRequest it answers**; the
  decision of whether that constitutes a `Confirmation` is coordination-subgraph logic against the
  job's open `InformationRequest`, never a keyword match trusted blindly. An ambiguous reply
  produces a new `InformationRequest` (a clarifying question), not a guessed `Confirmation` —
  `pickup-job.md` §2: "The model MAY NOT compose a confirmation."
- FridgeGraph responds `200 { "received": true }` once persisted, or `409` with a reason (§9) if
  the reply cannot be applied. n8n does not retry on `409` — a `409` means the reply was
  understood and rejected on purpose, not that delivery failed.

## 8. Duplicate replies

- Dedupe key: `(attemptId, providerMessageId)`. An exact repeat (same pair, same `replyText`) is
  idempotent — FridgeGraph returns `200 { "received": true, "duplicate": true }` and writes
  nothing a second time.
- A **different** `providerMessageId` for an `attemptId` that already produced a `Confirmation`
  (e.g., the person texts again after confirming) is accepted and stored as a second
  `Confirmation`-adjacent log entry for audit, but it **never** changes `CoordinationJob.status` —
  the job is already terminal (`confirmed`). Terminal jobs are never edited (`pickup-job.md` §5).

## 9. Late replies

A reply can legitimately arrive after FridgeGraph has stopped waiting on that attempt — the
10-minute SMS timeout fired and the job escalated to the next candidate, or the job already
reached `confirmed`/`failed` from a different attempt.

- If the job is **non-terminal but has moved past this attempt** (e.g. escalated from
  `awaiting_parent` to `awaiting_adult`): the late reply is recorded against its `Attempt` for
  audit (so the transcript is complete) but does **not** reopen or move the current state. If the
  late reply is itself a clear "yes," that is a **signal to a human**, not an automatic
  `Confirmation` — surfaced as an `InformationRequest`-style note for the next person to see, per
  `pickup-job.md` §2 ("Escalate to a parent when stuck" is the model's lane; silently reinstating a
  stale candidate is not).
- If the job is **terminal**: the late reply is recorded for audit only, tagged `late_reply: true`,
  and the response is `200 { "received": true, "applied": false, "reason": "job_terminal" }`. This
  is the one reason string this contract defines — it is a wire-level delivery fact, not a
  pickup-job state or candidate-rejection reason, so it does not collide with anything in
  `pickup-job.md`.

## 10. The GHL Custom Action — voice mid-call decision

This is the one point where the voice agent ("Muse") calls back into FridgeGraph **during** a live
call, not after it.

Muse's opening line, verbatim, every call:

> "Hi, this is Muse, an AI assistant with FridgeGraph. I'm calling on behalf of Kendra about
> Nora's pickup. Is now a good time?"

`POST https://<fridgegraph-host>/webhooks/coordination/voice-turn` (the GHL Custom Action's
configured URL; same shared-secret header as §3)

Request (GHL → FridgeGraph, one call per conversational turn that needs a decision):

```json
{
  "attemptId": "att_01HXYZ",
  "jobId": "job_01HXYZ",
  "callId": "ghl_call_7781",
  "turn": 2,
  "answer": "yes, I can pick her up around 3:30",
  "transcriptSnippet": "Caller: yes, I can pick her up around 3:30"
}
```

Response (FridgeGraph → GHL, consumed by Muse to keep talking or end the call):

```json
{
  "decision": "CONFIRMED",
  "say": "Great, thank you — I've got you down for Nora's pickup today. Have a good afternoon."
}
```

`decision` is one of:

| Decision | Meaning | Job effect |
| --- | --- | --- |
| `CONTINUE` | answer was unclear or partial | opens/updates an `InformationRequest`; no state change; `say` asks a follow-up |
| `CONFIRMED` | a clear, actionable yes was given | writes a `Confirmation` row **after this response is generated**, then `awaiting_adult`/`awaiting_parent` → `confirmed` |
| `DECLINED` | a clear no | logs the decline as the candidate's reason; job stays in its current `awaiting_*` state for the ranking step to pick the next candidate; no `Confirmation` row |
| `ESCALATE` | Muse should hand off rather than keep deciding | `say` tells the human a person will follow up; no state change; a note is left for a parent |
| `END_CALL` | nothing further to ask (deadline, repeat call, wrong number) | no state change |

- **The decision is never "confirmed" from Muse's own words.** The Custom Action request is
  evidence (an inbound `answer` from the actual call), and the `Confirmation` row is written by
  FridgeGraph's coordination logic reacting to that evidence — matching `pickup-job.md`'s rule that
  a confirmation is "a row created by inbound evidence, never by the model's prose." Muse proposes
  nothing; it reports what was said, and FridgeGraph decides and writes.
- Every `voice-turn` call is logged as part of the `Attempt`'s record, keyed by `attemptId` and
  `turn`, so the full call is reconstructable without needing a GHL-side recording.
- If FridgeGraph cannot reach the job (bad `attemptId`, terminal job), it returns `decision:
  "END_CALL"` with a neutral `say` ("Thanks, I'll follow up separately.") rather than an HTTP
  error — a live call needs a line to speak even on failure; the failure itself is still logged
  server-side as a `409`-equivalent internal event.

## 11. Forbidden (adds to `pickup-job.md` §9, does not replace it)

- Dispatching to a destination that is not a `destinationLabel`-tagged test fixture.
- Treating a `voice-turn` `CONTINUE`/`ESCALATE`/`DECLINED` response as if it were a `Confirmation`.
- Retrying a dispatch without reusing the same `attemptId` — that is a new attempt, not a resend of
  the old one, and needs its own idempotency guard per `pickup-job.md` §6.
- n8n or GHL holding, logging, or forwarding the shared secret anywhere a human-readable workflow
  log would capture it in full (log the header's presence, never its value).

## 12. Open questions for Bryan

1. **n8n hosting and the exact webhook base URLs.** This contract assumes a reachable n8n instance
   and a reachable FridgeGraph webhook endpoint (`/webhooks/coordination/*`, not yet implemented).
   Which n8n instance (cloud vs. self-hosted) and what the real base URLs are is a deployment
   decision, not a schema one.
2. **Secret rotation ownership.** Who rotates `N8N_WEBHOOK_SECRET` and how often — this contract
   only fixes the header name and that there is exactly one shared value.
3. **Does a `DECLINED` voice answer need its own `Candidate`-visible reason string**, or is logging
   it against the `Attempt` sufficient for the ranking step to skip that candidate on retry? Affects
   whether `pickup-job.md` needs a reason field added to `Attempt` in a follow-up contract change.
