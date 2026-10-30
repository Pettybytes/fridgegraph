# Evidence 38 — Task E3: Attempt.candidate and jobTimeline(jobId)

Additive only. No table, column, policy or function was changed for E3; the work is a subgraph schema
extension plus resolvers, and the supergraph was recomposed.

## What was added

```graphql
extend type Query {
  jobTimeline(jobId: ID!): [TimelineEntry!]!
}

type Attempt {
  id: ID!
  job: CoordinationJob!
  channel: String!
  at: String!
  candidate: Person            # NEW
  destinationMode: DestinationMode!  # NEW
  closedAt: String             # NEW
  closedReason: String         # NEW
}

enum DestinationMode { TEST_RESPONDER REAL_CONSENTED }

type TimelineEntry {
  at: String!          # a stored timestamp, never a presented one
  kind: String!        # JOB_CREATED | ATTEMPT_OPENED | ATTEMPT_CLOSED | COST_CALCULATED | CONFIRMATION
  attemptId: ID
  candidate: Person
  detail: String       # the stored code, verbatim (channel, close reason, cost basis, approver)
}
```

`destinationMode` / `closedAt` / `closedReason` go slightly beyond the two named fields: they are the
fields `docs/contracts/frontend-data.md` §1.4 already requires for the Simulated / Real-call badges,
and they are additive. `Attempt.candidate` is **nullable** — `attempts.candidate_id` is nullable and
a legacy row without one would otherwise break a non-null field for the whole list. No current path
creates such a row; the proof shows every real attempt carries its candidate.

## Where each timeline entry comes from

| kind | source column |
|---|---|
| `JOB_CREATED` | `coordination_jobs.created_at` |
| `ATTEMPT_OPENED` | `attempts.at` (+ `channel` as detail, + `candidate_id`) |
| `ATTEMPT_CLOSED` | `attempts.closed_at` (+ `closed_reason`) |
| `COST_CALCULATED` | `candidate_evaluations.cost_calculated_at` (+ `cost_basis`) |
| `CONFIRMATION` | `confirmations.received_at` (+ `approved_by`) |

An evaluation without `cost_calculated_at` produces no entry — there is no timestamp to show, so
nothing is invented. `information_requests` has no timestamp column and is therefore not on the
timeline. Entries are sorted ascending by the stored instant.

## Boundaries

Reads go through the caller's own RLS client (`dbFor`). An invisible job returns `[]`, not an error,
so a stranger cannot use the timeline to test whether a job id exists. The guide's read comes from the
sandbox policies in 0025; its mutations are refused before anything happens.

## Proof — `node ops/e3-proof.mjs` → **21/21 PASS**

Job created as Kendra through the router, then read by four identities.

| # | Check | Observed |
|---|---|---|
| 0 | job created for the test | `job_adefcc52…` |
| 1 | parent reads the job's attempts | **4 attempts** |
| 1 | every attempt exposes its candidate | `p_bryan, p_gma, p_monique, p_tasha` |
| 1 | every attempt exposes `destinationMode` | all `TEST_RESPONDER` |
| 1 | candidates are the recorded ones, one per attempt | 4 distinct |
| 2 | parent reads a non-empty timeline | **5 entries** |
| 2 | every kind is a recorded kind | `ATTEMPT_OPENED, JOB_CREATED` |
| 2 | every `at` parses | e.g. `2026-10-30T22:57:49.951763+00:00` |
| 2 | ascending | yes |
| 2 | exactly one `JOB_CREATED`, first | yes |
| 2 | one `ATTEMPT_OPENED` per attempt, each with attempt id + candidate | 4/4 |
| 3 | co-parent (Andre) sees the same job | 5 vs 5 |
| 4 | unrelated adult (Dana) does not see the job | 0 jobs visible |
| 4 | Dana's timeline for that job | `[]` — no existence leak |
| 4 | Dana sees no attempts | 0 |
| 5 | the guide reads the sandbox timeline | 5 vs 5 |
| 5 | the guide reads the attempts | 4 |
| 5 | the guide cannot approve | `DEMO_GUIDE_READ_ONLY` |
| 6 | a missing job id | `[]`, not an error |
| 7 | cleanup | job deleted, 0 jobs remain |

## Also re-verified after the change

| Check | Result |
|---|---|
| graph suite `node ops/run-evidence.mjs` | **114 checks / 32 cases, PASS** (the E1 baseline; pre-E1 was 115) |
| voice-turn `node ops/voice-turn-check.mjs` | **15/15 PASS** |
| `npx tsc --noEmit` | clean |
| `npm run check` | clean, 0 findings |
| supergraph | recomposed locally (`rover supergraph compose`), router restarted on the new file |

Guardian authority for `jobTimeline` is inherited from the 0024 role widening
(`is_parent_of` accepts `parent`/`guardian`) and the same RLS path; **no guardian persona is seeded**,
so it is not separately exercised here and is not claimed as observed.
