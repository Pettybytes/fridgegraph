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
| 10 | Window + daily guard | `node ops/dispatcher.mjs --dry <contactId>` | runs the real reads; last run: contact ok, tz `America/Detroit` (from area code), window ok, local day `04:00Z→04:00Z`, **already-called-today = 0** |
| 11 | Call-history coverage | the guard reads `total` from `GET /voice-ai/dashboard/call-logs` filtered by `locationId` + `contactId` + the local-day `startDate`/`endDate`, **no `agentId` filter** | `total` is the full match count for that filter, independent of `pageSize`, so the cross-agent daily check covers every agent and every page |
| 12 | Rosina's action query param | GHL → Rosina's `pickup_decision` Custom Action | must read **`{{contact.fg_attempt_id}}`** — **confirm by eye**, the API returns 403 on agent detail |
| 13 | Contact `fg_` fields | GHL contact | `fg_attempt_id`, `fg_child_name`, `fg_pickup_place`, `fg_pickup_time`, `fg_reason` present |
| 14 | Dial workflow's FROM number | GHL workflow detail | **NOT verifiable read-only** — `/workflows/{id}` returns 404 for this token, and the agent object exposes only `inboundNumber`. Rosina's deployed number **is +1 248 246 6922** (`voice-ai/agents`, verified), which is the number the FROM field must hold. **Confirm the action's FROM dropdown by eye.** If it is anything else, the pre-flight FAILS |
| 15 | Two pending voice checks (observed on the call) | live call | Rosina says her opener **once**; "no car" → **DECLINED / NO_TRANSPORT** |

Items 12 and 14 are **human confirmations** because the platform does not expose them to this token.
The pre-flight passes only when both are confirmed aloud, not silently skipped.

---

## 2. Tell Bryan FIRST — 60 seconds before anything is armed

Send verbatim:

> Dialing Rosina in 60 seconds. Your phone will ring from (248) 246-6922. Let it ring twice, answer,
> and say "no car" when she asks. Don't call back if it drops — I'll know from the log.

Wait the 60 seconds. An unanswered test call still spends the number's one call for the day.

---

## 3. Arm it — in this order

1. **Mint the job + authorization.** One open attempt per contact is enforced; a fresh job is
   required. The authorization is bound to job + candidate + the **GHL contact id**.
2. **Open a `REAL_CONSENTED` attempt.** `open_attempt(job, candidate, 'CALL', <contactId>,
   'REAL_CONSENTED')`. Without a valid authorization this **raises** — it never downgrades.
3. **Consume the authorization.** `consume_real_call_authorization(<attemptId>, <contactId>)` must
   return **true** before anything outbound. A false means **stop**.
4. **Flag on:** `REAL_CALL_EXCEPTION_ENABLED=1` for the test window only.
5. **Dispatch on**, **publish `FG - Dial Rosina`**, then **apply the `fg-dial` tag**.

Never tag before every item in §1 passes and §3.1–3.4 are green. The tag is the last action.

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
placement. A deferred call may still ring (248) 246-6922 after rollback; a reply on the closed
attempt protects **app state only** — Rosina can still answer and say her greeting before the
`END_CALL` line.

**Manual steps this script cannot perform** (no documented API): confirming the contact is not
enrolled in `FG - Dial Rosina`, and confirming the workflow is back in draft.
