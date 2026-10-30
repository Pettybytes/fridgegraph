# Contract — n8n ↔ GHL ↔ FridgeGraph webhook

Status: **DRAFT — needs Bryan's approval.**

Covers the outbound dispatch and inbound reply path for the pickup job's voice and SMS channels:
FridgeGraph (coordination subgraph) → n8n → GHL (GoHighLevel) → a real channel → a human → GHL →
n8n → FridgeGraph. This is the external half of `docs/contracts/pickup-job.md`; read that first —
**this revision mirrors pickup-job.md Rev 3 (Bentley's implementer review, Bryan's final
decisions): HMAC-signed webhook security, a documented weaker trust boundary for the one provider
that can't sign, and Entry point A (§5a) for `acceptPickup`.** States, reason codes and the
permission-vs-availability rule are not redefined here — they are **inherited exactly**.

## Naming and attribution

- **The in-app agent is named Rosina.** ("Muse" was a placeholder name in earlier drafts; every
  reference to the agent itself is renamed in this revision. `Muse Spark`, `Muse Spark Open`, and
  `Muse Voice Transcribe` are unrelated — those are Meta's own model names and are **not**
  renamed.)
- **Tagline:** "Rosina, FridgeGraph's AI family coordinator."
- **Attribution, exactly this far and no further:** "planning and decisions powered by Meta's
  Muse Spark Open." This credits the model that plans the ranking (`pickup-job.md` §5b) and
  composes outbound messages (§5) — **never** the GHL voice itself. The voice a caller actually
  hears is a GoHighLevel capability, not a Meta model, and nothing in this contract may imply
  otherwise.
- **No recording.** Call recording is off for this demo. The `voice-turn` request/response log —
  not a GHL-side recording — is the record of what was said and decided (§10).
- **No Jetsons, no robot-maid framing.** Rosina is an AI assistant/coordinator, full stop — never
  described as a domestic robot, a maid, or any variant of that trope, anywhere this contract
  specifies copy.

## 1. Topology

```
FridgeGraph (coordination:4003)
   │  dispatch (HTTPS POST, HMAC-signed) — one call per candidate, fired in parallel
   ▼
n8n workflow  (the existing LOOM n8n instance — new FridgeGraph-named workflows inside it, not a
   │           separate instance)
   │  places/sends via GHL API
   ▼
GHL (GoHighLevel): SMS conversation, or voice call with the "Rosina" AI agent
   │  human replies, or Rosina's Custom Action fires mid-call
   ▼
n8n workflow (webhook trigger)
   │  reply (HTTPS POST, HMAC-signed)
   ▼
FridgeGraph (coordination:4003) — reachable from n8n via a Cloudflare Tunnel, not a public port
```

**Decided (Bryan):** n8n is the existing LOOM n8n instance — FridgeGraph gets new,
FridgeGraph-named workflows inside it. FridgeGraph's webhook endpoint is exposed to that instance
through a Cloudflare Tunnel, not a directly public port.

FridgeGraph never calls GHL directly and never holds a GHL credential — n8n is the only thing
that does. FridgeGraph never calls n8n's UI/management API either — only the webhook contracts
below. **No webhook, from either n8n or GHL, can ever call `approvePickup`.** Approval is reachable
only through the parent's own authenticated session — never through this contract's surface.

## 2. States and reasons (inherited, not redefined)

The job's state machine is exactly `docs/contracts/pickup-job.md` §7:

```
pending → discovering → awaiting_approval → confirmed
             │                  │
             └──────────────────┴──────> failed
```

`confirmed` and `failed` are terminal. A webhook event **never** moves a terminal job, and a
webhook event from a non-recommended candidate never moves a job that has already reached
`awaiting_approval` — "late replies never override the decision" (`pickup-job.md` §7). Reason
codes (`UNAUTHORIZED`, `NO_VERIFIED_CONTACT_METHOD`, `UNREACHABLE`, `UNAVAILABLE`,
`AVAILABLE_NO_TRANSPORT`, `OVER_POLICY`, `RECOMMENDED`, `APPROVAL_PENDING`) are defined once, in
`pickup-job.md` §5, and are **never** assigned by anything in this contract — the webhook layer
only carries the raw signal (`available`/`declineReason`, or a delivery failure) that feeds the
deterministic policy on the FridgeGraph side.

