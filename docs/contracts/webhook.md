# Contract — n8n ↔ GHL ↔ FridgeGraph webhook

Status: **DRAFT — needs Bryan's approval.**

Covers the outbound dispatch and inbound reply path for the pickup job's voice and SMS channels:
FridgeGraph (coordination subgraph) → n8n → GHL (GoHighLevel) → a real channel → a human → GHL →
n8n → FridgeGraph. This is the external half of `docs/contracts/pickup-job.md`; read that first —
**this revision mirrors pickup-job.md's reworked parallel-discovery / accept-then-approve model.**
States, reason codes and the permission-vs-availability rule are not redefined here — they are
**inherited exactly**.

## 1. Topology

```
FridgeGraph (coordination:4003)
   │  dispatch (HTTPS POST, shared secret) — one call per candidate, fired in parallel
   ▼
n8n workflow  (the existing LOOM n8n instance — new FridgeGraph-named workflows inside it, not a
   │           separate instance)
   │  places/sends via GHL API
   ▼
GHL (GoHighLevel): SMS conversation, or voice call with the "Muse" AI agent
   │  human replies, or Muse's Custom Action fires mid-call
   ▼
n8n workflow (webhook trigger)
   │  reply (HTTPS POST, shared secret)
   ▼
FridgeGraph (coordination:4003) — reachable from n8n via a Cloudflare Tunnel, not a public port
```

**Decided (Bryan):** n8n is the existing LOOM n8n instance — FridgeGraph gets new,
FridgeGraph-named workflows inside it, not a dedicated instance. FridgeGraph's webhook endpoint is
exposed to that instance through a Cloudflare Tunnel, not a directly public port.

FridgeGraph never calls GHL directly and never holds a GHL credential — n8n is the only thing
that does. FridgeGraph never calls n8n's UI/management API either — only the two webhook
contracts below.

## 2. States and reasons (inherited, not redefined)

The job's state machine is exactly `docs/contracts/pickup-job.md` §7:

```
pending → discovering → awaiting_approval → confirmed
             │                  │
             └──────────────────┴──────> failed
```

`confirmed` and `failed` are terminal. A webhook event **never** moves a terminal job, and a
webhook event from a non-recommended candidate never moves a job that has already reached
`awaiting_approval` — "late replies never override the decision"
(`pickup-job.md` §7). Reason codes (`UNAUTHORIZED`, `UNAVAILABLE`, `AVAILABLE_NO_TRANSPORT`,
`OVER_POLICY`, `RECOMMENDED`, `APPROVAL_PENDING`) are defined once, in `pickup-job.md` §5, and are
**never** assigned by anything in this contract — the webhook layer only carries the raw signal
(`available`/`declineReason`) that feeds the deterministic policy on the FridgeGraph side.

## 3. Shared secret

Header name: **`X-FridgeGraph-Webhook-Secret`**.

- Present on every request in both directions (FridgeGraph → n8n dispatch, n8n → FridgeGraph
  reply). Capitalized HTTP-header style, distinct from the internal `x-demo-*` lowercase headers
  in `docs/auth-plan.md` — this is a service-to-service boundary, not a caller-identity header.
- Value is a single shared secret, **one value**, stored in 1Password; the env var name (value
  never recorded here) is `N8N_WEBHOOK_SECRET`.
- **Decided (Bryan):** Bryan owns rotation of this secret, and it rotates **before the repo goes
  public** — not on a worktree agent's initiative.
- A request without the header, or with the wrong value, is rejected `401` before any job lookup.
  Rejection is logged with the path and timestamp only — never the submitted value.
- This header proves "this request came from our n8n instance." It does **not** prove which job
  or person the request concerns — that is the correlation id (§4) — and it is not a substitute
  for the per-resolver scope checks in `pickup-job.md` §11.

## 4. Correlation ids

Every outbound attempt already creates an `Attempt` row (`docs/contracts/data-model.md`,
`coordination` subgraph). The **correlation id is that `Attempt.id`.** No second id is minted.
Parallel discovery (§5) means several `Attempt`s — and several correlation ids — are live for the
same job at once; nothing about the id scheme changes per attempt, only the count in flight.

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

