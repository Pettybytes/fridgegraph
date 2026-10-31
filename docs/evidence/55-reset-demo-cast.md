# 55 — `resetDemo()` restores the full demo seed

## Defect

`resetDemo()` is the judges' **Reset demo** button. It deleted every `sandbox = true` row and then
restored only the simulated fixture set (`createSimulatedCareFacts()` and friends), so **Cast v2 content
living in sandbox-marked tables disappeared on every reset**. The visible damage: Malik's three care
facts (`fx_cf_malik_snack`, `_tv`, `_bedtime`) went 3 → 0, breaking the Priya care-plan and Dwayne scenes
for every visitor who pressed reset.

## Fix

Inside the **same transaction and advisory lock**, after the existing fixture pass, `resetDemo()` now
upserts the Cast v2 rows again, from the same canonical source the seed merges
(`src/fixtures-cast-v2.ts`). A shared `upsertRows()` helper does both passes.

Audit of every table reset touches (`SANDBOX_TABLES` + `ID_TABLES`):

| table | cleared by reset | Cast v2 rows | before | after |
|---|---|---|---|---|
| `care_facts` | yes (`sandbox = true`) | 3 | deleted, not restored | **restored** |
| `routines` | yes (`sandbox = true`) | 32 | deleted, not restored | **restored** |
| `coordination_jobs`, `attempts`, `holidays`, `adult_availability`, `holiday_arrangements`, `expected_checkins` | yes | 0 | n/a | n/a |
| `people`, `households`, `children`, `household_members`, `events` | restored from fixtures | yes | present (upsert) | present (upsert) |
| `grants`, `relationships` | **not deleted** (id lists only carry simulated ids) | 3 / 14 | survive | survive |
| `orbit_vocabulary` | not touched | reference data | intact | intact |

**Upsert only.** Cast rows are never added to the delete id-lists, so no FK-bearing Cast row is removed
and re-inserted mid-reset. The Orbit append-only exception (`reset_demo_orbit`, 0042/0043) and the
guide/demo guards are untouched.

## Proof — `ops/reset-demo-cast-proof.mjs`: **19/19 PASS**

The checksum covers **only rows whose identity comes from the canonical fixture sources**
(`fixtures-cast-v2` + `fixtures-simulated`), never whole tables — test artifacts and audit history share
those tables and are not part of "the demo seed". Order-insensitive, key-normalised SHA-256 per table.

| # | Assertion | Result |
|---|---|---|
| a1 | seed checksum equal before and after a reset from a cleanly seeded state | PASS |
| a2 | the reset report is a real reset | PASS |
| b1 | sandbox mutated: Orbit alert **activated + responded** (responder must be in `orbit_notify_eligible`) | PASS |
| b2 | sandbox mutated: a consent decision (`approveConsent` → APPROVED) | PASS |
| b3 | the reset restores the seed checksum **exactly** | PASS |
| b4 | the Orbit alert the mutation created is gone after reset | PASS |
| c1 | audit rows grew by exactly one per reset | PASS |
| c2 | protected records unchanged (0 real-call authorizations, 0 real-consented attempts on this stack — nothing to protect was present; counts compared) | PASS |
| c3 | audit grew by exactly one more after the second reset | PASS |
| c4 | audit grew by exactly one per reset across all four resets | PASS |
| d1 | after reset Malik has **3** care facts | PASS |
| d2 | Priya's care-plan read on Malik returns 3 facts | PASS |
| d3 | Dwayne's views work and include Malik with a display name | PASS |
| d4 | all six consumer reads answer (`myChildren`, `careFacts`, `checkInStatus`, `orbitVocabulary`, `effectiveScheduleFor` Thanksgiving, `jobTimeline`) | PASS |
| d5 | authenticated MCP call succeeds | PASS |
| d6 | `my-children-proof` PASS — 0 failures | PASS |
| e1 | two resets in a row produce identical seed checksums | PASS |
| e2 | both match the clean baseline | PASS |

**Mutation endpoints:** the shared router on 4012 was composed from an older commit and does not expose
`approveConsent`, so the mutations ran against spare in-process subgraphs built from this checkout
(school on 4321, coordination on 4322) against the same database. Consumer reads and the MCP call used
the shared router and MCP server. No stack change, no restart.

No generated output was written under `docs/evidence/`; this file is the only addition and every
pre-existing evidence file is byte-identical to `origin/main`.
