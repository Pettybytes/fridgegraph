# Contract — the pickup job

Milestone 3. This is the first job where an agent **acts outside the graph** — it contacts real
humans and records their answers. That makes it the most dangerous surface in the repo. Read
`AGENTS.md` §1 first.

**Revision note (this version):** reworked after contract review to match the Build Line demo —
parallel discovery instead of sequential escalation, deterministic reason codes instead of a
reachable/unreachable binary, and a hard split between an adult's *availability* and a parent's
*permission*. This supersedes the sequential state machine in `docs/spec/milestone-3-pickup-job.md`
("Bentley's Station 06 spec") — see that file's own header; nothing there was edited, because this
contract's scope is `docs/contracts/**` and `docs/mocks/**` only. The spec document is now stale
against this contract and should be reconciled in its own task. Everything below marked **NEW** is
a request against today's schema (`schema/*.graphql`), not an implementation.

## 1. Goal

Given a child and a date: ask every authorized candidate at once, on their own preferred verified
channel; let a deterministic policy — never the model — turn the replies into one recommendation;
get the recommendation in front of the right parent for that day; and record a confirmation only
once that parent actually approves. If nobody qualifies, or nobody approves in time, record that
honestly as `failed`.

## 2. What the model may and may not do

| The model MAY | The model MAY NOT |
| --- | --- |
| Ask **every** authorized candidate from `pickupCandidates` at once — not one at a time | Invent a person, a phone number or a channel |
| Choose **which** verified channel to use for each candidate, from that person's own methods | Use an unverified contact method as if it were verified |
| Compose each outbound message, and the prose explanation shown to the approver | Assign a reason code (§5) — those come from deterministic policy code, never from the model |
| Record that it sent something, with the provider's receipt | Treat an adult's "yes" as permission to proceed |
| Escalate to a parent when stuck | Mark a job `confirmed` without the correct parent's `approvePickup` call |
| | Widen its own permissions or scope |

**A confirmation is a row created by the correct parent's explicit approval — never by an adult's
availability reply, and never by the model's prose.** `acceptPickup` records *availability*.
`approvePickup` records *permission*. A job reaches `confirmed` only through the second one.

## 3. Who may be contacted