## 3. Webhook security — two trust boundaries, documented separately

**This contract has two different security levels, because the two providers have different
capabilities. Pretending they're equally strong would be dishonest; this section is explicit about
which is which.**

### 3a. n8n ↔ FridgeGraph (both directions) — the stronger boundary

- **HMAC-SHA256 signature over the raw request body plus a timestamp**, not a static shared
  header compared directly. Headers: `X-FridgeGraph-Timestamp` (Unix seconds) and
  `X-FridgeGraph-Signature` (hex HMAC-SHA256 of `${timestamp}.${rawBody}`, keyed by the shared
  secret). The env var name (value never recorded here) is `N8N_WEBHOOK_SECRET`, used as the HMAC
  key — same secret as the previous draft, different mechanism.
- **5-minute tolerance.** A request whose `X-FridgeGraph-Timestamp` is more than 300 seconds from
  FridgeGraph's own clock is rejected `401`, signature valid or not — this bounds the replay
  window even if a signature is somehow captured.
- **Constant-time verification.** The signature comparison uses a constant-time primitive (e.g.
  `crypto.timingSafeEqual`), never a naive `===`/string-equality check — a naive compare leaks
  timing information an attacker could use to forge a signature byte-by-byte.
- **Durable duplicate-event handling, at the transport layer** — distinct from the business-level
  `(attemptId, providerMessageId)` dedupe in §8. Every accepted webhook delivery's signature (or a
  provider-supplied event id, where one exists) is recorded in durable storage, not in-process
  memory, so a redelivered webhook is recognized as a duplicate even across a process restart —
  not just within one process's uptime.
- **Decided (Bryan):** Bryan owns rotation of `N8N_WEBHOOK_SECRET`, rotating it **before the repo
  goes public** — not on a worktree agent's initiative.
- A request that fails signature, timestamp, or tolerance checks is rejected `401` before any job
  lookup. Rejection is logged with the path and timestamp only — never the signature, the secret,
  or the raw body.

### 3b. GHL Custom Action → FridgeGraph (`voice-turn`) — the weaker, documented boundary

**If GHL's Custom Action tooling cannot produce an HMAC signature, this endpoint does not pretend
otherwise.** It uses the same static `X-FridgeGraph-Webhook-Secret` header as the previous draft,
plus a timestamp header, and compensates with stricter application-level binding:

- Every request must bind to an **existing `Attempt`**, that `Attempt`'s intended recipient,
  channel, and the job's `requestVersion` at dispatch time — identical checks to Entry point A
  below, just without the HMAC layer underneath them.
- **This endpoint can only ever record availability — never approval.** Stated plainly here
  because it is the weaker boundary: if it were ever compromised, the worst it can do is submit a
  false acceptance signal into the same deterministic ranking everything else feeds, not approve a
  pickup on a parent's behalf. `approvePickup` is unreachable from this endpoint by construction
  (§1).
- **This is a documented trade-off, not an invented capability.** If GHL's Custom Actions turn out
  to support request signing after all, §3a's mechanism should be used here too — this section
  exists because that was not assumed without checking, not because a weaker boundary is
  preferred.

**Risk register entry.** The static-secret-plus-timestamp scheme above is **not cryptographic
replay protection.** An HMAC signature over the body proves the body wasn't altered and (combined
with a timestamp) that the request is fresh; a bare timestamp proves neither — it only bounds a
window. **Anyone holding the shared secret can replay a request within that window**, because
nothing here is signed. This is a known, accepted risk, not an oversight, carried because GHL may
not offer a way to sign — see Open question 2. Compensating controls, all already in force:

