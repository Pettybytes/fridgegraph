# Evidence 70 — Loretta accepts her own attempt in the app, then the sweeper decides

**Date:** 2026-11-02 · **Window:** N+1 (`2026-11-02T01:53:47Z` → `2026-11-02T03:23:47Z`)
**Serving code:** graph/API 4008 `c5d8e79` + branch `be336a1` · schema **0066 + 0068** applied · UI 5189 `16d6cb5`

This is the app path, **not** the webhook: the caregiver signs in as her own persona and accepts her own attempt through GraphQL. Evidence 69 covers the webhook path; this closes the app-acceptance gap that #102 left outstanding.

## Prerequisite check — 0066 + 0068 on the served stack

`ops/0066-attempt-access-proof.mjs` after 0068 was applied and 4008 restarted (pid **27734**):

```
PASS  the caregiver sees her own attempt list, and only hers — 1 visible
PASS  she can accept her own attempt — recorded
PASS  she cannot accept another candidate's attempt — ATTEMPT_NOT_FOUND
PASS  an unrelated caller sees no attempts for that job — 0 visible
PASS  a parent still sees every attempt for the job — 4 for the parent, 1 for the caregiver
0066 PROOF PASS  (5/5)
```

## The app acceptance

| | |
|---|---|
| job | `job_c7c989701b484493bde7f3c493b277b0` |
| caregiver | `p_gma` (Loretta), signed in as her persona |
| attempts she could see | **1** (her own) |
| `acceptPickup` result | `reasonCode AVAILABLE_NO_TRANSPORT` · `available true` · **`acceptedVia CANDIDATE_JWT`** |

**What she was NOT given** — every cost field on the returned evaluation:

| field | value |
|---|---|
| `estimatedRideCostUsd` | `null` |
| `costBasis` | `null` |
| `distanceMiles` | `null` |
| `locationProvenance` | `null` |
| `costCalculatedAt` | `null` |

That is 0068 doing its job: the narrowed helpers return status only, so a caregiver cannot read cost, basis or distance — the rule agreed in #87.

## The sweeper transition (no operator ranking)

| | |
|---|---|
| before | `discovering` |
| after | **`awaiting_approval`** |
| when | **67 s** against a **60 s** window |
| over-limit candidate | `p_gma` |

## The stored decision row

| field | value |
|---|---|
| candidate | `p_gma` |
| reason | **`OVER_POLICY`** |
| available | `true` |
| accepted via | **`CANDIDATE_JWT`** |
| distance | **8.86 mi** |
| amount | **$12.40** |
| basis | `FridgeGraph synthetic planning estimate: haversine distance x $1.40/mi - not a provider quote` |
| calculated at | `2026-11-02T02:19:58.066Z` |
| confirmations | **0** |

## What this proves

- The caregiver's own acceptance works **through the product**, with her own token, not a webhook.
- The acceptance is attributable: `acceptedVia = CANDIDATE_JWT`.
- The decision is written by the **sweeper** at window expiry, and the price comes from the stored evaluation.
- A caregiver receives **no** money fields.

## What it does not prove

- **No ride is booked.** `0` confirmations; the state is **awaiting parent approval**.
- The demo guide and parent views of these fields were not exercised in this run.
- This is a sandbox tenant; nothing here is production data.