`requestPickup` fires **one of these per candidate, all at once** — this is a single example out
of several concurrent dispatches for the same job (the real demo also dispatches to Bryan Brooks,
Tasha Ellison and Monique Davis in the same batch; see `docs/mocks/pickup-job-lifecycle.json`).

```json
{
  "attemptId": "att_01HXYZ",
  "jobId": "job_01HXYZ",
  "idempotencyKey": "pickup:p_nora:2026-10-28:afternoon",
  "channel": "CALL",
  "destination": "+1-313-555-0103",
  "destinationMode": "test-responder",
  "personId": "p_gma",
  "personDisplayName": "Loretta Brooks",
  "childId": "p_nora",
  "childDisplayName": "Nora",
  "requesterDisplayName": "Kendra",
  "message": "Hi, this is Muse, an AI assistant with FridgeGraph. I'm calling on behalf of Kendra about Nora's pickup. Is now a good time?",
  "timeoutSeconds": 60
}
```

This example calls Loretta Brooks (`p_gma`) — one of the 4 real `pickupCandidates` for Nora in
`src/fixtures.ts`/`src/derive.ts`, and the one reachable only by `CALL` in that seed (her sole
contact method) — on Kendra's (`p_mom`) behalf, which is why the opening line names Kendra as the
requester, not as the callee.

- `channel` is `SMS` or `CALL` only in this milestone (`pickup-job.md` §10: voice is accommodated,
  not yet live beyond the Custom Action spike below).
- `destinationMode` is `"test-responder"` for every candidate except the one real-call exception
  (§6a), where it is `"real-consented"`. There is no third value, and no default other than
  `"test-responder"`.
- `message` for `CALL` is the agent's fixed opening line, reproduced verbatim above. It is not
  template-assembled per call; composing the rest of the conversation is the model's job inside
  the GHL agent, not n8n's — and that composition happens **before** dispatch, never mid-call
  (§10a).
- `timeoutSeconds` is now a **per-job** setting FridgeGraph sends on every dispatch, not a global
  constant — see §6 for demo defaults. n8n treats it as advisory for its own run bookkeeping;
  FridgeGraph remains the source of truth for when an attempt has timed out.

n8n responds `202` with `{ "accepted": true, "attemptId": "att_01HXYZ" }` once it has queued the
send. It does not wait for delivery before responding.

## 6. Timeouts — per job, documented demo defaults

Timeouts are a **`CoordinationJob` setting** (**NEW** fields — `schema/coordination.graphql` has
none today), not a fixed global table. `requestPickup` sets them once per job; every dispatch in
§5 carries the resolved value for its own channel.

| Setting | Demo value | Why this value, for the demo |
| --- | --- | --- |
| `discoveryTimeoutSeconds` (SMS) | **60 s** | fast enough to keep a live demo moving; production would likely need longer (the original draft used 10 minutes) — this is a demo default, not a claim about real-world reply time |
| `discoveryTimeoutSeconds` (CALL) | immediate on call-ended-no-answer | unchanged reasoning: an unanswered or failed call is an immediate signal, not a timer |
| `approvalTimeoutSeconds` | **120 s** | how long `awaiting_approval` waits for the named approver before the job goes `failed` — new in this revision, since approval is now its own waiting state |

- Timeouts are evaluated by FridgeGraph against the `Attempt.at` / job-state-entry timestamp it
  recorded — n8n reporting late or not at all does not pause them.
- A single candidate's discovery timeout does not fail the job; it tags that candidate
  `UNAVAILABLE` (`pickup-job.md` §5) and lets the ranking proceed with whoever else has replied.
  Only the job-level discovery deadline (nobody usable) or the approval deadline (named approver
  never responds) produces `failed`.

### 6a. Real-call exception

Exactly **one** consented real phone number — a stand-in for "Grandma Loretta," supplied and
consented to by Bryan — may be dialed, and only when Bryan has explicitly enabled it for that run.
See `pickup-job.md` §10 for the full rule. At the wire level:

- That dispatch's `destinationMode` is `"real-consented"`, never `"test-responder"` and never
  absent.
- Every reply, duplicate, or late-reply record referencing that `attemptId` keeps the same
  `destinationMode` so the whole trail stays labelled, end to end.
- Outside of that one number, on that one enabled run, `destinationMode` is always
  `"test-responder"`. There is no code path that defaults it to `"real-consented"`.

