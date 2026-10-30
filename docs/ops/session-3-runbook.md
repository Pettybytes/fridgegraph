# Session 3 runbook — one dial, one real call

**Order is the safety property.** Every pre-flight item is a check with the result observed on
2026-10-30, not an assumption. If any check fails, there is no call.

Hard stops that still hold: no real SMS, Dispatch INACTIVE, `REAL_CALL_EXCEPTION_ENABLED` unset,
`FG - Dial Rosina` in draft, no `fg-dial` tag on any contact, no `RealCallAuthorization` persisted.
**`READY` only prepares the call; Bryan's explicit "go" in chat authorizes it.**

---

## 1. Pre-flight — every item observed, not assumed

| # | Check | How | Observed 2026-10-30 |
|---|---|---|---|
| 1 | Stack up | `curl -o /dev/null -w '%{http_code}' http://127.0.0.1:4001/` (+4002–4007) | **400** on 4001 (subgraph answering; a bare `GET /` is a 400 by design) — **up** |
| 2 | Router up | same on `:4010` | **400** — **up** |
| 3 | Voice-turn up | `lsof -nP -iTCP:4118 -sTCP:LISTEN` | listening; bare `GET /` → **404** (route is `POST /voice-turn` only) |
| 4 | Tunnel authenticates | `curl -X POST https://fridgegraph.loomz.stream/voice-turn` with no secret | **401** — correct. A 404 means the route is missing; 000 means it is down |
| 5 | Voice Turn workflow | `python3 ops/n8n-workflow-summary.py xOfmO6T4mKbYnjqb` | `FridgeGraph - Voice Turn` — **active: true** |
| 6 | Reply and Timeout | `… addWpgFfxXmq7GF1` | `FridgeGraph - Reply and Timeout` — **active: true** |
| 7 | Dispatch | `… A2vnWF2L58Lvquqg` | `FridgeGraph - Dispatch Pickup Attempt` — **active: false** |
| 8 | Dial workflow | `python3 ops/ghl-workflows.py` | `FG - Dial Rosina` **6f2b386e-60ed-4848-959b-ed97f1307d92, state=draft** |
| 9 | 0022 deployed | query `pg_proc` for the live signatures | `open_attempt` **5 args**, `consume_real_call_authorization` **2 args** — the 0014 4-arg form is gone |
| 10 | Window + daily guard | `node ops/dispatcher.mjs --dry <contactId>` | runs the real reads; **D6 run 16:55**: contact ok, tz `America/Detroit` (from area code), window ok, local day `04:00Z→04:00Z`, **already-called-today = none** |
| 11 | Call-history coverage | the guard reads `total` from `GET /voice-ai/dashboard/call-logs` filtered by `locationId` + `contactId` + the local-day `startDate`/`endDate`, **no `agentId` filter** | `total` is the full match count for that filter, independent of `pageSize`, so the cross-agent daily check covers every agent and every page |
| 12 | Rosina's action query param | GHL → Rosina's `pickup_decision` Custom Action | reads **`{{contact.fg_attempt_id}}`** — the literal rehearsal id is gone. **Confirmed by Bryan (UI), 2026-10-30 16:50 ET.** The API returns 403 on agent detail, so this stays a human confirmation, not a check this token can run |
| 13 | Contact `fg_` fields | GHL contact | `fg_attempt_id`, `fg_child_name`, `fg_pickup_place`, `fg_pickup_time`, `fg_reason` present |
| 14 | Dial workflow's FROM number | GHL workflow detail | **NOT verifiable read-only** — `/workflows/{id}` returns 404 for this token, and the agent object exposes only `inboundNumber`. Rosina is deployed on the number labelled **“Dreemzy HQ – Main Line”**: read-only, `GET /phone-system/numbers/location/{locationId}` returns that label with `isDefaultNumber: true` and `inboundCallService.value` equal to Rosina's `voice-ai/agents` id, so label and agent match. **Confirm the action's FROM dropdown shows “Dreemzy HQ – Main Line” by eye — the pre-flight FAILS until Bryan confirms the dropdown matches.** If it holds any other number, there is no call |
| 15 | Two pending voice checks (observed on the call) | live call | Rosina says her opener **once**; "no car" → **DECLINED / NO_TRANSPORT** |

