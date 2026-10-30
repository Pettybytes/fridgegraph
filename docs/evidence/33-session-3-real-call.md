# Evidence 33 — Session 3: the real call attempt and the Web Call test

_2026-10-30. Two separate events, recorded as they happened, not as they were supposed to go._

**Headline: the voice checks are NOT verified.** The dial was placed and was not answered; the Web
Call test did run and recorded **ACCEPTED**, not the expected DECLINED/NO_TRANSPORT. Details below.

---

## 1. The dial (one dial only, ever)

| Item | Observed |
|---|---|
| Pre-flight | all 15 items green at 17:18–17:21 ET (stack 400×7, router 400, voice-turn 404, tunnel 401, Voice Turn + Reply active, Dispatch inactive, Dial workflow draft, 0022 5-arg/2-arg, guard ok at 17:21, 0 open attempts, 0 authorizations) |
| Job | `job_dzg3lyu6mvvh75ow` — minted **directly**, see §2 |
| Authorization | `rca_hgfbl6tlmvvh75so`, bound to job + `p_gma` + the Loretta Brooks contact, **consumed 17:20:01 ET** |
| Attempt | `att_9b24bd2c43f6562b9d9387ab`, `destination_mode=REAL_CONSENTED` |
| Contact fields | `fg_attempt_id`, `fg_child_name=Nora`, `fg_pickup_place=school`, `fg_pickup_time=3:00 PM`, `fg_reason=pickup`, `fg_requester_name=Kendra` — written and read back |
| Dispatch | activated before the tag (deactivated again at 17:25:55) |
| Tag | `fg-dial` applied **17:21:38 ET** (HTTP 201) — the one dial |
| Call log | **one call, created 17:24:06 ET, duration 25 s**, from Rosina's number, `agentId` = Rosina's agent |
| Call outcome | **unanswered (recipient's line busy with another call)** — Bryan was calling his mother at the same moment and the two collided |
| Decision recorded | **none.** `webhook_events` for the attempt = **0**; evaluation stayed `PENDING`; `accepted_via` null |
| Attempt after | closed `SESSION_3_ROLLBACK` at 17:25:55 ET |

The call connected for 25 seconds but produced no decision, which is consistent with the line being
busy / the call being cut before the custom action could post. **Rosina's opener and her response to
"no car" were never exercised by this call.** Recorded as **not a voice-behaviour result**.

## 2. Deviation, stated plainly (approved by Bryan: “direct”)

`request_pickup` mints the job and then `_evaluate_candidates` inserts a **TEST_RESPONDER attempt for
every eligible candidate**. `attempts` is unique on `(job_id, candidate_id)`, so a `REAL_CONSENTED`
attempt for the same candidate **cannot** be opened in that job afterwards — the D6 run had already
hit the duplicate-key form of this. The job was therefore minted directly, with the single `PENDING`
evaluation row `_evaluate_candidates` would have written for `p_gma` (who holds `pickup.request` on
Nora), and the REAL_CONSENTED attempt was opened and consumed from there. A mint path that takes
`destination_mode` is a Group 1 item (E0) and a HANDOFF fix.

## 3. The no-answer chain — what actually happened

- **n8n “Reply and Timeout” received nothing** around 17:24. Its last executions were 14924/14925 at
  20:55–20:56Z; no execution exists at or after 21:24Z.
- **`webhook_events` for the attempt: 0 rows.** Nothing arrived, so nothing was rejected either —
  the post-rollback rejection path was not exercised by a real late event.
- **GHL's “FG - No Answer” execution history is not readable with this token** (`/workflows/{id}`
  returns 404 and no documented execution-history API exists). Whether the GHL workflow fired is
  **unverified**; the observable fact is that its webhook never reached n8n.

## 4. The Web Call test (no dial)

Prepared at 17:30 ET: job `job_f497f5e8a0584cf1ad7c97421da29491`, attempt
`att_ecacade44f5381044f8a5c7a` (`TEST_RESPONDER`), contact `fg_attempt_id` repointed to it. No
authorization, no tag, Dispatch inactive.

**It ran.** Voice Turn execution `14928` at 21:35:14Z; the attempt closed `ANSWERED_YES` at
21:35:17Z with one event (`ACCEPTED`, source `reply`, mode `TEST_RESPONDER`).

| Field | Observed | Expected for “no car” |
|---|---|---|
| `available` | **true** | false |
| `decline_reason` | **null** | NO_TRANSPORT |
| `reason_code` | **OVER_POLICY** | AVAILABLE_NO_TRANSPORT |
| `accepted_via` | WEBHOOK_CALLBACK | WEBHOOK_CALLBACK |
| cost | 12.40 | null |

`candidate_evaluations` for `p_gma` went to available=true, and ranking then took the no-driver
branch (`OVER_POLICY`, 12.40, `over_limit_candidate_id=p_gma`, job `awaiting_approval` v3). The
`cost_basis` is the synthetic haversine estimate, not a provider quote.

**What this means:** the decision Rosina sent was an **acceptance**, so the “I don’t have a car”
clause either never reached her or was dropped before the parser. The parser itself is unit-proven
(`no car`, `don't have a car` → DECLINED/NO_TRANSPORT, 26/26); what this test shows is that a real
call did **not** produce that text. **The voice-behaviour checks remain UNVERIFIED**, and this is a
defect to investigate, not a pass.

## 5. After-state (E-1 cleanup)

| Check | Observed |
|---|---|
| Open attempts | **0** (both attempts were already closed: the dial by rollback at 17:25:55, the Web Call by its own outcome at 21:35:17) |
| Active authorizations (unconsumed, unexpired) | **0** |
| Authorizations kept | **1** — the consumed one, kept as audit evidence |
| Closed attempts kept | all, including both Session 3 attempts |
| Dispatch | **inactive** |
| `REAL_CALL_EXCEPTION_ENABLED` | **unset** |
| `fg-dial` tag | **absent** (contact has 0 tags) |

Nothing was deleted. No unrelated job was closed to make a count reach zero.

## 6. Voice checks — final status

1. **Opener said once:** not observed (the dial was unanswered).
2. **“no car” → DECLINED/NO_TRANSPORT:** not observed; the Web Call recorded ACCEPTED and priced a
   paid ride.

Both remain open. The next real-call or Web Call test must answer these directly.

---

## Addendum — Web Call correction (Bryan, 18:12 ET)

**The answer in the Web Call was “Yes”. The “no car” clause was never said.** ACCEPTED
(`ANSWERED_YES`, `available=true`, then `OVER_POLICY` with the 12.40 estimate) was therefore the
**correct** outcome for what was actually said — not a defect. §4 above is superseded on that point.

What remains untested:

- the **“no car” path** → DECLINED / NO_TRANSPORT → `AVAILABLE_NO_TRANSPORT`;
- the **single-opener** check.

The next real call covers both. The real dial finding in §1 (placed once, unanswered, recipient's
line busy, no decision) is unchanged.
