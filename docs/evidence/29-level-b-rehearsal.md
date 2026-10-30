# 29 — Level B rehearsal: a caregiver answer is availability, never an approval

**Date:** 2026-10-30
**Branch:** `feat/level-b-drafts` (PR #9)
**Attempt:** `att_65b34cc9577dcc89d8386a2c` (candidate `p_gma`, Loretta)
**Job:** `job_26b2d6c06d4944c093a306de047f99d7`

---

## 1. The sequence, as observed

### (1) The reply recorded availability, and no cost

`webhook_events` holds exactly **one** row for this attempt:

```
id                                  attempt_id                        outcome
voice:att_65b34cc9577dcc89d8386a2c:ACCEPTED:1   att_65b34cc9…   ACCEPTED
```

The evaluation shows the reply's own mark: `accepted_via = WEBHOOK_CALLBACK`, `available = true`.

**The estimate did not exist when the reply landed.** `cost_calculated_at` is
`2026-10-30T02:10:40.640Z`, roughly three minutes *after* the call's executions
(02:09:40–02:10:37). If the reply path had costed her, that timestamp would sit inside the call
window. It does not — the cost was written later, by the ranking. This is the direct evidence that
0020 removed the reply-time write, not merely relabelled it.

### (2) The later ranking produced the flagged paid-ride option

After the 60 s discovery window, the other contacted candidates were marked `UNAVAILABLE`
(`p_monique` and `p_tasha` carry `updated_at = 02:10:40.640Z`, the same instant). With no driver
able to do the pickup, the paid-ride path ran:

| Field | Value |
|---|---|
| `reason_code` | **`OVER_POLICY`** |
| `estimated_ride_cost_usd` | **12.40** |
| `cost_basis` | "FridgeGraph synthetic planning estimate: haversine distance x $1.40/mi - not a provider quote" |
| `distance_miles` | 8.86 |
| job `status` | **`awaiting_approval`** |
| job `version` | 3 |
| `over_limit_candidate_id` | **`p_gma`** |
| `confirmations` rows for this job | **0** |

She was **never** `APPROVAL_PENDING`, and **nothing was approved**. The over-limit option requires an
explicit `acceptOverLimit` at approval time; it did not happen here.

---

## 2. Voice Turn executions

Headers were not dumped. Full list for workflow `xOfmO6T4mKbYnjqb`:

| id | startedAt | status |
|---|---|---|
| 14785 | 01:42:45Z | success |
| 14786 | 01:43:22Z | success |
| **14787** | **01:51:04Z** | **error** |
| **14788** | **01:51:06Z** | **error** |
| **14789** | **01:51:06Z** | **error** |
| 14790–14792 | 01:51:55–58Z | success |
| 14794 | 02:02:05Z | success (Bryan's test webhook) |
| 14796 | 02:09:40Z | success |
| 14797 | 02:09:54Z | success |
| 14798 | 02:10:04Z | success |
| 14799 | 02:10:37Z | success |

The four executions between 02:09:40 and 02:10:37 are the Web Call's turns.

---

## 3. The CONTINUE-loop finding and its fix

The first validation build returned **multiple outputs from one Code node**:

```js
return [[{ ok }], [{ error }]];   // n8n rejects this
```

Every request died before reaching the HTTP node:

```
Error: Code doesn't return items properly
  Please return an array of objects, one for each item you would like to output.
```

Executions **14787, 14788, 14789** are exactly that failure — one for each proof I ran. Nothing
external called the endpoint during the broken build, and no row was written (`webhook_events` delta
0, candidate row byte-identical), because the failure happened before the server was ever contacted.

**Fix:** single output from `Validate Request`, branching with an `IF` node (`typeVersion 2.2`) on
`$json.ok`. Re-proved afterwards: `200 CONTINUE`, `400 MALFORMED`, `400 CONFLICTING_ATTEMPT_ID`.

---

## 4. Counters

| | |
|---|---|
| Real calls placed by FridgeGraph | **0** — no `RealCallAuthorization`, `REAL_CALL_EXCEPTION_ENABLED` unset |
| SMS sent | **0** — Dispatch inactive, both GHL send nodes disabled |
| `confirmations` created | **0** |
| `approve_pickup` invocations | none |

The Web Call was placed by Bryan from the GHL UI; it is not an outbound dial by the system.

---

## 5. What this evidence does not claim

- It does not claim the intermediate `null` cost was captured live — only that `cost_calculated_at`
  places the estimate at 02:10:40, separate from the reply.
- It does not test a second turn after `ACCEPTED`; the attempt was consumed by design.
