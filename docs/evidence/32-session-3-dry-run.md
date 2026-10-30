# Evidence 32 — Session 3 dry run (D6)

_2026-10-30, 16:48–16:56 ET. `node ops/d6-dry-run.mjs` on `feat/level-b-drafts`.
Exit 0: **38 PASS, 0 FAIL, 3 HUMAN.** Nothing external was changed._

This is a dry run of `docs/ops/session-3-runbook.md` end to end. It is **not** a real call and not a
real SMS. The numbers below are observed, not expected.

---

## 1. Pre-flight (§1 of the runbook)

| # | Check | Observed this run |
|---|---|---|
| 1 | Stack 4001–4007 | **400** on all seven (a bare `GET /` is a 400 by design) — up |
| 2 | Router 4010 | **400** — up |
| 3 | Voice-turn 4118 | **404** — up; the route is `POST /voice-turn` only |
| 4 | Tunnel authenticates | **401** with no secret — correct; a 404 would mean the route is missing |
| 5 | `FridgeGraph - Voice Turn` | **active=true** |
| 6 | `FridgeGraph - Reply and Timeout` | **active=true** |
| 7 | `FridgeGraph - Dispatch Pickup Attempt` | **active=false** |
| 8 | `FG - Dial Rosina` `6f2b386e…` | **state=draft** |
| 9 | 0022 deployed | `open_attempt` **5 args** (no 4-arg form); `consume_real_call_authorization` **2 args** (no 4-arg form) |
| 10 | Window + timezone guard | contact read ok; tz `America/Detroit` from the area code; local **16:55**; allowed 8:00–20:00; local day `2026-10-30T04:00Z → 2026-10-31T04:00Z` |
| 11 | Cross-agent daily check | `already called today`: **no Voice AI call to this contact in the local day (across all agents)** |
| 12 | `pickup_decision` query param | **confirmed by Bryan (UI), 2026-10-30 16:50 ET** — reads `{{contact.fg_attempt_id}}`; the API 403s on agent detail, so this is a human confirmation |
| 13 | `fg_` contact fields | **5/5 present**: `fg_attempt_id`, `fg_child_name`, `fg_pickup_place`, `fg_pickup_time`, `fg_reason` (`fg_requester_name` also exists) |
| 14 | FROM number | label **“Dreemzy HQ – Main Line”**, `isDefaultNumber=true`, `inboundCallService.type=voice_ai` and `value` equal to Rosina's agent id in `voice-ai/agents` — **label and agent match**. The dropdown itself is **still pending Bryan's eye check**; the pre-flight fails until it matches |
| 15 | Voice behaviour | **UNVERIFIED** — one opener, and “no car” → DECLINED/NO_TRANSPORT can only be observed on a real call |

Read-only API used for 14: `GET /phone-system/numbers/location/{locationId}` (Version 2021-07-28).
The label is the only reference to the number in this file, per Bryan's instruction.

---

## 2. Database steps (real, TEST_RESPONDER)

| Step | Result |
|---|---|
| `request_pickup` as the mother | job `job_3fcfbcf509e14cb686e0b45c8b51b062`, status `discovering`, v1 |
| attempt for the dialled candidate | `att_a63ecf46e398078d8dfec64b`, `destination_mode=TEST_RESPONDER`, `real_consent_authorization_id=null` — created by `request_pickup` itself (one per roster candidate) |
| reply `"no car"` through the deployed n8n `FG-SMS-Reply` → Voice Turn chain | HTTP **200** `{"status":"DECLINED","note":"recorded"}` |
| evaluation row | `available=false`, `decline_reason=NO_TRANSPORT`, `reason_code=AVAILABLE_NO_TRANSPORT` |
| attempt | closed by the outcome, `ANSWERED_NO` |

**A note the earlier draft of this evidence would have got wrong.** The reply responder returns the
decision only; `declineReason` is not echoed in that body. The reason is asserted where it is
durable — `candidate_evaluations`. Asserting a `declineReason` response field would have been testing
an undocumented field and reporting a false FAIL.

### Authorization lifecycle — inside a rolled-back transaction only

| Step | Result |
|---|---|
| fresh job inside the transaction | inserted (`discovering`, v1) |
| `RealCallAuthorization` bound to job + candidate + the GHL contact | inserted |
| `open_attempt(… 'REAL_CONSENTED')` | `opened:att_2230ebb412f4a669887aae94` |
| `consume_real_call_authorization` first call | **true** |
| second call | **false** (single-use) |
| `open_attempt(… 'REAL_CONSENTED')` for a candidate with no authorization | **raised `REAL_CALL_NOT_AUTHORIZED`** — refused, not downgraded |
| after `ROLLBACK` | authorizations **0 → 0**; jobs **50 → 50**; attempts for the transaction job **0** |