Outbound `Attempt`s go only to candidates returned by `pickupCandidates(childId, asOf)` — unchanged
from the original rule. What's new: the deterministic policy step (§5) may also record a
`CandidateEvaluation` with reason code `UNAUTHORIZED` for a related person `pickupCandidates`
excluded, purely for audit (so Mission Control can show "Chris Harlan — not asked, no
`pickup.request` grant" instead of silence). **Nobody tagged `UNAUTHORIZED` is ever contacted.**
That tag is a record of exclusion, not a weaker form of inclusion.

- **Reachable** still means a verified `ContactMethod`. Unverified is a dead end, recorded as such.
- Preferred method is a hint, not a mandate; fall through to the next verified method.
- **Vehicle data** stays gated by `pickup.verify`, unchanged.

## 4. Contact record contract

Unchanged from the original: name, relationship/reason, verified channels, preferred channel,
authorization, vehicle (scope-gated), availability — all required before the job may act on a
candidate. Missing any required field still means **stop**, not guess.

## 5. Reason codes

Every candidate the job evaluates gets exactly one reason code, assigned by deterministic policy
code reacting to relationship, grant, capability, vehicle and household-policy data — **never
chosen by the model, and never inferred from a reply's wording beyond a yes/no/declined signal**.

| Code | Meaning | Assigned when |
| --- | --- | --- |
| `UNAUTHORIZED` | not a legitimate candidate at all | related to the child, but lacking an ACTIVE relationship + `pickup.request` grant valid at `asOf` — recorded for audit; never contacted (§3) |
| `UNAVAILABLE` | asked, but said no or never replied in the discovery window | from `acceptPickup(available: false)`, a voice `DECLINED` turn, or a timed-out `Attempt` — a timeout and an explicit "no" carry the **same** code; this contract does not distinguish them |
| `AVAILABLE_NO_TRANSPORT` | said yes, but has no usable transport (no `transport.child` capability / no `Person.vehicles` row) | from `acceptPickup(available: true)` crossed with the EXISTING capability/vehicle data — **NEW**: today's real seed gives every actual `pickup.request` holder for Nora a vehicle too, so this code is specified but not demonstrable against current fixtures; flagged in §14 |
| `OVER_POLICY` | said yes, has transport, but the job's estimated ride cost exceeds the household's policy cap | from `acceptPickup(available: true)` crossed with a household `ride_cost_cap_usd` policy value (§6) — **over the cap is not the same as unavailable**; the candidate stays a candidate, just flagged |
| `RECOMMENDED` | the one candidate the ranking (below) selects as best | assigned once per job, the moment the policy has enough replies to decide |
| `APPROVAL_PENDING` | the same candidate as `RECOMMENDED`, now the one waiting on the approver | the job's externally visible tag while `status = awaiting_approval` (§7) — `RECOMMENDED` is the policy's selection event; `APPROVAL_PENDING` is what the candidate shows while waiting |

All six codes, and the `CandidateEvaluation` type that carries them, are **NEW** —
`schema/coordination.graphql` has no such type today.

### Ranking (deterministic, not model-chosen)

1. Drop `UNAUTHORIZED` and `UNAVAILABLE` — they are not in play.
2. Prefer a clean `AVAILABLE`-and-in-policy candidate over any `OVER_POLICY` candidate; never
   prefer `AVAILABLE_NO_TRANSPORT` — a candidate who cannot execute the pickup is never
   recommended, no matter how willing.
3. Among same-tier candidates, take the first one in `pickupCandidates`' own deterministic
   ordering (today: discovery order from `src/derive.ts`'s relationship/grant scan).
4. If the only tier with anyone in it is `OVER_POLICY`, recommend the first of those — the
   over-cap flag is surfaced to the approver (§6), not silently refused.
5. If nobody is in any usable tier by the discovery deadline, the job goes `failed` (§7).

## 6. Household policy as data

Two existing facts drive the new model, both read from EXISTING types with no schema change:

- **Ride-cost cap.** `HouseholdPolicy` (`schema/access.graphql`) already stores an arbitrary
  `rule`/`value` pair per household. A **NEW** row — `rule: "ride_cost_cap_usd"`, `value: "10"`,
  on `h_a` (Kendra's household) — is Kendra's $10 cap. Comparing a candidate's estimated ride cost
  against this value is what produces `OVER_POLICY` in §5. **How the ride cost itself is
  estimated is NEW and unspecified** — no distance/cost field exists anywhere in the schema today;
  flagged in §14.
- **Approver per day.** `parentingSchedule(childId)` and `approverFor(childId, date)`
  (`schema/access.graphql`, EXISTING) already resolve exactly this: for Nora on a Wednesday, the
  real seed's `approverFor` returns Kendra Ellison (`p_mom`) as `approver` and Andre Ellison
  (`p_dad`) in `fyiParents` — verified against `src/derive.ts`'s `approverForChild` and the real
  `parenting_schedules` rows (`p_mom`: `MON,TUE,WED`; `p_dad`: `THU,FRI,SAT,SUN`). The job uses this
  EXISTING query, unchanged, to find who may call `approvePickup` and who gets the FYI.

## 7. State machine

```
pending ──> discovering ──> awaiting_approval ──> confirmed
               │                    │
               └────────────────────┴──────> failed
```

| State | Meaning |
| --- | --- |
| `pending` | job created, idempotency key enforced, no outbound sends yet |
| `discovering` | `Attempt`s dispatched **in parallel** to every candidate from `pickupCandidates`, each on their own verified channel; replies come in via `acceptPickup` |
| `awaiting_approval` | the ranking (§5) has picked exactly one candidate (`RECOMMENDED` → `APPROVAL_PENDING`); waiting on the approver named by `approverFor` for that date |
| `confirmed` | the correct parent called `approvePickup`; a `Confirmation` row exists; **terminal** |
| `failed` | discovery deadline passed with no usable candidate, or the approval deadline passed with no approval; **terminal** |

- Every transition increments `version`, rejected if stale — unchanged.
- `confirmed` and `failed` remain the only terminal states; a retry is a **new** job, new
  idempotency key — unchanged.
- `confirmed` still requires **at least one** `Confirmation` row — unchanged, but a `Confirmation`
  now also carries **NEW** fields `candidate: Person!` (who was approved) and
  `approvedBy: Person!` (which parent approved) — `schema/coordination.graphql`'s `Confirmation`
  has neither field today.
- **Late replies never override the decision.** Once the job leaves `discovering`, any further
  `acceptPickup` call from a candidate who wasn't recommended is recorded against that candidate's
  `CandidateEvaluation` for audit, and changes nothing — it does not reopen discovery, does not
  change the recommendation, and does not move the job. This replaces the old sequential-escalation
  model's per-attempt late-reply rule (`docs/contracts/webhook.md` §9) with a job-level version of
  the same idea: a decision, once made, is made.
- There is deliberately **no modeled path for the approver to decline and get a second
  recommendation** in this milestone — see §14.

## 8. Mutations

All three are **NEW** — `schema/coordination.graphql` has no `Mutation` type today.

```graphql
requestPickup(childId: ID!, asOf: String): CoordinationJob!
acceptPickup(attemptId: ID!, available: Boolean!, declineReason: DeclineReason): CandidateEvaluation!
approvePickup(jobId: ID!, version: Int!): CoordinationJob!
```

- **`requestPickup`** — enforces the idempotency key (unchanged key shape:
  `pickup:<childId>:<asOf>:<window>`); reads `pickupCandidates(childId, asOf)` (EXISTING); creates
  one `CandidateEvaluation` per evaluated person (`UNAUTHORIZED` for exclusions, pending for the
  rest); dispatches one `Attempt` per candidate, all in parallel; sets `status = discovering`.
- **`acceptPickup`** — called by the identified candidate only (the same identity enforcement as
  every other write: the caller's own token, matched against the `Attempt`'s recipient — never a
  client-asserted person id). Records availability — **never** permission, **never** a
  `Confirmation`. `declineReason` (**NEW** enum, §10) is required when `available: false` and
  optional otherwise.
- **`approvePickup`** — called only by the person `approverFor(childId, asOf)` names as `approver`
  for that date, enforced server-side. Writes the `Confirmation` row, sets `status = confirmed`.
  There is no `decision` argument — this mutation only approves; see §14 for what a decline path
  would need.

## 9. Idempotency

Unchanged in substance: `requestPickup`'s idempotency key still needs an enforced create path
(still missing — building it is still the first step, now for `requestPickup` instead of a bare
job-create call). Re-running with the same key returns the existing job, never a second row. Every
`Attempt` still needs its own crash-safe guard.

## 10. Channels — test rules, and the one real-call exception

No real person is contacted during development **except the one exception below.** Test
responders are numbers and identities unmistakably labelled as test fixtures.

**Real-call exception.** Exactly **one** consented real phone number — a stand-in for "Grandma
Loretta," supplied and consented to by Bryan — may be dialed, and only when:

1. Bryan has **explicitly enabled it for that run.** There is no default-on state; a run with the
   exception unset behaves exactly like every other run (test responders only).
2. The dialed number is **that one number and no other.** The exception does not extend to any
   other candidate or channel.
3. Every log line, `Attempt`, and `CandidateEvaluation` touching that call is labelled
   **`real-consented`** — a third value alongside the test-responder labelling already in
   `docs/contracts/frontend-data.md` §1.4, not a silent "simulated: false." The UI's simulated
   badge (frontend-data.md §1.4) must render `real-consented` distinctly from both "simulated" and
   an unlabelled (i.e. production, not yet possible) call — never let it collapse into "not
   simulated" and look like an ordinary production call.

This is a narrow, explicit, Bryan-gated exception to `AGENTS.md`'s "no real person is contacted"
rule, documented here because it is real and already agreed — not a general real-telephony path.

`DeclineReason` (**NEW** enum, used by `acceptPickup` and the voice-turn `DECLINED` decision,
`docs/contracts/webhook.md` §10): `BUSY`, `NO_TRANSPORT`, `OTHER`. `NO_TRANSPORT` feeds
`AVAILABLE_NO_TRANSPORT` in the ranking; `BUSY`/`OTHER` feed plain `UNAVAILABLE`.

## 11. Authorization

Unchanged: the job runs as the caller's identity through the normal per-request client; no
privileged path; no service-role key in request handling; scope checks per resolver.

## 12. Forbidden

- Contacting anyone not returned by `pickupCandidates`, including anyone tagged `UNAUTHORIZED`.
- Sending to an unverified method.
- Treating `acceptPickup`'s `available: true` as permission to proceed.
- Marking a job `confirmed` without `approvePickup` from the correct parent — an adult's
  acceptance, however enthusiastic, is not a substitute.
- Letting a late `acceptPickup` reply reopen `discovering` or change an already-made
  recommendation (§7).
- Assigning a reason code from the model's own judgment rather than the deterministic policy.
- Dialing any number under the real-call exception (§10) other than the one Bryan has explicitly
  consented and enabled for that run, or enabling the exception by default.
- Re-sending after a crash without an idempotency guard.
- Claiming a live call or text worked when only a mock (or an un-enabled real-call exception) ran.
- Spending money (voice minutes, SMS credits, model calls at scale) without explicit approval.

## 13. Definition of done

1. `requestPickup` dispatches to every candidate from `pickupCandidates` **in parallel**, not
   sequentially — proven by attempt timestamps overlapping, not chained.
2. A full walk `pending → discovering → awaiting_approval → confirmed` against test responders,
   with `version` incrementing on every step.
3. At least one candidate in the walk is tagged `OVER_POLICY` and at least one `UNAVAILABLE`
   (timeout or decline), proving the ranking actually discriminates rather than just picking the
   first reply.
4. A late `acceptPickup` from a non-recommended candidate, sent after `awaiting_approval`, is
   recorded but changes nothing — proven, not asserted.
5. `approvePickup` from someone who is **not** that date's `approverFor` approver is rejected.
6. `confirmed` without a `Confirmation` row still fails — proven by attempting the transition
   without one.
7. No candidate outside `pickupCandidates` is ever contacted — negative test, including the
   `UNAUTHORIZED`-tagged audit rows.
8. If the real-call exception was used, the run's logs show it was explicitly enabled, dialed only
   the one consented number, and every touched record is labelled `real-consented`.
9. Evidence file in `docs/evidence/`, plus `npm run check` and `npm run typecheck` clean.

## 14. Open questions for Bryan

1. **No decline-and-reassign path.** If the approver declines the recommendation, this contract
   has no mutation for "pick someone else" — the job simply runs out its approval deadline and
   goes `failed`. Is that the intended demo behaviour, or does a real decline need its own path in
   a follow-up?
2. **Ride-cost estimation is undefined.** §6's `OVER_POLICY` code needs *some* number to compare
   against the cap. Nothing in the schema estimates one today. Is this a flat per-candidate value,
   a distance-based estimate (which would need `Location`, itself NEW per
   `docs/contracts/frontend-data.md` §4), or a manually entered figure?
3. **`AVAILABLE_NO_TRANSPORT` has no real seed example.** Every actual `pickup.request` holder for
   Nora already has a vehicle in `src/fixtures.ts`. The code is correctly specified but cannot be
   demonstrated without either new seed data or accepting it stays untested until one exists.
4. **Ranking tie-breaks beyond "first in discovery order."** If two candidates reply `available`
   in the same tier at nearly the same moment, §5 step 3 picks by `pickupCandidates`' own
   ordering — is that ordering itself something Bryan wants to make explicit and stable (e.g.
   relationship-type priority), or is "whatever the resolver already returns" acceptable?
