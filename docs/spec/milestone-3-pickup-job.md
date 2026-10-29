# Spec — Milestone 3 (Station 06): the pickup job

Status: **specification reconciled to the approved contracts (2026-10-28).** Previously this file
described a sequential `awaiting_parent → awaiting_adult` machine and an inbound-reply
`Confirmation`; both were superseded. This document is now the implementation measure for
Station 06 and must not diverge from the contracts below.

**Authoritative contracts** (this file defers to them on every conflict):

| Contract | Commit in `main` |
| --- | --- |
| `docs/contracts/pickup-job.md` | `ad188f2` |
| `docs/contracts/webhook.md` | `ad188f2` |
| `docs/contracts/frontend-data.md` | `ad188f2` |
| `docs/contracts/data-model.md` | `ad188f2` |

Rules: `AGENTS.md`. Data rules: `data-model.md`. Frontend shapes: `frontend-data.md`.

## 1. Problem

A child needs to be picked up. The graph knows who is related, who holds grants, who is scheduled,
and who is reachable — but nobody has actually been asked. Today a parent finds out at 3pm by text
that nobody is coming.

The job closes that gap: it **asks real people through real channels, records their real answers,
and records a parent's permission only when that parent gives it**.

## 2. Actors

| Actor | Role |
| --- | --- |
| Parent / guardian | authority; the named `approverFor` for that date is the only one who may approve |
| Adult candidate | a person returned by `pickupCandidates` with a verified channel |
| Rosina | the coordination agent — "Rosina, FridgeGraph's AI family coordinator"; plans, composes, records; never assigns reason codes, never approves |
| The graph | the only source of candidates, contacts, permissions and locations |
| Test responder | a labelled fixture standing in for a human; `destinationMode = TEST_RESPONDER` |
| Real-call recipient | exactly one consented number, only under the dual gate (§6) |

**Attribution:** planning and decisions are powered by Meta's Muse Spark Open. The voice a caller
hears is a GoHighLevel capability, **not** a Meta model — never state otherwise.

## 3. Flow

1. **Trigger.** `requestPickup(childId, asOf)` — idempotency key
   `pickup:<childId>:<asOf>:<window>`. Same key returns the existing job; never a second row.
2. **Candidates.** Read `pickupCandidates(childId, asOf)`. Evaluate **every** candidate through the
   gate order: authorization → verified contact → dispatch/delivery → response.
3. **Discover in parallel.** Dispatch one `Attempt` per candidate **at once**, each on that
   person's own verified channel. Not sequential, no escalation chain.
4. **Record responses.** Inbound replies and voice turns write **availability only** through one
   transactional `acceptPickup` path (§8 of the contract), with two entry points: the
   HMAC-authenticated n8n/GHL webhook (primary) and the candidate's own JWT via MCP (P1).
5. **Rank (deterministic code, never the model).** Among human-confirmed responders:
   authorization → confirmed availability → transport → deadline feasibility → distance → resolver
   order. The household ride-cost cap is a **separate permissibility gate**; approval is a third,
   independent gate.
6. **Await approval.** The ranking selects exactly one candidate; the job moves to
   `awaiting_approval` and waits on the parent named by `approverFor(childId, asOf)`.
7. **Confirm or fail.** Only that parent's `approvePickup(decision: APPROVED)` writes a
   `Confirmation` and moves the job to `confirmed`. An explicit `DECLINED` moves it to `failed`
   with `failureReason`. Deadlines expiring also produce `failed`, with a reason.

## 4. State machine

```
pending ──> discovering ──> awaiting_approval ──> confirmed
               │                    │
               └────────────────────┴──────> failed
```

- Terminal states: `confirmed`, `failed`. Terminal jobs are never edited; a retry is a **new job**
  with a new idempotency key. Re-picking inside the same job is **P2, not built**.
- Every transition increments `version`; a write with a stale version is **rejected**.
- **At most one active `RECOMMENDED`/`APPROVAL_PENDING` per `(job, requestVersion)`** — enforced by
  a unique partial index (or an equivalent transactional version-checked write), not by racing
  application logic. `requestVersion` is distinct from the optimistic `version` and is `1` in this
  milestone.
- `confirmed` requires ≥1 `Confirmation` row carrying `candidate` and `approvedBy`. Enforced.
- **Availability is `UNKNOWN` until a human responds.** A calendar gap, a home location or a route
  estimate may order outreach; it may never be read as "free".

## 5. Data dependencies

| Need | Source | Present today |
| --- | --- | --- |
| candidates + reason + authorization | `pickupCandidates(childId, asOf)` | yes |
| verified contact methods | `ContactMethod` (`channel`, `value`, `preferred`, `verified`) | yes |
| vehicle | `Person.vehicles` — needs `pickup.verify` | yes, scope-gated |
| job, attempts, questions, confirmations | `coordination_jobs`, `attempts`, `information_requests`, `confirmations` | tables exist, **empty by design** |
| per-candidate reason code | `CandidateEvaluation` (**NEW**) — 8 codes, `acceptedVia`, ride-cost fields | **missing** |
| decline reason | `DeclineReason` (**NEW** enum: `BUSY`, `NO_TRANSPORT`, `OTHER`) | **missing** |
| job timeouts | `CoordinationJob.discoveryTimeoutSeconds`, `approvalTimeoutSeconds` (**NEW**) | **missing** |
| confirmation provenance | `Confirmation.candidate`, `Confirmation.approvedBy` (**NEW**) | **missing** |
| destination labelling | `Attempt.destinationMode` (**NEW** enum `TEST_RESPONDER`/`REAL_CONSENTED`) | **missing** |
| enforced idempotent create | `idempotency_key` unique column | **column yes, create path missing** |
| locations + route | `Location`, `PickupRoute`, `CandidateRouteLeg` (**NEW**, `village`, `address.read`) | **missing; no address field exists anywhere** |
| ride-cost policy | `HouseholdPolicy` `ride_cost_cap_usd` (EXISTING type, new seed row) | yes — $10 for `h_a` |
| `address.read` grant | `grants` row for `p_price` | **missing — blocks `pickupRoute`** |
| outbound channel adapter | n8n webhook (§6) | **missing** |
| labelled test responders | — | **missing** |