- binding every request to an existing `Attempt`, its recipient, its channel, and the job's
  `requestVersion` (§10a's identity-confirmation turn gets the same check, not an exemption);
- **availability-only effect** — this endpoint can change a `CandidateEvaluation`, never approve
  anything;
- **no route to parental approval** — `approvePickup` is unreachable from here regardless of what
  a replayed request contains (§1);
- the real-call exception's own second, independent gate (`pickup-job.md` §10, §6a above) — even
  a successful replay against this endpoint cannot place a real call, because this endpoint has no
  path to a `RealCallAuthorization`.

Referenced from `pickup-job.md` §10 as the reason its second gate is load-bearing, not redundant.

## 4. Correlation ids

Every outbound attempt already creates an `Attempt` row (`docs/contracts/data-model.md`,
`coordination` subgraph). The **correlation id is that `Attempt.id`.** No second id is minted.
Parallel discovery means several `Attempt`s — and several correlation ids — are live for the same
job at once; nothing about the id scheme changes per attempt, only the count in flight.

- FridgeGraph includes `attemptId` (and `jobId`, `idempotencyKey`, `requestVersion` for
  defense-in-depth) in every dispatch payload.
- n8n must round-trip `attemptId` unchanged through GHL — as a custom field on the SMS
  conversation/contact, and as call metadata for voice — and include it, unchanged, on every
  reply and every Custom Action call.
- FridgeGraph indexes inbound events by `attemptId` first. A reply whose `attemptId` does not
  match an `Attempt` that exists and belongs to a non-terminal job at the expected
  `requestVersion` is rejected `409` and logged — never guessed into the "most recent" job.

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
  "requestVersion": 1,
  "channel": "CALL",
  "destination": "+1-313-555-0103",
  "destinationMode": "test-responder",
  "personId": "p_gma",
  "personDisplayName": "Loretta Brooks",
  "childId": "p_nora",
  "childDisplayName": "Nora",
  "requesterDisplayName": "Kendra",
  "message": "Hi, this is Rosina, an AI assistant with FridgeGraph. Am I speaking with Loretta?",
  "timeoutSeconds": 60
}
```

This example calls Loretta Brooks (`p_gma`) — one of the 4 real `pickupCandidates` for Nora in
`src/fixtures.ts`/`src/derive.ts`, and the one reachable only by `CALL` in that seed (her sole
contact method) — on Kendra's (`p_mom`) behalf. `message` here is **only the first line** — see
§10's two-step identity-confirmation sequence; the second line (and anything about Nora or the
pickup) is never sent until the person on the other end has confirmed they're the right person.

- `channel` is `SMS` or `CALL` only in this milestone.
- `destinationMode` is `"test-responder"` for every candidate except the one real-call exception
  (§6a), where it is `"real-consented"`. There is no third value, and no default other than
  `"test-responder"`.
- **Every call and text identifies Rosina as an AI assistant acting for the parent, as the very
  first thing said or sent** — not just on `CALL`. The first SMS in a conversation carries the
  same identity-confirmation line as the `message` above (e.g. "Hi, this is Rosina, an AI
  assistant with FridgeGraph. Am I speaking with Loretta?"), with the second line ("I'm texting on
  behalf of Kendra about a pickup...") held back the same way until identity is confirmed — composed
  **before dispatch**, never assembled mid-conversation by a live model call (§10b).
- `timeoutSeconds` is a **per-job** setting FridgeGraph sends on every dispatch — see §6 for demo
  defaults.

n8n responds `202` with `{ "accepted": true, "attemptId": "att_01HXYZ" }` once it has queued the
send. It does not wait for delivery before responding.

## 6. Timeouts — per job, documented demo defaults

Timeouts are a **`CoordinationJob` setting** (**NEW** fields), not a fixed global table.

| Setting | Demo value | Why this value, for the demo |
| --- | --- | --- |
| `discoveryTimeoutSeconds` (SMS) | **60 s** | fast enough to keep a live demo moving; a demo default, not a claim about real-world reply time |
| `discoveryTimeoutSeconds` (CALL) | immediate on call-ended-no-answer | an unanswered or failed call is an immediate signal, not a timer |
| `approvalTimeoutSeconds` | **120 s** | how long `awaiting_approval` waits for the named approver before the job goes `failed` |

A single candidate's discovery timeout tags that candidate `UNAVAILABLE` and lets the ranking
proceed with whoever else has replied; it does not fail the job. Only the job-level discovery
deadline, the approval deadline, or an explicit approver decline produces `failed`.

### 6a. Real-call exception — two gates, both required

Full rule: `pickup-job.md` §10. **`REAL_CALL_EXCEPTION_ENABLED=true` is necessary but not
sufficient.** The dispatch path checks two independent gates immediately before placing the call:

1. `REAL_CALL_EXCEPTION_ENABLED=true`, default `false` in the executable dispatch logic — never
   set by a test, a skipped step, or a simulated failure.
2. A valid, unconsumed, unexpired `RealCallAuthorization` (**NEW**), issued only with Bryan's
   explicit approval, single-use, bound to that specific recipient and that specific `Attempt`,
   validated and consumed in one atomic backend operation.

If either gate is missing or invalid, **no call is placed** — not a downgrade to a test responder,
not a silent dial anyway. At the wire level, once both gates pass for a given attempt:

- That dispatch's `destinationMode` is `"real-consented"`, never `"test-responder"` and never
  absent.
- Every reply, duplicate, or late-reply record referencing that `attemptId` keeps the same
  `destinationMode` end to end.
- Outside of that one number, on that one enabled run, `destinationMode` is always
  `"test-responder"`. No code path defaults it to `"real-consented"`.

This gate pairing is also why §3b's weaker trust boundary is an acceptable risk rather than a
blocking one: even a compromised `voice-turn` endpoint cannot, by itself, cause a real call — it
has no path to either gate.

## 7. Reply payload — n8n → FridgeGraph (SMS, and voice call-completed) — Entry point A

This is `pickup-job.md` §8's **Entry point A** for `acceptPickup` at the wire level.

`POST https://<fridgegraph-host>/webhooks/coordination/reply`

