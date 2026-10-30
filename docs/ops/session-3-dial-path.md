# Session 3 dial path — the only supported way to place the call

Spec for Bryan to build in the GHL UI. **Nothing here is published or enabled.** Dispatch stays
INACTIVE and the dial-path node stays DISABLED until the Session 3 runbook says otherwise.

---

## 1. What GHL actually supports (cited)

From HighLevel's own documentation, *Voice AI Outbound Calling Setup in Workflows*
(`help.gohighlevel.com/support/solutions/articles/155000006598-voice-ai-outbound-calling`):

> Voice AI Outbound Calling allows businesses to place AI-powered outbound calls **from workflow
> actions** in HighLevel. Users can add the **Voice AI Outbound Call** action to a workflow, select an
> AI agent, choose a From Phone Number, and let the workflow schedule the call automatically.

and, in the requirements list:

> **Calls must be placed through a workflow using the Voice AI Outbound Call action.**

That is the whole supported surface. There is **no public endpoint for placing a Voice AI call**, and
the Voice AI Public APIs cover *Call Logs, Agents and Actions* — reading and configuring, not
dialing. A call-log API must never be used as a dialer; it records calls after the fact.

**Consequence for the design:** n8n cannot dial. n8n can only cause a GHL workflow to run, and that
workflow's Voice AI Outbound Call action does the dialing.

### Operational limits that matter for the test

| Guideline | Behaviour |
|---|---|
| Call hours | scheduled **8:00 AM – 8:00 PM in the contact's phone-number timezone** |
| Per phone number | **once per day** |
| Per phone number, rolling | **up to 14 times in 14 days** |
| Rate | up to 10 calls/minute per location |
| Daily cap | up to 5,000 per location |

Two of these directly constrain Session 3: the test must run inside Rosina's 8am–8pm window, and a
retry on the same day to the same number will not be placed. Budget **one real call per day**, and do
not burn it on an unverified stack.

---

## 2. The chain

```
n8n Dispatch (INACTIVE)
   │  1. POST /contacts/{contactId} style field updates  -> fg_attempt_id, fg_child_name, ...
   │  2. add tag  fg-dial-<attemptId>                     (the supported API action)
   ▼
GHL workflow "FG - Dial Rosina"  (left UNPUBLISHED until Session 3)
   │  Trigger: Contact Tag Added  =  fg-dial
   │  Action:  Voice AI Outbound Call
   │             agent      = Rosina
   │             from number = the location number assigned to Rosina
   ▼
Voice AI call  → Rosina's Custom Action `pickup_decision` → n8n Voice Turn → /voice-turn
```

Why a tag and not "add to workflow": GHL's documented enrolment for a specific workflow from outside
is a tag trigger. Adding a contact to a workflow directly is not a documented public API action, so
it is not used.

**To confirm at build time, not assumed here:** the exact Contacts API request that adds a tag. It
must be taken from GHL's Contacts API reference in the console on the day it is built; this document
deliberately does not spell a URL, because inventing one is how a dispatch silently 404s.

---

## 3. What Bryan builds in the UI

1. **Automations → Workflows → Create workflow**, name it exactly `FG - Dial Rosina`.
2. **Trigger: Contact Tag Added**, tag `fg-dial`. (Any attempt-specific tag such as `fg-dial-<id>`
   works too; the workflow only needs to distinguish "dial now" from every other tag in the account.)
3. **Filter (recommended):** `If fg_attempt_id is not empty` — same guard as the reply workflows, so
   a stray tag on an unrelated contact cannot place a call.
4. **Action: Voice AI Outbound Call**
   * AI Agent: **Rosina**
   * From Phone Number: the number assigned to Rosina for outbound
   * Accept the location-level outbound calling terms if the drawer prompts (once per location)
   * Save.
5. **Do NOT publish.** Leave the workflow in draft. Publishing it is a Session 3 step, performed
   with Dispatch, and only after the pre-flight in the runbook.

### Dispatch's own webhook (already built, stays inactive)

* Path: `/webhook/fridgegraph-dispatch` in n8n.
* Auth: **Header Auth**, credential `FridgeGraph Dispatch` — the token value enters `.env` only
  through `ops/set-env-secret.sh`, never through a workflow JSON or a command line.
* It sets the contact's `fg_` fields (`fg_attempt_id`, `fg_child_name`, `fg_pickup_place`,
  `fg_pickup_time`, `fg_reason`), stores any correlation id from D2 when one exists, and then
  performs the tag action above.
* Every node after the field updates is **DISABLED** in this task. Dispatch itself is **INACTIVE**.

---

## 4. What must be true before the dial is allowed

All of these, in order, or the dial does not happen:

1. Stack up, tunnel answering, workflows in the states the runbook lists.
2. `RealCallAuthorization` minted for the attempt and unexpired (Gate 2).
3. `REAL_CALL_EXCEPTION_ENABLED` set **only** for the test window.
4. Dispatch active, dial-path node enabled, `FG - Dial Rosina` published.
5. A human on the line who knows the call is coming.

If any one is missing, the correct outcome is no call. See `docs/ops/session-3-runbook.md`.

---

## 5. C2 inventory — what calls Dispatch when an attempt is created?

**Answer: nothing.** Searched `ops/`, `src/`, `supabase/`, `scripts/` and `docs/` for
`fridgegraph-dispatch`: the only hits are the workflow JSON itself, this contract/spec, and the
step-6 builder. `request_pickup` and `_evaluate_candidates` create the job and its attempts inside
Postgres and post nothing anywhere. There is no dispatcher, no trigger, no cron.

That is why `ops/dispatcher.mjs` now exists: a minimal caller that posts

```json
{ "attemptId": "att_…", "contactId": "ghl_contact_…", "channel": "CALL" }
```

to `/webhook/fridgegraph-dispatch` with the `X-FG-Dispatch-Token` header. The token comes from
`FG_DISPATCH_TOKEN`, created only through `ops/set-env-secret.sh FG_DISPATCH_TOKEN`.

It is **not run in this task** and **not wired into the database path**. `node ops/dispatcher.mjs
--dry` prints the request shape and sends nothing — that is the only invocation performed here.

Why the payload is smaller than §5 of the contract: the dial path only needs to know *which attempt*
and *which contact* so Dispatch can write the `fg_` fields and fire the tag. Job ids, destinations
and copy stay in Postgres where they already are; duplicating them in a dispatch body creates a
second source of truth that can go stale.