## 6. Constraints

- Runs as the **caller's identity** through the normal per-request client. No privileged path, no
  service-role key in request handling.
- **No real human is contacted in development, except the single consented exception below.**
- **Real-call exception — two independent gates, both required.** `REAL_CALL_EXCEPTION_ENABLED`
  defaults to **false in the executable dispatch logic** (never set by a test, a skip or a
  simulated failure), **and** a `RealCallAuthorization` that is single-use, short-lived, bound to
  the recipient **and** the specific attempt, and consumed in one atomic backend operation.
  Expired or already-consumed authorization is a hard rejection. Either gate missing = **no call
  placed**, never a silent downgrade or a silent dial.
- The consented number is provisioned **inside GHL**, never in this repo.
- Spending (SMS, voice minutes, model calls at volume) needs explicit approval first.
- Vehicle plate never reaches a caller without `pickup.verify`.
- Locations and coordinates never reach a caller without `address.read`, enforced before any
  coordinate is returned.
- Webhooks: HMAC-SHA256 over `timestamp.rawBody` with a 5-minute tolerance and constant-time
  comparison for n8n ↔ FridgeGraph; the GHL `voice-turn` boundary is **documented as weaker**
  (static secret + unsigned timestamp, availability-only, no path to approval and no path to a
  real-call authorization). Never describe the unsigned timestamp as replay protection.
- Voice-turn decisions must be **deterministic and under 2 seconds**; no model call may block a
  live turn.

## 7. Acceptance criteria

1. Duplicate `requestPickup` with the same idempotency key returns the **same** job; no second row.
2. A full walk `pending → discovering → awaiting_approval → confirmed` against test responders,
   with `version` incrementing on every step and at least one acceptance through **each** entry
   point.
3. Stale-version write rejected — demonstrated by an actual rejected write.
4. Creating a second `RECOMMENDED`/`APPROVAL_PENDING` for the same `(job, requestVersion)` fails.
5. `confirmations`-less `confirmed` fails — demonstrated.
6. `approvePickup` by anyone other than that date's `approverFor` is rejected.
7. `approvePickup(decision: DECLINED)` moves the job to `failed` with a recorded `failureReason`.
8. A late `acceptPickup` after `awaiting_approval` is recorded and changes nothing.
9. No candidate outside `pickupCandidates` is ever contacted — negative test, including
   `UNAUTHORIZED` audit rows.
10. An unverified contact method is never used; that candidate gets `NO_VERIFIED_CONTACT_METHOD`
    and **no `Attempt`**, proven by a deterministic unit-level test (seed unchanged).
11. Real-call dual gate proven **both ways**: flag set without a valid authorization places no
    call; a valid authorization with the flag unset places no call; a consumed or expired
    authorization is rejected; the authorization is unusable immediately after one use.
12. `npm run typecheck` and `npm run check` clean; evidence file committed; the asserted suite
    passes identically at `DEMO_CLOCK=1` and `DEMO_CLOCK=0`.

## 8. Out of scope

- Real telephony/SMS billing beyond the one consented demo call.
- Continuous GPS tracking, real Uber booking or fare verification. Route animation uses
  `SimulatedTrackingState`, labelled **SIMULATED** everywhere, never the verified-location field.
- Multi-child or multi-day batch coordination.
- New subgraphs.
- Any frontend beyond what `frontend-data.md` already specifies.
- `PickupCompletion` (approval ≠ completion) — specified in the contract, **not built**.

**Voice is in scope**, narrowly: the GHL `voice-turn` Custom Action path and the one consented real
call behind the dual gate. (The old spec's "voice calls are a later milestone" is superseded.)

## 9. Risks

| Risk | Mitigation |
| --- | --- |
| Model invents a confirmation | `confirmed` is a row written only by `approvePickup`; enforced in one place |
| **Adult acceptance mistaken for permission** | availability and permission are separate rows and separate mutations; `confirmed` requires the named approver's `APPROVED` |
| **Webhook replayed** | HMAC + 5-minute tolerance + constant-time compare + durable dedupe on n8n ↔ FridgeGraph; the `voice-turn` boundary is availability-only with Attempt/recipient/channel binding, so a replay cannot approve or place a call |
| Double-send after crash | idempotency key on job **and** per-attempt guard |
| Contacting the wrong person | candidates only from `pickupCandidates`; recipient/channel/provider-metadata binding; negative test |
| Spoken identity trusted | never sufficient — binding uses the Attempt's recipient, channel and `requestVersion` |
| Leaking plate/contact/address data | per-resolver scope checks; `pickup.verify`; `address.read` before any coordinate |
| Ride estimate read as a real quote | every record carries `costBasis`; labelled synthetic (haversine × $1.40/mi) |
| Shared live database mutated by tests | clean up in the same run; never reset shared state — `data-model.md` §1 |
| Provider rate limits read as auth failures | `ROUTER_FREE_PLAN_RATE_LIMIT_REACHED` is an account limit; never report it as a code pass |
