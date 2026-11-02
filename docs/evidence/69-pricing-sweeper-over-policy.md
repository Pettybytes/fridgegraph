# Evidence 69 — a paid-ride price exists because the sweeper closed the window

**Date:** 2026-11-02 · **Window:** N+1 (reservation `2026-11-02T01:53:47Z` → `2026-11-02T03:23:47Z`)
**Serving code:** graph/API 4008 `c5d8e79` (contains #107's `f9b2a07` sweeper code) · MCP 5051 from the generated `c5d8e79` config · Rosina 4200 `c5d8e79` · UI 5189 `16d6cb5`
**Schema in force:** 0066 applied (verified absent immediately before) · 0067 applied · 0074 applied

Everything below is read from stored rows. Nothing was recomputed, and **no ranking call was made by the operator**: the transition was produced by the deployed sweeper.

## The job

| | |
|---|---|
| job | `job_142ce320dc91496184e0d025e4da31fe` |
| child | `p_nora` |
| window | `discovery_timeout_seconds = 60` |
| attempts opened | **4** (`TEST_RESPONDER`) |

| candidate | attempt | closed at | closed reason |
|---|---|---|---|
| `p_bryan` | `att_da9bf26e4c537f52b857bc19` | `2026-11-02T02:10:04.969Z` | `OUTCOME_RECORDED` |
| **`p_gma`** | **`att_2d3eb3f376a17be4658562f2`** | **`2026-11-02T02:08:54.192Z`** | **`ANSWERED_YES`** |
| `p_monique` | `att_b1b0d759d2fe0a1bf2f3af3a` | `2026-11-02T02:10:04.969Z` | `OUTCOME_RECORDED` |
| `p_tasha` | `att_1c6e422fece4d7621fadeb63` | `2026-11-02T02:10:04.969Z` | `OUTCOME_RECORDED` |

## The acceptance path used

`accept_pickup_webhook` (service-role reply path; the candidate is derived from the attempt, never supplied). Outcome: **`recorded`**.
**The app-acceptance path was NOT used for this row.** #102's app-acceptance proof is still outstanding — at the time of this job, `acceptPickup` as the candidate failed at the job read (`JOB_NOT_FOUND`), which is what 0068 addresses.

## The sweeper transition

| | |
|---|---|
| before | `discovering` v2 |
| after | **`awaiting_approval` v3** |
| when | **72 s** after creation, against a **60 s** window |
| over-limit candidate recorded | `p_gma` |
| ranking performed by | **the deployed sweeper** (15 s interval, `DISCOVERY_SWEEPER` unset); no manual `close_discovery`/`_rank_and_advance` in the run |

## The stored decision row

| field | value |
|---|---|
| candidate | `p_gma` |
| reason | **`OVER_POLICY`** |
| available | `true` |
| accepted via | `WEBHOOK_CALLBACK` |
| distance | **8.86 mi** |
| amount | **$12.40** |
| basis | `FridgeGraph synthetic planning estimate: haversine distance x $1.40/mi - not a provider quote` |
| calculated at | `2026-11-02T02:10:04.969Z` |
| household cap | `h_a` → `ride_cost_cap_usd = 10` |

**12.40 > 10**, which is why the branch is `OVER_POLICY` and not an amount the system would spend.

## Every other candidate's actual outcome

| candidate | reason code |
|---|---|
| `p_bryan` | `UNAVAILABLE` |
| `p_monique` | `UNAVAILABLE` |
| `p_tasha` | `UNAVAILABLE` |
| `p_chris`, `p_dad`, `p_gloria`, `p_holt`, `p_jennings`, `p_leo`, `p_marcus`, `p_max`, `p_mom`, `p_okafor`, `p_price`, `p_priya`, `p_walter`, `p_whitfield` | `UNAUTHORIZED` (15) |

## Operator evidence

`ops/evaluation-agreement.mjs` for this job: **12 PASS · 0 FAIL · 0 BLOCKED**, including:
- the amount is miles × the declared $1.40 rate, to the cent (8.86 × 1.40 = 12.40)
- an `OVER_POLICY` amount is over the household cap (12.40 vs 10)
- the decision agrees with the job status (`awaiting_approval` vs `OVER_POLICY`)
- the decision row did not change during the read-only inspection

## What this does and does not prove

- **Proves:** the discovery window now has an owner; a caregiver's "yes" can reach a decision without an operator ranking it; a paid-ride price is produced from the stored evaluation and the household cap, with its basis stated verbatim.
- **Does not prove:** a booked ride. **0 confirmations** exist for this job. The state is **awaiting parent approval — no ride booked.**
- **Does not prove:** the candidate app path. That is evidence 69's second section (or 70), after 0068 is narrowed and applied.
