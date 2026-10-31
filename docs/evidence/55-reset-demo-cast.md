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

## 2026-10-31 17:26 — created rows are REMOVED, not merely overwritten

A seed checksum cannot see **extra** rows. This section creates real sandbox work through the product's
own mutations, records every row it produced, resets, and checks each id.

| Created through | Rows recorded | After reset |
|---|---|---|
| `requestPickup(p_nora)` | 1 job, 4 attempts, 17 candidate evaluations | **job gone**, **attempts gone**, **evaluations gone** |
| `approvePickup` | confirmations / information requests for that job | none were produced; nothing left |
| `orbitDraft → preview → activate` + `orbitRespond` (as a parent in the audience) | 1 alert, 1 response | **alert gone**, **response gone** |
| `approveConsent(ps_cast_proof2)` | 1 approval row | **KEPT — documented contract** (see below) |

Deletion is by the reset's own scoping: `coordination_jobs` / `attempts` are sandbox-scoped deletes, and
`candidate_evaluations`, `confirmations`, `information_requests` and `webhook_events` follow by
`ON DELETE CASCADE` from those two. `orbit_alerts` / `orbit_responses` go through the privileged
`reset_demo_orbit()` path (0042/0043), which is unchanged.

**Named documented exception:** `approvals` is the audit ledger and `resetDemo()` never deletes it — the
comment in `src/demo/reset.ts` says so explicitly, and this run asserts the created consent approval is
still present (created=1, left=1). The proof removes its own approval afterwards so it does not
accumulate.

**Where the flow stops, deliberately:** `acceptPickup` is **refused for a candidate** with
`ATTEMPT_NOT_FOUND`, because `attempts_read` is parent-only — the candidate's own RLS client cannot see
the attempt the mutation needs. That is a product-level authorization shape, not a reset concern;
`ops/mcp-e2-proof.mjs` already lists `acceptPickup` as not exercised. Recorded here rather than skipped
silently.

**Result:** **32/32 PASS** — the removal assertions plus every pre-existing assertion (seed checksum
identical, audit +1 per reset across five resets, protected records unchanged, Malik 3 care facts,
Priya's care-plan read, Dwayne's views, six consumer reads, authenticated MCP, `my-children-proof`).

## 2026-10-31 17:40 — DEMO decisions reset, REAL decisions never do (0050)

**The gap f8 exposed.** Reset never deletes `approvals`, and 0047 makes a consent decision unique per
slip. So the first visitor to approve a sandbox slip locked it: everyone after them got "already
approved". Demo repeatability was broken for consent — and would break the same way for relationship
("Add a Villager") and grant approvals.

**Fix (inside reset's existing transaction and advisory lock).** A decision is cleared only when BOTH
hold, and each is enforced independently:

| Condition | How it is decided |
|---|---|
| made by a **demo** caller | `approvals.demo_caller`, set by a BEFORE INSERT trigger from `is_demo_caller()` (the verified token) — a client cannot forge it, the same trusted marker 0025 already uses for `attempts` |
| the **subject** is a sandbox record | `is_sandbox_approval_subject(type, id)`: sandbox child's slip / grant / holiday arrangement, or a relationship into a sandbox person; unknown types are never sandbox |

`reset_demo_decisions()` deletes exactly those rows, returns the count, and puts the subject back to its
seed state (`permission_slips.signed = false` when no decision remains on a sandbox slip). Everything
else is untouched: a real caller's approval, and any approval on a non-sandbox subject.

The audit trace stays **one row per reset** — `reset_demo_orbit` gained an optional payload so the same
row now carries `removed.approvals` as a number (no ids, no names).

### Proof — `ops/reset-demo-decisions-proof.mjs`: **15/15 PASS**

| # | Assertion | Result |
|---|---|---|
| 1 | the first approval is recorded (1 row) | PASS |
| 2 | a second approval is locked to the existing decision — **the repeatability bug reproduces** | PASS |
| 3 | the approval is marked as made by a demo caller | PASS |
| 4 | two controls exist before reset: non-sandbox subject; non-demo caller on a sandbox subject | PASS |
| 5 | the reset reports exactly one demo decision cleared | PASS |
| 6 | that demo decision is gone | PASS |
| 7 | the slip is back to its seed state (unsigned) | PASS |
| 8 | the **non-sandbox** control survives | PASS |
| 9 | the **non-demo** approval on a sandbox subject survives | PASS |
| 10 | the single audit row carries `approvals: 1`, counts only | PASS |
| 11 | after reset the same approver approves again — no "already approved" | PASS |
| 12 | six consumer reads answer | PASS |
| 13 | Malik still has 3 care facts (the #57 fix still holds) | PASS |
| 14 | authenticated MCP call succeeds | PASS |
| 15 | `my-children-proof` PASS — 0 failures | PASS |

Controls were deliberately made to need their own slip: a second approval on the *same* slip is a
`23505` against 0047's one-decision index, which is exactly the invariant the lock assertion relies on.

## 2026-10-31 18:08 — one reset, three behaviours (merge of #57 + #54 + #59)

`src/demo/reset.ts` was resolved **both-sided**, never by taking one side wholesale. A single
`resetDemo()` now does all three inside the **same** transaction and advisory lock:

1. **Cast v2 restore** (#57) — sandbox-marked Cast content (Malik's care facts, the 32 Cast routines)
   is upserted back from the canonical fixture source;
2. **created-family cleanup** (#54) — sandbox families are deleted, with their rows, registry entry and
   identity mapping; auth users and JSON mappings are purged after commit;
3. **demo-decision cleanup** (#59) — `reset_demo_decisions()` clears only approvals that are BOTH
   demo-made AND on a sandbox subject, and returns those slips to unsigned.

One audit row per reset carries **both** counts. Observed on a run with no created family:
`{"approvals":1,"createdFamiliesRemoved":0,"orbit_alerts":0,"orbit_responses":0,"orbit_audience_members":0,"alerts":[]}`.

### New assertion — row and subject state must agree

| # | Assertion | Result |
|---|---|---|
| 9b | a **protected** approval (non-demo caller on a sandbox subject) survives **and its slip stays SIGNED** | PASS (`signed=true`) |
| 7 | a **cleared** demo decision returns its slip to unsigned | PASS |

Neither half may move alone: clearing deletes the row *and* unsets the slip, while a surviving row
leaves the slip decided.

### Contract change — the #57 assertion was superseded, not deleted

`ops/reset-demo-cast-proof.mjs` f8 previously asserted the consent approval was **kept** ("audit ledger,
documented in reset.ts"). That contract is superseded by 0050: a demo decision on a sandbox subject is
now **cleared**. The assertion was rewritten to the current contract and a companion added:

| # | Assertion | Result |
|---|---|---|
| f8 | the DEMO consent approval is cleared by reset (0050) | PASS (`created=1 left=0`) |
| f9 | its slip returns to unsigned | PASS (`signed=false`) |

### Results at this head

| Proof | Result |
|---|---|
| `reset-demo-decisions-proof` | **16/16 PASS** |
| `create-demo-family-reset-proof` (integration) | **12/12 PASS** |
| `reset-demo-cast-proof` | **33/33 PASS** |
| `create-demo-family-proof` | **25/25 PASS** |
| `create-demo-family-faults-proof` | **not re-run** — it leaks one auth account per run (4 orphans observed). Last result **31/31**, cited rather than repeated. |
