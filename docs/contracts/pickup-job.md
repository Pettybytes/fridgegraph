# Contract — the pickup job

Milestone 3. This is the first job where an agent **acts outside the graph** — it contacts real humans and records their answers. That makes it the most dangerous surface in the repo. Read `AGENTS.md` §1 first.

Full specification: `docs/spec/milestone-3-pickup-job.md`.

## 1. Goal

Given a child and a date, find who can cover a pickup, ask the right person through a real channel, and record a confirmation that a human actually gave — or record honestly that nobody confirmed.

## 2. What the model may and may not do

| The model MAY | The model MAY NOT |
| --- | --- |
| Choose **who** to contact, from the graph's candidates | Invent a person, a phone number or a channel |
| Choose **which** channel, from that person's verified methods | Use an unverified contact method as if it were verified |
| Compose the message text | Compose a confirmation |
| Record that it sent something, with the provider's receipt | Claim "they said yes" without a recorded inbound reply |
| Escalate to a parent when stuck | Widen its own permissions or scope |

**A confirmation is a row created by inbound evidence, never by the model's prose.** If the inbound channel has not delivered a reply, the job is `awaiting_*`, not `confirmed`.

## 3. Who may be contacted

Candidates come from `pickupCandidates(childId, asOf)` only. Each carries `person`, `reason`, `authorization`, `availability`.

- **Reachable** means the person has a `ContactMethod` with `verified: true`. Anything unverified is a dead end and must be reported as such, not attempted.
- Preferred method is a hint, not a mandate; fall through to the next **verified** method.
- **Vehicle data** (`year`, `make`, `model`, `color`, `plate`) is gated by `pickup.verify`. A caller without it gets `null` — that is correct behaviour, not a bug to work around. Never surface a plate to someone without the scope.

## 4. Contact record contract

Every contactable person must arrive with enough to act on and to audit:

| Field | Required | Notes |
| --- | --- | --- |
| name | yes | display name from the graph |
| relationship / reason | yes | why they are a candidate |
| reachable channels | yes | only `verified` methods; each with channel type |
| preferred channel | yes | the person's stated preference, may be unverified |
| authorization | yes | scope under which they are a candidate |
| vehicle | only with `pickup.verify` | absent, never partial |
| availability | yes | `UNKNOWN` until a human says otherwise |

If any required field is missing for a candidate you intend to contact, **stop** — the job waits, it does not guess.

## 5. State machine

```
pending
  └─> awaiting_parent      asked a parent / guardian for direction
        └─> awaiting_adult asked a non-parent adult
              └─> confirmed    inbound reply recorded
              └─> failed       no confirmed cover by the deadline
```

- Transitions are explicit and **versioned**. Every write increments `version` and is rejected if the caller's version is stale — no lost updates.
- `failed` and `confirmed` are terminal. Reopening a terminal job creates a **new** job with a new idempotency key.
- `InformationRequest` rows record questions asked; `Attempt` rows record outbound sends with channel and time; `Confirmation` rows record inbound evidence. A job in `confirmed` **must** have at least one `Confirmation`.

## 6. Idempotency

- `coordination_jobs.idempotency_key` already exists and is unique. **A create path that enforces it is still missing** — build it before you build retries.
- Re-running a job with the same key returns the existing job. It never creates a second one and never re-sends.
- Every outbound attempt needs its own guard: an agent that crashes mid-send must not double-send on restart.

## 7. Channels — test rules

- No real person is contacted during development. Use **labelled test responders** — numbers and identities that are unmistakably test fixtures and are named as such in the send log.
- Every send records: channel, destination (test-labelled), timestamp, provider message id, and the job/attempt it belongs to.
- A failed send is `failed`, not "probably delivered". Silence is not a confirmation.

## 8. Authorization

- The job runs **as the caller's identity**, through the same per-request client as everything else. It does not get a privileged path.
- No service-role key in the job's request handling. Ever.
- Scope checks happen per resolver. The router is not a boundary; neither is the job.

## 9. Forbidden

- Contacting anyone not returned by `pickupCandidates`.
- Sending to an unverified method.
- Marking `confirmed` without a `Confirmation` row.
- Re-sending after a crash without an idempotency guard.
- Claiming a live call or text worked when only a mock ran.
- Spending money (voice minutes, SMS credits, model calls at scale) without explicit approval.

## 10. Definition of done

1. Job created with an enforced idempotency key; duplicate create returns the same job.
2. State machine walks `pending → awaiting_parent → awaiting_adult → confirmed` against test responders, with versions incrementing.
3. A stale-version write is rejected — proven, not asserted.
4. `confirmed` requires a `Confirmation` row — proven by attempting the transition without one and watching it fail.
5. No candidate outside `pickupCandidates` is ever contacted; proven with a negative test.
6. Evidence file in `docs/evidence/`, plus `npm run check` and `npm run typecheck` clean.
