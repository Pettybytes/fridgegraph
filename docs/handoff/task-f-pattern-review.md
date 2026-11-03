# Task F — pattern review: text/call approvals + real call #2

**Status: REVIEW ONLY. Nothing implemented, no sends, no credentials used, no merge.**

Reviewed 2026-11-03 against `origin/main` **`e8f000d`**. Inputs are Bryan's reference exports in
`~/Desktop/fridgegraph-refs/patterns/` (outside this repo). They are reference material, not code to
copy.

---

## 0. Task F as defined (Build Line)

> **Task F — "text/call approvals + real call #2"** — real outbound sends and text/voice intake so
> caregivers can approve/respond to Orbit and pickup requests by SMS or call. Current recommendation
> was cut (real-call evidence #33 exists). The pattern review should answer: do Bryan's n8n flows
> make a minimal, safe version cheap enough to keep?

The question is not "can it be built" — it is whether the reference flows make a **minimal, safe**
version cheap enough that keeping Task F beats cutting it.

---

## 1. Inputs, and one finding that gates reuse

| File | Kind | Size |
| --- | --- | --- |
| `AIChatDemoSection.tsx` | scripted phone chat demo | 60 KB |
| `InteractiveVideoDemoSection.tsx` | branching video demo | 65 KB |
| `dashboard-demo.tsx` | dashboard with animated counters | 147 KB |
| `sms-auto-response-polling.json` | n8n, 6 nodes, inactive | 7.7 KB |
| `acuity-ghl-sync.json` | n8n, 9 nodes, active | 8.7 KB |
| `appointment-reminders.json` | n8n, 10 nodes, active | 10.8 KB |
| `check-availability.json` | n8n, 5 nodes, active | 6.5 KB |
| `create-appointment.json` | n8n, 9 nodes, active | 12.2 KB |
| `payment-confirmed.json` | n8n, 7 nodes, active | 8.7 KB |

### Blocking finding — the "sanitized" exports are not sanitized

`sms-auto-response-polling.json` carries a **live-format GHL bearer token** in two HTTP
nodes (the authorization header value is redacted here and not reproduced). The same set also
contains:

- a client phone number in three flows;
- hotlinked hosted media and a booking-widget embed;
- WhatsApp branding in `AIChatDemoSection.tsx` — logo URL, dark-green user bubbles (`#075E54`), and
  WhatsApp copy.

**Consequences, applied in this review:** no token, phone number, media URL, client name or WhatsApp
asset is reproduced here or proposed for the repo. The exports must not be committed anywhere.
**If that token is live, rotate it** — it has been sitting in a shared folder.

I did not use the token, call any GHL endpoint, or send anything.

---

## 2. n8n patterns worth taking

| Workflow | Trigger / shape | Pattern | FridgeGraph mapping | Gap before "safe" |
| --- | --- | --- | --- | --- |
| Acuity → GHL sync | `POST` webhook, parse `action` (scheduled/rescheduled/canceled), fetch appointment, upsert contact, create/update mirrored event, respond JSON | **Event → normalize → mirror → acknowledge** | Attempt-decision webhook: receive, normalize, mirror into job state, ack | No signature check, no event-id dedupe, no retry/error branch; ack is unconditional |
| Appointment reminders | Every 15 min; 45–75 min window; fetch upcoming; find contact; format; send; **mark reminded after send** | **Sweep + time window + already-sent guard** | Approval-deadline reminders and nudge timing | Send-then-mark can double-send; no per-appointment lock; no quiet hours |
| Check availability | `POST` webhook; normalize params; provider times; filter to a window | **Capability endpoint returning normalized slots** | Pickup-window availability: explicit result, no free-text parsing | Fixed 9–19 window is hard-coded; no timezone parameter |
| Create appointment | Webhook; upsert contact; payment link; format SMS; send; update phone; response reports `sms_sent` | **Multi-step with partial-failure reporting** | Approval → schedule + confirmation, reporting which leg failed | No idempotency key; retry would duplicate the SMS; payment link is Stripe-specific |
| Payment confirmed | Stripe `checkout.session.completed`; metadata → create appointment → tag → SMS | **Provider event drives the state transition** | Decision event → job transition (pattern only) | Stripe-specific; no replay protection |
| SMS auto-response (polling) | Every 1 min; search conversations; filter; LLM reply; send | **Inbound intake + reply** | Caregiver SMS replies ("YES", "NO", "CALL") into the attempt | Polling, not webhook; no dedupe; no opt-out; no signature; LLM free-text reply is not a decision parser |

**What the flows genuinely save:** the *shape* of an event-driven mirror, a reminder sweep with a
window, an explicit capability endpoint, and partial-failure reporting. Those are real design
shortcuts.

**What they do not provide:** signature verification, idempotency, retries, dead-letter handling,
opt-out/consent, rate limits, audit, or a parser that turns a caregiver's reply into a decision.
Every one of those is load-bearing for "safe".

---

## 3. What FridgeGraph already has (so reuse is narrower than it looks)

- `docs/n8n/fridgegraph-dispatch.workflow.json` — outbound SMS and call nodes exist and are
  **disabled**.
- `docs/n8n/fridgegraph-reply-timeout.workflow.json` — `ghl-reply` and `ghl-no-answer` webhooks,
  proven at the wire with `{ attemptId, message }` and `{ attemptId }`.
- `ops/voice-turn-server.mjs` — the voice-turn path the reply chain calls.
- **Evidence #33** — one real dial, unanswered (line busy), **zero** `webhook_events`, **no**
  decision. The voice decision path is *unproven*, not merely untested.

So the missing piece is not the webhook plumbing. It is the **decision contract and its safety
envelope**.

---

## 4. Phone-UI patterns

`AIChatDemoSection.tsx` is a scripted step machine: an array of steps, `setTimeout` delays, a typing
indicator, and a phone frame. `InteractiveVideoDemoSection.tsx` is a node graph with choices rendered
inside a phone frame. The dashboard demo component is out of scope — not a phone display.

| Pattern | Reuse for the three displays | Change required |
| --- | --- | --- |
| Phone frame + bubble layout | Parent / caregiver / school | Strip WhatsApp logo, green bubbles and copy; use FridgeGraph type and colours |
| Typing / staged reveal | "Recording" an approval exchange | Drive from **recorded demo events**, not a hard-coded script |
| Branching choices | Approve / decline / ask to call | Render actual decision options; local state only, labelled **Simulated** |
| Video branch graph | Not reusable | Hotlinked media and booking widget must not be carried |

**Three displays, one event stream:** parent, caregiver and school each get a projection of the same
recorded events, filtered by scope — not three scripts. School sees school-day facts only; caregiver
sees only the selected child's village; parent sees the full picture. Every screen carries
`Simulated` and never claims a send.

---

## 5. Time estimate

Assumptions: one experienced dev, existing FridgeGraph web stack, no backend deploy, recorded events
as fixtures, tests included.

| Scope | Reuse patterns | From scratch |
| --- | --- | --- |
| Sandbox-only approval demo (three displays, recorded events, no sends) | **2–3 days** | 6–8 days |
| Real **SMS** approvals (signature, dedupe, retries, opt-out, audit, kill switch) | +5–7 days | +6–9 days |
| Real **voice** approvals / call #2 (decision path, timeout semantics, evidence) | +5–8 days | +5–8 days |
| **Real path total** | **12–18 days** | 17–25 days |

The n8n flows compress the *demo* substantially and the *real* path only slightly, because the real
path is dominated by safety work the flows do not contain.

---

## 6. Recommendation

**Reuse the patterns for a sandbox-only approval demo now; cut real outbound for Task F.**

Direct answer to the question: the flows do **not** make a minimal, safe real-send version cheap
enough to keep. They save the UI frame and some timing shapes, but they arrive with a live token, no
error handling, no signatures or idempotency, and a voice decision path with no recorded decision
(evidence #33). Keeping "real" would spend 12–18 days to reach a place where the interesting risk is
still unproven.

What I would keep:

1. the reminder **window + guard** shape, as a countdown, not a sender;
2. the **capability endpoint** shape for pickup windows;
3. the **partial-failure reporting** shape;
4. the phone frame and staged reveal, rebuilt on FridgeGraph's design tokens.

What I would cut: outbound SMS, outbound calls, reply parsing as an authorization decision, and any
carry-over of WhatsApp assets or client data.

If a real version is later approved, it should start from the safety envelope in §5, not from these
exports.

---

## 7. Not done

No code, no dependency added (`framer-motion` is not a direct web dependency; `motion` is), no
credential used, no GHL or n8n call, no send, no migration, no HANDOFF edit, no merge.
