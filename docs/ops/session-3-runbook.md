# Session 3 runbook — one dial, one real call

**Read this top to bottom before touching anything. The order is the safety property, not a
suggestion.** Total time from step 2 to step 4 should be under 15 minutes.

Hard stops that still hold: no real SMS is sent, Dispatch starts INACTIVE, no
`RealCallAuthorization` exists today, `REAL_CALL_EXCEPTION_ENABLED` is unset.

---

## 1. Pre-flight — everything verified before anyone is told a call is coming

| Check | Command / place | Pass looks like |
|---|---|---|
| Stack up | `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4001/health` (and 4002-4007) | `200` |
| Router | `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4010/` | not `000` |
| Voice-turn server | `lsof -nP -iTCP:4118 -sTCP:LISTEN` | one listener |
| Tunnel, unauthenticated | `curl -s -o /dev/null -w '%{http_code}' -X POST https://fridgegraph.loomz.stream/voice-turn` | **`401`** (not 404, not 000) |
| Voice Turn workflow | `xOfmO6T4mKbYnjqb` | **active** |
| Reply and Timeout | `addWpgFfxXmq7GF1` | **active** |
| FG-SMS-Reply / FG - No Answer | GHL | **published** |
| Dispatch | `A2vnWF2L58Lvquq` | **INACTIVE** |
| `FG - Dial Rosina` | GHL | **unpublished (draft)** |
| Rosina's `pickup_decision` action | GHL Custom Action | query param `attemptId` = `{{contact.fg_attempt_id}}` |
| Contact fields | GHL contact | `fg_attempt_id`, `fg_child_name`, `fg_pickup_place`, `fg_pickup_time`, `fg_reason` exist |
| Action token | `.env` | `FG_GHL_ACTION_TOKEN` present; `FG_DISPATCH_TOKEN` present only if Dispatch is used |

`python3 ops/n8n-workflow-summary.py <id>` prints each workflow's state and credentials without
dumping a body.

**Abort here** if the tunnel answers anything but 401: a 404 means the route is missing, and a 000
means it is down. Either way the dial would place a call nobody can record.

### The one call-window fact that can waste the whole session

GHL schedules Voice AI outbound calls **8:00 AM – 8:00 PM in the contact's phone-number timezone**,
allows **one call per phone number per day**, and up to 14 in 14 days. Do not spend the day's call on
a stack that has not passed the table above.

---

## 2. Tell Bryan FIRST — 60 seconds before anything is armed

Send, verbatim:

> Dialing Rosina in 60 seconds. Your phone will ring from the FridgeGraph number. Let it ring twice,
> answer, and say "no car" when she asks. Don't call back if it drops — I'll know from the log.

Then wait the 60 seconds. This exists because the call arrives before any log can be read, and an
unanswered test call still burns the number's one call for the day.

---

## 3. Arm it — mint, then flip, in this order

```bash
# 3a. create the job + attempt (the attempt is the thing the call is bound to)
#     one open attempt per contact is enforced; a fresh contact/job is required.
# 3b. mint the RealCallAuthorization for that attempt, short expiry (<= 15 min)
#     Gate 2: no authorization, no call. Consumed once.
# 3c. export REAL_CALL_EXCEPTION_ENABLED=1  (test window only)
# 3d. enable the dial node in Dispatch; set Dispatch ACTIVE
# 3e. publish "FG - Dial Rosina" in GHL
```

Order matters: the authorization must exist **before** the flag, and the flag before any node that
could dial. If a step fails, stop and roll back rather than skipping forward.

Record the attempt id and contact id — every later check keys off them.

---

## 4. Dial

Trigger the dispatch once (`node ops/dispatcher.mjs <attemptId> <contactId> CALL`, or the tag action).
Then watch, in this order:

1. Dispatch execution in n8n — did the tag action succeed?
2. `FG - Dial Rosina` execution in GHL — did the Voice AI Outbound Call action schedule?
3. Rosina's `pickup_decision` call → n8n Voice Turn → `/voice-turn` → `accept_pickup_webhook`.
4. Row check: `candidate_evaluations` for that attempt's candidate — `available=false`,
   `decline_reason=NO_TRANSPORT`, `reason_code=AVAILABLE_NO_TRANSPORT`.

**Expected answer when she picks up "no car":** DECLINED / NO_TRANSPORT → `AVAILABLE_NO_TRANSPORT`,
and the attempt closes. If the job then ranks, the no-driver branch prices a ride; the reply itself
never does.

### Which job states still accept her answer, and for how long

From the code (evidence 30 §B4), **the discovery window is not a gate on the reply**:

| Job state | Answer accepted? |
|---|---|
| `discovering` | yes |
| `awaiting_approval` | yes |
| `confirmed` / `failed` | no — `REJECTED_STATE` / 409 `END_CALL` |
| attempt already closed | no — `rejected_closed`, zero change |
| candidate already answered | no — `duplicate` |

It stays true until one of: the job goes terminal, the attempt is closed by an outcome, a new
attempt-creation for that contact sweeps the stale attempt, or `request_version` moves. In practice,
during a live call that means the answer will land as long as the call happens while the job is still
`discovering` or `awaiting_approval`. **Do not shorten the window to make a test pass** — the window
is a ranking input, not a reply gate.

---

## 5. Rollback — do this even if everything worked

```bash
# 5a. Dispatch INACTIVE; dial node DISABLED again
# 5b. unpublish (or leave draft) "FG - Dial Rosina"
# 5c. unset REAL_CALL_EXCEPTION_ENABLED
# 5d. consume or expire the RealCallAuthorization  (both are acceptable; an expired one is inert)
# 5e. confirm: no open attempts left behind
```

Final verification, all three must be true:

* `select count(*) from real_call_authorizations where consumed_at is null and expires_at > now();`
  → `0` (or the row expired)
* Dispatch `A2vnWF2L58Lvquq` → inactive; `FG - Dial Rosina` → unpublished
* `REAL_CALL_EXCEPTION_ENABLED` → unset in the environment

**Leave no open attempt behind.** A job abandoned mid-discovery holds its contact's only slot, and
the next pickup request for that contact will correctly create no attempt — which looks like a bug
and is not one (evidence 30 §B5). Close it explicitly:

```sql
select close_attempt('<attemptId>', 'SESSION_3_DONE');
```
