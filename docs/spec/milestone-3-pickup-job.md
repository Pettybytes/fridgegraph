# Spec — Milestone 3: the pickup job

Status: **not implemented.** This is the specification the implementation is measured against.
Contract: `docs/contracts/pickup-job.md`. Rules: `AGENTS.md`.

## 1. Problem

A child needs to be picked up. The graph knows who is related, who holds grants, who is scheduled, and who is reachable — but nobody has actually been asked. Today a parent finds out at 3pm by text that nobody is coming.

The job closes that gap: it **asks a real person through a real channel and records the real answer**.

## 2. Actors

| Actor | Role |
| --- | --- |
| Parent / guardian | authority; may redirect the job, may be asked directly |
| Adult candidate | a person returned by `pickupCandidates` with a verified channel |
| Coordination agent | chooses who and how, composes text, records attempts |
| The graph | the only source of candidates, contacts and permissions |
| Test responder | a labelled fixture standing in for a human during development |

## 3. Flow

1. **Trigger.** A pickup need exists for `childId` at `asOf` (date + time window).
2. **Candidates.** Read `pickupCandidates(childId, asOf)`. Reject anyone without a verified contact method, and record the rejection reason.
3. **Rank.** Parents first when the policy requires a parent decision, then adults by preference and availability. Ranking is deterministic and logged.
4. **Ask.** Send through the chosen verified channel. Record `Attempt`: channel, test-labelled destination, timestamp, provider id.
5. **Wait.** Job moves to `awaiting_parent` or `awaiting_adult`. No timeout means no state change.
6. **Record.** An inbound reply creates a `Confirmation` row. Only then does the job become `confirmed`.
7. **Escalate or fail.** No reply → next candidate. Deadline passed with nobody → `failed`, with the full attempt history.

## 4. State machine

```
pending ──> awaiting_parent ──> awaiting_adult ──> confirmed
                  │                    │
                  └────────────────────┴────────> failed
```

- Terminal states: `confirmed`, `failed`. Terminal jobs are never edited; a retry is a new job with a new idempotency key.
- Every transition increments `version`. A write with a stale version is **rejected**.
- `confirmed` requires ≥1 `Confirmation` row. This is enforced, not documented.

## 5. Data dependencies

| Need | Source | Present today |
| --- | --- | --- |
| candidates + reason + authorization | `pickupCandidates(childId, asOf)` | yes |
| verified contact methods | `ContactMethod` (`channel`, `value`, `preferred`, `verified`) | yes |
| vehicle (for the driver, or to identify them) | `Person.vehicles` — needs `pickup.verify` | yes, scope-gated |
| job, attempts, questions, confirmations | `coordination_jobs`, `attempts`, `information_requests`, `confirmations` | tables exist, **empty by design** |
| enforced idempotent create | `idempotency_key` unique column | **column yes, create path missing** |
| history | `village_event` | exists; insert is service-role only — revisit when the job writes history |
| outbound channel adapter | — | **missing** |
| labelled test responders | — | **missing** |

## 6. Constraints

- Runs as the **caller's identity** through the normal per-request client. No privileged path.
- No service-role key in request handling.
- No real human is contacted in development. Test responders only, labelled as such.
- Spending (SMS, voice minutes, model calls at volume) needs explicit approval first.
- Vehicle plate never reaches a caller without `pickup.verify`.

## 7. Acceptance criteria

1. Duplicate create with the same idempotency key returns the **same** job; a second row is never created.
2. Full walk `pending → awaiting_parent → awaiting_adult → confirmed` against test responders, with `version` incrementing on every step.
3. Stale-version write rejected — demonstrated by an actual rejected write.
4. `confirmed` without a `Confirmation` row fails — demonstrated.
5. No candidate outside `pickupCandidates` is ever contacted — negative test.
6. Unverified contact method is never used — negative test.
7. A crashed run does not double-send — guard demonstrated.
8. `npm run typecheck` and `npm run check` clean; evidence file committed.

## 8. Out of scope

- Real telephony or SMS provider selection and billing.
- Multi-child or multi-day batch coordination.
- Voice calls (a later milestone; the contract's audit fields already accommodate them).
- Any frontend for the job beyond a read-only view of state.

## 9. Risks

| Risk | Mitigation |
| --- | --- |
| Model invents a confirmation | `confirmed` is a row, never prose; enforced in one place |
| Double-send after crash | idempotency key on job **and** per-attempt guard |
| Contacting the wrong person | candidates only from `pickupCandidates`; negative test |
| Leaking plate/contact data | scope checks per resolver; `pickup.verify` required |
| Shared live database mutated by tests | clean up in the same run; never reset shared state — see `data-model.md` §1 |
| Provider rate limits read as auth failures | a `ROUTER_FREE_PLAN_RATE_LIMIT_REACHED` is an account limit; never report it as a code pass |