## 7. Reply payload — n8n → FridgeGraph (SMS, and voice call-completed)

`POST https://<fridgegraph-host>/webhooks/coordination/reply`

```json
{
  "attemptId": "att_01HXYZ",
  "jobId": "job_01HXYZ",
  "channel": "SMS",
  "receivedAt": "2026-10-28T15:12:04Z",
  "providerMessageId": "test_msg_0003",
  "replyText": "yes I can grab her",
  "available": true,
  "declineReason": null,
  "raw": { "ghlConversationId": "conv_test_003" }
}
```

- `providerMessageId` is required and is the dedupe key (§8) alongside `attemptId`.
- `available`/`declineReason` are the structured signal that feeds `acceptPickup`
  (`pickup-job.md` §8) — `declineReason` (**NEW** enum: `BUSY`, `NO_TRANSPORT`, `OTHER`) is
  required when `available: false`. Turning free-text `replyText` into this structured signal is a
  **fast, deterministic** classification step (keyword/intent matching), not a model call blocking
  the reply path — the same latency reasoning as §10a applies here, even though an SMS reply isn't
  a live call.
- `replyText`/`raw` are kept for audit and for a human to read in Mission Control; they are never
  themselves trusted as the accept/decline signal — `available` is.
- An ambiguous reply (the classifier can't tell yes from no) does **not** guess. It produces a
  follow-up question back to that same candidate on the same channel (an `InformationRequest`,
  EXISTING type, now used only for this clarifying-question bookkeeping — not for confirmation,
  which this revision has moved to `approvePickup`).
- FridgeGraph responds `200 { "received": true }` once persisted, or `409` with a reason (§9) if
  the reply cannot be applied. n8n does not retry on `409` — a `409` means the reply was
  understood and rejected on purpose, not that delivery failed.

## 8. Duplicate replies

- Dedupe key: `(attemptId, providerMessageId)`. An exact repeat (same pair, same `available`) is
  idempotent — FridgeGraph returns `200 { "received": true, "duplicate": true }` and writes
  nothing a second time.
- A **different** `providerMessageId` for an `attemptId` whose candidate was **not** the one
  recommended is accepted and stored for audit, but changes nothing — the ranking already ran.
- A **different** `providerMessageId` for an `attemptId` whose candidate **was** recommended, after
  the job already reached `confirmed`, is accepted and stored for audit, but never changes
  `CoordinationJob.status` — the job is terminal. Terminal jobs are never edited
  (`pickup-job.md` §7).

## 9. Late replies

A reply can legitimately arrive after FridgeGraph has stopped waiting on it — the discovery
timeout fired and the ranking already picked someone else, or the job already reached
`confirmed`/`failed`.

- **Job in `discovering`, but this candidate's own timeout already fired:** the reply still
  updates that candidate's `CandidateEvaluation` (so the record is complete) and still feeds the
  ranking **if the ranking has not yet run** — ranking happens only once discovery closes (every
  candidate replied, or the job's `discoveryTimeoutSeconds` elapsed), so a reply that beats that
  deadline is not "late" even if it feels slow to the person reading it.
- **Job in `awaiting_approval` or later:** per `pickup-job.md` §7, "late replies never override the
  decision." The reply is recorded against its `CandidateEvaluation` for audit, tagged
  `late_reply: true`, and changes nothing — not the recommendation, not the job state.
- **Job terminal:** recorded for audit only, tagged `late_reply: true`, response is
  `200 { "received": true, "applied": false, "reason": "job_terminal" }`. This is the one reason
  string this contract defines at the wire level — a delivery fact, not a `pickup-job.md` reason
  code, so it never collides with the six in `pickup-job.md` §5.

## 10. The GHL Custom Action — voice mid-call decision

This is the one point where the voice agent ("Muse") calls back into FridgeGraph **during** a live
call, not after it.

Muse's opening line, verbatim, every call:

> "Hi, this is Muse, an AI assistant with FridgeGraph. I'm calling on behalf of Kendra about
> Nora's pickup. Is now a good time?"

`POST https://<fridgegraph-host>/webhooks/coordination/voice-turn` (the GHL Custom Action's
configured URL; same shared-secret header as §3)

### 10a. Latency budget — no model call in the live path

**Target: under 2 seconds**, end to end, for every `voice-turn` response. This is only reachable
because the handler is **fast, deterministic coordination logic** — intent classification against
the turn's `answer` text, a lookup against the job's current `CandidateEvaluation`, and a
canned/templated `say` line. **No model call may block a live turn.** Muse's actual reasoning — who
to ask, what to say in the opening line, how to summarize the call afterward for Mission Control —
happens **before dispatch** (composing the outbound message, §5) and **after the call ends**
(summarizing, tagging audit notes), never in the request/response path of a single turn. If a turn
genuinely cannot be classified fast enough to decide, the deterministic fallback is `CONTINUE` with
a generic clarifying `say` — never a slow path that blocks the call waiting on a model.

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
  "decision": "ACCEPTED",
  "say": "Great, thank you — someone will confirm the pickup shortly. Have a good afternoon."
}
```

`decision` is one of:

| Decision | Meaning | Job effect |
| --- | --- | --- |
| `CONTINUE` | answer was unclear or partial | opens/updates an `InformationRequest`; no state change; `say` asks a follow-up |
| `ACCEPTED` | a clear, actionable yes was given | records **availability** for this candidate via the same path as `acceptPickup` (`pickup-job.md` §8) — **never** `confirmed`. If the ranking then selects this candidate, the job moves toward `awaiting_approval` (`APPROVAL_PENDING`); the candidate is told someone will confirm, not that they're confirmed. |
| `DECLINED` | a clear no | records `declineReason` (**required**: `BUSY`, `NO_TRANSPORT`, or `OTHER`) against this candidate's `CandidateEvaluation`, feeding `UNAVAILABLE` or `AVAILABLE_NO_TRANSPORT`; job stays `discovering` for other candidates |
| `ESCALATE` | Muse should hand off rather than keep deciding | `say` tells the human a person will follow up; no state change; a note is left for a parent |
| `END_CALL` | nothing further to ask (deadline, repeat call, wrong number) | no state change |

- **There is no `CONFIRMED` decision.** The old draft's `CONFIRMED` is renamed `ACCEPTED` and its
  effect is explicitly bounded to availability — this is the single most important correction in
  this revision. A job is `confirmed` only through `approvePickup`, by the parent `approverFor`
  names for that date, never from a call.
- Every `voice-turn` call is logged as part of the `Attempt`'s record, keyed by `attemptId` and
  `turn`, so the full call is reconstructable without needing a GHL-side recording.
- If FridgeGraph cannot reach the job (bad `attemptId`, terminal job), it returns `decision:
  "END_CALL"` with a neutral `say` ("Thanks, I'll follow up separately.") rather than an HTTP
  error — a live call needs a line to speak even on failure; the failure itself is still logged
  server-side as a `409`-equivalent internal event.

## 11. Forbidden (adds to `pickup-job.md` §12, does not replace it)

- Dispatching to a destination whose `destinationMode` is not `"test-responder"` or
  `"real-consented"` — there is no third mode, and no implicit default to the latter.
- Treating a `voice-turn` `ACCEPTED` response, or any `acceptPickup` call, as if it were a
  `Confirmation`.
- Blocking a live `voice-turn` response on a model call — the latency budget (§10a) exists
  specifically to prevent this.
- Retrying a dispatch without reusing the same `attemptId` — that is a new attempt, not a resend of
  the old one, and needs its own idempotency guard per `pickup-job.md` §9.
- n8n or GHL holding, logging, or forwarding the shared secret anywhere a human-readable workflow
  log would capture it in full (log the header's presence, never its value).

## 12. Open questions for Bryan

1. **The SMS yes/no classifier (§7) is unspecified.** "Fast, deterministic" rules out a model call
   in the reply path, but whether that means a keyword list, a small rules engine, or something
   else is not decided here.
2. **Cloudflare Tunnel operational ownership.** §1 decides *that* the endpoint is reachable through
   a tunnel; who provisions and monitors it (and what happens to in-flight webhooks if it drops)
   is not decided here.
3. **Is the real-call exception's one consented number provisioned once (long-lived), or re-issued
   per run?** `pickup-job.md` §10 fixes the guardrails; provisioning lifecycle is still open.