Items 12 and 14 are **human confirmations** because the platform does not expose them to this token.
The pre-flight passes only when both are confirmed aloud, not silently skipped.

---

## 2. Tell Bryan FIRST — 60 seconds before anything is armed

Send verbatim:

> Dialing Rosina in 60 seconds. Your phone will ring from **Dreemzy HQ – Main Line**. Let it ring twice, answer,
> and say "no car" when she asks. Don't call back if it drops — I'll know from the log.

Wait the 60 seconds. An unanswered test call still spends the number's one call for the day.

---

## 3. Arm it — in this order

1. **Mint the job.** `request_pickup(child, as_of, window)` as the requesting parent. It creates the
   job, its PENDING evaluations and one `TEST_RESPONDER` attempt per eligible candidate. **There is no
   direct job insert in this path** — the deviation recorded in evidence 33 §2 is retired.
2. **Issue the `RealCallAuthorization`.** Bound to the job + the candidate being dialled + the **GHL
   contact id**, at the job's `request_version`. It is validation material until dispatch.
3. **Promote that candidate's attempt.** `promote_attempt_to_real_consented(<attemptId>, <contactId>)`
   validates the authorization against job + candidate + recipient + request version and rewrites the
   undispatched attempt to `REAL_CONSENTED`, attaching the authorization. It **does not consume**, and
   it **raises** if the authorization is missing, expired, reused, or bound elsewhere. It never
   downgrades and never opens a second attempt (the `(job_id, candidate_id)` constraint is untouched).
4. **Dispatch consumes the authorization.** `consume_real_call_authorization(<attemptId>, <contactId>)`
   is called by the dispatcher itself, atomically, immediately before anything outbound; it must
   return **true** or no call is placed. **Do not consume it by hand** — one consumption point only.
5. **Flag on:** `REAL_CALL_EXCEPTION_ENABLED=1` for the test window only.
6. **Dispatch on**, **publish `FG - Dial Rosina`**, then **apply the `fg-dial` tag**.

Never tag before every item in §1 passes and §3.1–§3.5 are green. The tag is the last action.

---

## 4. Dial, then watch

Dispatch once, then read in order: Dispatch execution → `FG - Dial Rosina` execution → Rosina's
`pickup_decision` → n8n Voice Turn → `/voice-turn` → `candidate_evaluations`.

Expected on "no car": `available=false`, `decline_reason=NO_TRANSPORT`,
`reason_code=AVAILABLE_NO_TRANSPORT`, attempt closed.

**A reply is still accepted while the job is `discovering` or `awaiting_approval`** — the discovery
window is not a gate on the reply. It stops being accepted once the job is `confirmed`/`failed`, the
attempt is closed, or the candidate has already answered.

---

## 5. Then the rollback

`node ops/session3-rollback.mjs --dry <attemptId> <contactId>` first, then without `--dry`.

It runs **local shutdown first** — Dispatch deactivate, flag check, close attempt, **expire** any
unused authorization — so a slow GHL request cannot leave anything live locally. Then it removes the
`fg-dial` tag and prints the final state.

**Residual risk, unchanged by a clean exit.** There is **no documented way to cancel a Voice AI call
GHL has already queued**. The docs only describe scheduling and limits, and a call can take minutes
to go out. Being inside 8am–8pm removes one reason for deferral but does **not** prove immediate
placement. A deferred call may still ring the **Dreemzy HQ – Main Line** number after rollback; a reply on the closed
attempt protects **app state only** — Rosina can still answer and say her greeting before the
`END_CALL` line.

**Workflow enrolment** is now a documented, implemented removal: `DELETE /contacts/{contactId}/workflow/{workflowId}`
(Contacts API, “Delete Contact from Workflow”) with the **`Version: v3`** header that page specifies
— not the call-log API's `2021-04-15` — and a required body `{"eventStartTime": <ISO-8601>}`. The
rollback script issues it after the local shutdown. A `--dry` run prints the exact request without
making it; only a non-dry run executes it, and **a DELETE cannot be proven by a read-only check**
(see §4). Removal removes the enrolment; it is **not documented as cancelling a Voice AI call GHL
has already queued**, so the residual risk above stands unchanged.

**Still manual** (no documented API): confirming the workflow is back in draft.
