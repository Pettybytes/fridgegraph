# GHL workflows for Level B — verified state and payload contract

Recorded 2026-10-30 (B3). Location: `GNhV1OyhFLzcl67XwTBV` (Dreemzy master — the only location
FridgeGraph touches).

---

## 1. Existence and publish state — verified against the live API

`python3 ops/ghl-workflows.py` (token read inside the process, never printed):

| Workflow | ID | Status | Version | Created | Updated |
|---|---|---|---|---|---|
| `FG-SMS-Reply` | `9908591b-f035-40ce-bae7-6a1ed94de32a` | **published** | 3 | 2026-10-30T02:31:38Z | 2026-10-30T02:42:58Z |
| `FG - No Answer` | `f85688b4-af4f-485a-86b1-0f0c49c6edd7` | **published** | 3 | 2026-10-30T02:45:31Z | 2026-10-30T02:47:16Z |

72 workflows are returned for the location; these are the only two whose names contain `fg`.

### What the API cannot tell us (stated, not worked around)

* `GET /workflows/{id}` returns **404** for this integration token, so the trigger/action graph is
  not readable through the API.
* The list object carries only `id`, `name`, `status`, `version`, timestamps, `locationId`.

**Consequence:** "published" above is proven; *which trigger each workflow uses* is **not** proven
by the API. It was taken from the build Bryan reported and must be confirmed in the UI (§4). This
distinction is deliberate — a published workflow with the wrong trigger would look identical here.

### One platform note worth keeping

`services.leadconnectorhq.com` sits behind Cloudflare, which answers **403 `error code: 1010`** for
Python's default `urllib` user agent. Adding any normal `User-Agent` fixes it. This is not a scope
or token problem — `/locations/{id}` fails the same way without the header.

---

## 2. Payload contract — proven at the wire

`node ops/reply-chain-check.mjs` posts exactly the bodies Bryan's workflows send, through the live
n8n webhooks, against a **closed** attempt so nothing mutates:

```
FG-SMS-Reply   { "attemptId": "{{contact.fg_attempt_id}}", "message": "{{message.body}}" }
FG - No Answer { "attemptId": "{{contact.fg_attempt_id}}" }
```

Result:

```
PASS  reply payload accepted by n8n: 200
PASS  reply reached the tunnel and was refused at the D2 gate: rejected_closed
PASS  no-answer payload accepted by n8n: 200
PASS  no-answer reached the tunnel and was refused at the D2 gate: rejected_closed
PASS  payload with an extra correlation field is still accepted: 200
PASS  missing action token: 403
PASS  unknown attempt id: 400
PASS  webhook_events delta: 0
PASS  attempt row unchanged
PASS  candidate_evaluations delta: 0
```

So the n8n side accepts exactly these bodies, accepts an extra `eventId`/`messageId` field without
complaint, and refuses the two failure modes without writing anything. State changes are proven
separately in evidence 30 §B4, with fresh attempts.

### One defect this check caught

The first deployed version read `$json.attemptId`. The n8n Webhook node actually emits
`{ headers, params, query, body, webhookUrl, executionMode }`, so every request answered
`400 BAD_REQUEST attemptId required`. Read from execution `14807` — not inferred. Fixed by
unwrapping `$json.body` in both Decide nodes; re-deployed and re-proven above.

---

## 3. D2 correlation — what the triggers actually provide

This is the part Bryan's design explicitly did **not** want glossed over.

**Customer Replied** (HighLevel support article 155000002677) documents these filters: Contains
Phrase, Exact Match Phrase, Has Tag, Doesn't Have Tag, Intent Type, Replied to Workflow, Reply
Channel. The reply body is available to the workflow as a variable. **No message identifier is
documented** as a workflow variable.

**Call Details** (article 48001212511) documents Call Direction, Call Status, Number Pool, Custom
Disposition, In Phone Number. Call Status values are system-recorded outcomes: `busy`, `voicemail`,
`no-answer`, `completed`. **No call id is documented** as a workflow variable.

**Therefore, today:** there is no identifier the trigger is *documented* to hand us that we could
store on the attempt and compare on the way back. `FG-SMS-Reply` sends only the contact's
`fg_attempt_id`, which is a *contact field*, not an event id. That is precisely the failure mode
D2 warned about:

> one-open-attempt narrows the window but does not stop a delayed event from attempt A being read
> as attempt B after the contact field changes.

**What is and is not proven:**

* Proven: a closed attempt id is refused with zero state change (B1 case 3, B4 case g).
* Proven: two attempts cannot be open for one contact at once (B1 case 1).
* **Not proven, and not claimed:** stale-event protection. A delayed SMS from attempt A, arriving
  after the contact's `fg_attempt_id` has been rewritten to attempt B, will be forwarded as
  attempt B and can change its state. The window is narrower; the hole is not closed.

**The one check that would close it** (Bryan, ~30 seconds in the UI): open `FG-SMS-Reply` → the
Custom Webhook action → the variable picker's `Message` group. If a message identifier is listed
(commonly `message.id`), paste this body instead of the current one:

```json
{"attemptId":"{{contact.fg_attempt_id}}","message":"{{message.body}}","eventId":"{{message.id}}"}
```

A `message.id` is then used by the n8n Decide node as the event id, and `accept_pickup_webhook`
dedupes on it — a replay becomes a `duplicate` instead of a second write. If the picker has no such
variable, **nothing changes** and this limitation stands as written. Do not invent the field: an
absent variable renders empty, and an empty `eventId` is ignored by design.

---

## 4. The no-answer trigger — verify in the UI, change only if needed

Documented path: **Call Details**, `Call Direction = Outgoing`, `Call Status` = `no-answer`
(optionally also `busy` / `voicemail` if those should count as "not reached").

The API cannot confirm which trigger `FG - No Answer` uses. Verify: Automations → Workflows →
`FG - No Answer` → the trigger node should read **Call Details**, with an Outgoing direction filter
and a Call Status filter containing **No Answer**.

If instead it is another trigger:

* **Customer Replied** — wrong event entirely. A call that is not answered produces no inbound
  message, so it will never fire.
* **Call Status / legacy "Call Completed" style triggers** — these are the older manual-status
  behaviour the current doc explicitly separates from system Call Status. They depend on an agent
  selecting an outcome, which an unattended outbound Voice AI call never does.
* **"Customer Booked Appointment" / tag-based triggers** — cannot fire from a call outcome at all.

**Exact change if it is not Call Details:** delete the trigger → Add New Trigger → **Call Details** →
Call Direction `Outgoing` → Call Status `No Answer` → Save → Publish. Leave the existing
`If fg_attempt_id is not empty` filter and the Custom Webhook to `.../webhook/ghl-no-answer` exactly
as they are; the body `{"attemptId":"{{contact.fg_attempt_id}}"}` is already proven above.

### Does Call Details fire for Voice AI outbound calls?

The article defines the trigger as enrolling "when a call log matches the conditions", and its
filters are system-recorded call metadata. Voice AI outbound calls in GHL are placed and logged by
the same calling system, so they produce call logs and are expected to qualify. **Expected, not
proven:** nothing in this task placed an outbound Voice AI call (hard stop), so the first real dial
in Session 3 is the proof. If the no-answer event does not appear, capture the call log entry for
that attempt *before* changing the trigger — that distinguishes "trigger not selected" from "Voice
AI calls do not log status here".