The attempt row used for the transaction was not created by closing a real one: attempts are unique
on `(job_id, candidate_id)` and the partial index is unique on `candidate_id` across jobs, so
`p_gma`'s open discovery attempt was closed **inside** the transaction and restored by the rollback.
Nothing persisted.

---

## 3. Dispatcher and rollback, both `--dry` (their GHL reads are real)

`node ops/dispatcher.mjs --dry <contact> att_a63ecf46… CALL` returned
`{"dry":true, "url":"…/webhook/fridgegraph-dispatch", "body":{"attemptId":"att_a63ecf46…","contactId":"…","channel":"CALL"}}`
and all five window checks `ok` — **nothing sent**.

`node ops/session3-rollback.mjs --dry` was run twice:

- **with the attempt open** (before the reply): `[SKIP] close attempt: would close_attempt(id,
  'SESSION_3_ROLLBACK')`; `[SKIP] no open attempt left for this contact: would be 0 after the close
  (1 open now)` — the would-close branch.
- **after the reply**: `[ok] close attempt: already closed (2026-10-30T20:56:02.372Z)`;
  `[ok] no open attempt left for this contact: 0 open`. GHL: `fg-dial` absent (9 tags on the
  contact), the tag DELETE printed, the workflow DELETE printed.

Both runs exit 0. A `--dry` run that reported steps it deliberately did not perform as `FAIL` was a
defect in the reporting, not in the rollback; it now reports **SKIP** for those two steps.

---

## 4. Simulated, never performed

Each is printed as `WOULD DO` with the exact request. None was sent.

| Action | Exact request |
|---|---|
| flag on | process env `REAL_CALL_EXCEPTION_ENABLED=1` (test window only) |
| Dispatch on | `POST {n8n}/api/v1/workflows/A2vnWF2L58Lvquqg/activate`, header `X-N8N-API-KEY: <credential>` |
| publish `FG - Dial Rosina` | GHL **UI action** — no documented publish API |
| `fg-dial` tag | `POST {GHL}/contacts/{contactId}/tags`, `Version: 2021-07-28`, body `{"tags":["fg-dial"]}` |
| remove enrolment | `DELETE {GHL}/contacts/{contactId}/workflow/6f2b386e-60ed-4848-959b-ed97f1307d92`, header **`Version: v3`**, body `{"eventStartTime":"<ISO-8601>"}` |

### The workflow-removal DELETE — documented and implemented, not executed

`DELETE /contacts/:contactId/workflow/:workflowId` (Contacts API, “Delete Contact from Workflow”)
documents **`Version: v3`** — not the call-log API's `2021-04-15` — and a **required** body
`{"eventStartTime": <ISO-8601>}`.

- **documented and implemented**: yes. `ops/session3-rollback.mjs` issues it with `Version: v3`, and
  `--dry` prints the exact request (shown above).
- **executed successfully**: **no.** A DELETE cannot be proven by a read-only check, and this task
  permits no external write. Nothing was deleted.
- If the enrolment's event start time is not known, the script **refuses to send a guessed body** and
  reports it for Bryan instead.
- **Uncertainty that remains:** removal is **not documented as cancelling a Voice AI call GHL has
  already queued**. The residual risk in the runbook's §5 still applies after a clean rollback.

---

## 5. After-state

| Check | Observed |
|---|---|
| Dispatch | **active=false** |
| `REAL_CALL_EXCEPTION_ENABLED` | **unset** |
| `FG - Dial Rosina` | **state=draft** |
| `fg-dial` tag | **0 of 2684 contacts** across 28 pages |
| `RealCallAuthorization` | **0 rows total**, 0 live |
| Open attempts | **0** (3 untouched discovery attempts from `request_pickup` were closed as `D6_CLEANUP`, recorded, not hidden) |

---

## 6. The D3 call-log monitor

No monitor process was running and **no buffered output existed** (no log file, no process) — so
there was nothing written to record. What the call log itself says is checked live by the guard:
**no Voice AI call to this contact in the local day, across all agents.** The monitor was not
re-started: this run made no outbound call to watch.

---

## 7. What this run changed in the tooling

- `ops/dispatcher.mjs`: the `--dry` CLI ignored the documented `[attemptId]` argument and treated it
  as the channel, so `--dry <contact> <attempt> CALL` threw `channel must be SMS or CALL`. It now
  parses `<contactId> [attemptId] [SMS|CALL]` as documented.
- `ops/session3-rollback.mjs`: dry-run steps that are intentionally not performed now report
  **SKIP**, not **FAIL**; the workflow DELETE is implemented (see §4).

## 8. What is still not proven

- **Voice behaviour**: one opener; “no car” → DECLINED/NO_TRANSPORT. Only a real call shows these.
  The parser and the DB path that route them are proven; Rosina's speech is not.
- **The FROM dropdown**: pending Bryan's eye check.
- **Dispatch → dial → Voice AI** as a live chain: deliberately not exercised.
- **Whether DELETE removes an already-queued call**: not documented either way.