```json
{
  "attemptId": "att_01HXYZ",
  "jobId": "job_01HXYZ",
  "requestVersion": 1,
  "channel": "SMS",
  "receivedAt": "2026-10-28T15:12:04Z",
  "providerMessageId": "test_msg_0003",
  "replyText": "yes I can grab her",
  "available": true,
  "declineReason": null,
  "verifiedProviderMetadata": { "ghlConversationId": "conv_test_003", "fromNumber": "+1-313-555-0107" }
}
```

- **Binding, per `pickup-job.md` §8:** FridgeGraph's handler checks `attemptId` resolves to a
  non-terminal job at `requestVersion`, that the `Attempt`'s recorded destination matches
  `verifiedProviderMetadata.fromNumber` (the number the reply actually came from, not just a
  claimed identity in the message body), and that the channel matches. **A spoken identity in
  `replyText`, or `attemptId` alone, is never sufficient** — the provider metadata match is
  required whenever GHL supplies it.
- `providerMessageId` is required and is the business-level dedupe key (§8) alongside `attemptId`.
- `available`/`declineReason` are the structured signal. Converting free-text `replyText` into
  this signal is a **fast, deterministic keyword classifier** — not a model call. An ambiguous
  reply (the classifier can't tell yes from no) does **not** guess: it produces a follow-up
  question on the same channel (`InformationRequest`, EXISTING type) **or** flags the reply for
  human review — never an inferred acceptance.
- `replyText`/raw provider data are kept for audit and for a human to read in Mission Control; they
  are never themselves trusted as the accept/decline signal — `available` is.
- FridgeGraph responds `200 { "received": true }` once persisted, or `409` with a reason (§9) if
  the reply cannot be applied.

## 8. Duplicate replies

- Dedupe key: `(attemptId, providerMessageId)`. An exact repeat is idempotent — FridgeGraph
  returns `200 { "received": true, "duplicate": true }` and writes nothing a second time. This is
  the business-level dedupe; §3a's durable transport-level dedupe is a separate, earlier check.
- A **different** `providerMessageId` for an `attemptId` whose candidate was **not** the one
  recommended is accepted and stored for audit, but changes nothing.
- A **different** `providerMessageId` for an `attemptId` whose candidate **was** recommended,
  after the job already reached `confirmed`, is accepted and stored for audit, but never changes
  `CoordinationJob.status` — the job is terminal.

## 9. Late replies

- **Job in `discovering`, but this candidate's own timeout already fired:** the reply still
  updates that candidate's `CandidateEvaluation` and still feeds the ranking **if the ranking has
  not yet run**.
- **Job in `awaiting_approval` or later:** recorded against its `CandidateEvaluation` for audit,
  tagged `late_reply: true`, changes nothing — "late replies never override the decision"
  (`pickup-job.md` §7).
- **Job terminal:** recorded for audit only, response is
  `200 { "received": true, "applied": false, "reason": "job_terminal" }` — the one reason string
  this contract defines at the wire level.

## 10. The GHL Custom Action — voice mid-call decision (§3b's weaker boundary)

This is the one point where the voice agent ("Rosina") calls back into FridgeGraph **during** a
live call — also **Entry point A**, under the `voice-turn` endpoint's documented weaker trust
boundary (§3b).

### 10a. Turn 1 — identity confirmation, always first

Rosina's opening line, verbatim, every call, before anything else:

> "Hi, this is Rosina, an AI assistant with FridgeGraph. Am I speaking with [Contact]?"

**No child name, school, or reason is ever spoken before the contact confirms their identity.**
Only once the person confirms (turn 1's `answer` classifies as a clear yes) does Rosina speak the
second line:

> "I'm calling on behalf of [Requester] about a pickup. Is now a good time?"

— still no child name, school, or specific reason at this point either. If turn 1's answer
classifies as "no" or "wrong number," the call ends (`decision: END_CALL`) without ever reaching
the second line. This two-step sequence is itself governed by the same deterministic, sub-2-second
classifier as every other turn (§10b) — identity confirmation is not exempt from the latency
budget or the no-model-call rule.

`POST https://<fridgegraph-host>/webhooks/coordination/voice-turn` (static shared-secret header +
timestamp, per §3b — not HMAC-signed, because this is the one provider that may not support it)

### 10b. Latency budget — no model call in the live path

**Target: under 2 seconds**, end to end. The handler is **fast, deterministic coordination
logic** — intent classification against the turn's `answer` text, a lookup against the job's
current `CandidateEvaluation`, a canned/templated `say` line, and an **explicit fallback**
(`CONTINUE` with a generic clarifying line) if classification isn't confident fast enough. **No
model call may block a live turn.** Rosina's actual reasoning happens **before dispatch**
(composing the opening line/first SMS, §5) and **after the call ends** (summarizing for Mission
Control), never inside a turn's request/response.

Request (GHL → FridgeGraph, one call per conversational turn that needs a decision):

```json
{
  "attemptId": "att_01HXYZ",
  "jobId": "job_01HXYZ",
  "requestVersion": 1,
  "callId": "ghl_call_7781",
  "turn": 3,
  "answer": "yes, I can pick her up around 3:30",
  "transcriptSnippet": "Caller: yes, I can pick her up around 3:30"
}
```

(`turn: 1` was identity confirmation, `turn: 2` was "is now a good time," and `turn: 3` here is
the actual availability exchange — this example picks up after both earlier gates passed.)

Response (FridgeGraph → GHL, consumed by Rosina to keep talking or end the call):

```json
{
  "decision": "ACCEPTED",
  "say": "Great, thank you — someone will confirm the pickup shortly. Have a good afternoon."
}
```

`decision` is one of:

| Decision | Meaning | Job effect |
| --- | --- | --- |
| `CONTINUE` | answer was unclear, or classification wasn't confident within budget (the explicit fallback) | opens/updates an `InformationRequest`; no state change; `say` asks a follow-up |
| `ACCEPTED` | a clear, actionable yes | records **availability only**, via the same shared transactional logic as `acceptPickup` (`pickup-job.md` §8) — **never** `confirmed`. The candidate is told someone will confirm, not that they're confirmed. |
| `DECLINED` | a clear no | records `declineReason` (**required**: `BUSY`, `NO_TRANSPORT`, or `OTHER`); job stays `discovering` for other candidates |
| `ESCALATE` | Rosina should hand off rather than keep deciding | `say` tells the human a person will follow up; no state change |
| `END_CALL` | nothing further to ask (deadline, repeat call, wrong number) | no state change |

- **There is no `CONFIRMED` decision, and this endpoint can never produce one.** `confirmed`
  happens only through `approvePickup`, by the parent `approverFor` names for that date, through
  the parent's own authenticated session — never through any webhook (§1).
- Every `voice-turn` call is logged as part of the `Attempt`'s record, keyed by `attemptId` and
  `turn`.
- If FridgeGraph cannot reach the job (bad `attemptId`, terminal job), it returns `decision:
  "END_CALL"` with a neutral `say` rather than an HTTP error — the failure itself is still logged
  server-side as a `409`-equivalent internal event.

## 11. Forbidden (adds to `pickup-job.md` §12, does not replace it)

- Dispatching to a destination whose `destinationMode` is not `"test-responder"` or
  `"real-consented"`.
- Treating a `voice-turn` `ACCEPTED` response, or any `acceptPickup` call from either entry point,
  as if it were a `Confirmation`.
- Calling `approvePickup` from a webhook, or building any path that would let one.
- Trusting a spoken identity, or a bare `attemptId`, as sufficient binding when provider metadata
  is available and wasn't checked.
- Comparing an HMAC signature with a non-constant-time operation.
- Blocking a live `voice-turn` response on a model call.
- Retrying a dispatch without reusing the same `attemptId`.
- n8n or GHL holding, logging, or forwarding `N8N_WEBHOOK_SECRET` or the `voice-turn` shared
  secret anywhere a human-readable workflow log would capture it in full.
- Storing the real-call exception's number in this repo, or claiming GHL supports HMAC signing
  without having confirmed it.
- Placing a real call on `REAL_CALL_EXCEPTION_ENABLED=true` alone, without a valid, unconsumed,
  unexpired `RealCallAuthorization` bound to that recipient and that attempt (`pickup-job.md` §10,
  §6a above).
- Treating this endpoint's static-secret-plus-timestamp scheme as replay-proof — it isn't (risk
  register, §3b).

## 12. Open questions for Bryan

Resolved this revision: webhook security mechanism and the two trust boundaries (§3), SMS
deterministic-classifier behavior on ambiguity (§7), and Rosina's AI-disclosure requirement on SMS
as well as voice (§5). Still open:

1. **Cloudflare Tunnel operational ownership** — who provisions/monitors it, and what happens to
   in-flight webhooks if it drops — is not decided here.
2. **Whether GHL's Custom Actions can sign requests at all** has not been confirmed either way;
   §3b assumes "no" and documents the compensating controls. If the answer turns out to be "yes,"
   this section should be revisited rather than left as the permanent weaker boundary.
3. **Durable duplicate-event storage mechanism** (§3a) — which store, what retention — is
   specified as a requirement, not a concrete implementation.

---

## Appendix — Level B decisions (Bryan, recorded 2026-10-30)

**D1.** SMS replies and no-answer events reuse the `voice-turn` chain: GHL Workflow → n8n (header
auth `X-FG-Action-Token`) → n8n stamps a fresh timestamp, attaches the `FridgeGraph Voice Turn`
credential, posts to `https://fridgegraph.loomz.stream/voice-turn`. The signed
`/webhooks/coordination/reply` route stays closed at the tunnel and is not used by GHL.

**D2.** One open attempt per contact, enforced by a partial unique index
(`attempts_one_open_per_contact` on `(candidate_id) where closed_at is null`). A new attempt is
refused while another is open. An event naming a non-open attempt is rejected **before** the event id
is claimed, so `webhook_events` does not grow.

**D2-correlation is NOT satisfied.** One open attempt narrows the window; it does not correlate. A
delayed event from attempt A can still be read as attempt B once `contact.fg_attempt_id` has changed.
Closing that requires an event identifier from the trigger, which neither Customer Replied nor Call
Details documents today (see `docs/ghl/ghl-workflows.md` §3). Rejecting a directly supplied closed
attempt id is **not** evidence of stale-event protection.

**D3.** Deterministic parsing in an n8n Code node (`ops/reply-parser.mjs`, single source of truth).
No model parses a reply. Unparsed text changes nothing.

**D4.** `webhook_events.source` distinguishes `reply` from `no_answer`. `record_no_answer()` writes
no `candidate_evaluations` row: a call nobody answered is never a person saying no.

**D5.** Say lines carry the requester's and child's real first names, resolved server-side from the
attempt; unresolved names become "the family".
