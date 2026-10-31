# Evidence 46 — guardian access via Rosa

_Branch `feat/rosa-guardian`. Positive case is **Emma's own** simulated job and care facts — never Nora's._

## Fixture (additive, SIMULATED)

- `job_emma_nov05` (PICKUP, `awaiting_approval`, v1, as_of 2026-11-05) with one attempt for `p_rosa`
  (`TEST_RESPONDER`, ACCEPTED) — so the timeline has a real shape, not just `JOB_CREATED`.
- Three Emma care facts (snack / tv / bedtime), source "Rosa, care conversation 2026-10-22",
  **verified by `p_rosa`**, CONFIRMED.
- Cleanup follows the existing `fixture=true` rule for jobs, attempts and care facts.

## Identity

`p_tomas` added to the idempotent identity seed. His first name is **ASCII `Tomas` for the email
only** — Supabase rejects `tomás.castellano@example.com` as an invalid address (HTTP 400). The
database display name stays "Tomás". This is an identity-seed detail, not a data change.

## Proof — `node ops/rosa-guardian-proof.mjs` — 9/9 PASS

| # | Check |
|---|---|
| 1 | Rosa lists Emma's job (`job_emma_nov05`) |
| 2 | Rosa opens Emma's `jobTimeline` — `JOB_CREATED, ATTEMPT_OPENED, ATTEMPT_CLOSED`, and it is Emma's own job |
| 3 | Rosa reads Emma's three care facts, each verified by Rosa |
| 4 | The co-guardian (Tomás) sees the same three |
| 5 | Unrelated children **Micah** and **Malik**: zero timeline entries, zero facts — for Rosa |
| 6 | A non-guardian adult (Dwayne) reads none of Emma's facts |

No Nora job or Nora fact is used as the positive case.
