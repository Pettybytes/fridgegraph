# Contract — the pickup job

Milestone 3 ("Station 06"). This is the first job where an agent **acts outside the graph** — it
contacts real humans and records their answers. That makes it the most dangerous surface in the
repo. Read `AGENTS.md` §1 first.

**Revision history:**
- Rev 2 (contract review): parallel discovery instead of sequential escalation; reason codes;
  availability vs. permission split.
- Rev 3 (this version — Bentley's implementer review, Bryan's final decisions): one transactional
  `acceptPickup` with two documented entry points; separated persisted facts for caregiver
  response / candidate selection / parent approval / pickup completion; an explicit approver-decline
  path; a precise ranking order; a canonical location model; a documented ride-cost formula;
  labelled simulated route tracking; webhook security (HMAC + a documented weaker trust boundary
  for the one provider that can't sign); and the real-call exception as a named, default-off flag.

This supersedes the sequential state machine in `docs/spec/milestone-3-pickup-job.md` ("Bentley's
Station 06 spec"). That file is not edited here — this task's scope is `docs/contracts/**` and
`docs/mocks/**` only — see the PR report for the full list of conflicts. Everything below marked
**NEW** is a request against today's schema (`schema/*.graphql`); everything marked **EXISTING**
is cited against a real file and line. Nothing below is implemented.

## 1. Goal

Given a child and a date: ask every authorized, reachable candidate at once, on their own
preferred verified channel; let a deterministic policy — never the model — turn the replies into
one recommendation; get the recommendation in front of the right parent for that day; and record
a confirmation only once that parent actually approves. If nobody qualifies, if the approver
declines, or if nobody approves in time, record that honestly as `failed`, with a reason, in an
immutable audit trail.

## 2. What the model may and may not do

| The model MAY | The model MAY NOT |
| --- | --- |
| Ask **every** authorized, reachable candidate from `pickupCandidates` at once — not one at a time | Invent a person, a phone number or a channel |
| Choose **which** verified channel to use for each candidate, from that person's own methods | Use an unverified contact method as if it were verified |
| Compose each outbound message, and the prose explanation shown to the approver | Assign a reason code (§5) — those come from deterministic policy code, never from the model |
| Record that it sent something, with the provider's receipt | Treat an adult's "yes" as permission, school release, or proof of pickup completion |
| Escalate to a parent when stuck | Mark a job `confirmed` without the correct parent's `approvePickup` call |
| | Infer availability from a calendar gap, a home location, or a route estimate — availability is `UNKNOWN` until a human says otherwise (§5a) |
| | Widen its own permissions or scope |

**Four separate persisted facts, never conflated (new in this revision):**

1. **Caregiver response** — a candidate said yes/no (or failed to respond). `CandidateEvaluation`
   (**NEW**), written by `acceptPickup`'s shared transactional logic (§8).
2. **Candidate selection** — the ranking picked exactly one candidate. A distinct write, by
   deterministic policy, that flips one `CandidateEvaluation.reasonCode` to `RECOMMENDED` →
   `APPROVAL_PENDING` (§5b). This is not the same event as #1 — a candidate can respond without
   being selected (e.g. over the cost cap).
3. **Parent approval** — the correct parent said yes. `Confirmation` (**NEW** fields, §7).
4. **Pickup completion** — the child was actually picked up. `PickupCompletion` (**NEW type**,
   **not built this milestone** — see §14). Approval is not completion; nothing in this contract
   claims a pickup happened just because it was approved.

## 3. Who may be contacted

Outbound `Attempt`s go only to candidates returned by `pickupCandidates(childId, asOf)` — unchanged.
The deterministic policy step (§5) also records a `CandidateEvaluation` with reason code
`UNAUTHORIZED` for a related person `pickupCandidates` excludes, purely for audit. **Nobody tagged
`UNAUTHORIZED` is ever contacted.**

- **Reachable** still means a verified `ContactMethod`. A candidate with none gets
  `NO_VERIFIED_CONTACT_METHOD` (§5) and is never dispatched an `Attempt` at all.
- Preferred method is a hint, not a mandate; fall through to the next verified method.
- **Vehicle data** stays gated by `pickup.verify`, unchanged.
- **Location data** (origins, the pickup/destination points, route legs — §6) is gated by
  `address.read`, enforced **before** any coordinate or address is returned, same per-resolver
  pattern as every other scope check in this repo (`data-model.md` §4).

## 4. Contact record contract

Unchanged: name, relationship/reason, verified channels, preferred channel, authorization, vehicle
(scope-gated), availability — all required before the job may act on a candidate. Missing any
required field still means **stop**, not guess.

## 5. Reason codes

Every candidate the job evaluates gets exactly one reason code. All are assigned by **deterministic
policy code** reacting to relationship, grant, contact, delivery, acceptance, transport, and
location/cost data — **never chosen by the model.**

| Code | Meaning | Assigned when |
| --- | --- | --- |
| `UNAUTHORIZED` | not a legitimate candidate at all | lacks an ACTIVE relationship + qualifying grant — recorded for audit; never contacted |
| `NO_VERIFIED_CONTACT_METHOD` **(NEW this revision)** | authorized, but has no verified `ContactMethod` | checked before dispatch; no `Attempt` is ever created for this person |
| `UNREACHABLE` **(NEW this revision)** | an `Attempt` was dispatched, but the channel itself failed to deliver (bounce, failed call setup) | a **technical delivery failure** — distinct from `UNAVAILABLE`, which means delivery succeeded and the person declined or never answered |
| `UNAVAILABLE` | delivered, but the candidate said no or never replied in the discovery window | from `acceptPickup`'s shared logic (§8) with `available: false`, or a discovery-window timeout — a timeout and an explicit "no" carry the **same** code |
| `AVAILABLE_NO_TRANSPORT` | said yes, but has no usable transport | crossed with `transport.child` capability / `Person.vehicles` — today's real seed gives every actual `pickup.request` holder for Nora a vehicle too, so this code is specified but not demonstrable; flagged in §14 |
| `OVER_POLICY` | said yes, has transport, but the estimated ride cost (§6a) exceeds the household's cap | **the cap decides permissibility, not availability** — the candidate stays a candidate; approval is a separate authorization (§6a) |
| `RECOMMENDED` | the one candidate the ranking (§5b) selects — the **candidate selection** fact | assigned once per job, by the ranking write, distinct from the candidate's own response |
| `APPROVAL_PENDING` | the same candidate as `RECOMMENDED`, now the one waiting on the approver | the job's externally visible tag while `status = awaiting_approval` |

The gate order below resolves any candidate where more than one reason could technically apply —
each person gets exactly one code, from the first check that disqualifies or advances them:

```
1. authorization (ACTIVE relationship + qualifying grant)      → UNAUTHORIZED if it fails
2. verified contact method exists                              → NO_VERIFIED_CONTACT_METHOD if not
3. Attempt dispatched; did the channel actually deliver?        → UNREACHABLE if delivery failed
4. delivered — did a human respond, and how? (§5a/§5b)          → UNAVAILABLE / AVAILABLE_NO_TRANSPORT / OVER_POLICY / RECOMMENDED
```

### 5a. Outreach order (before anyone responds) — never a claim about availability

Before dispatch, candidates **may be prioritized for outreach** by authorization and estimated
feasibility (distance to the pickup point, estimated ability to arrive before the deadline — §6).
This ordering exists only to decide **who the job asks first if there's any practical limit on
concurrency** — it is a display/sequencing convenience, not a ranking of who will say yes.
**Availability stays `UNKNOWN` for every candidate until a human responds.** Never turn a calendar
gap, a home location, or a route estimate into a claim that someone is free or can arrive on time
— that claim can only come from a recorded caregiver response (§8).

### 5b. Recommendation ranking (after responses) — deterministic, not model-chosen

Operates only on candidates with a **human-confirmed** response. In order:

1. **Authorization** — must be authorized (already true of anyone with a response).
2. **Human-confirmed availability** — must have replied `available: true`.
3. **Transport** — must have usable transport (`transport.child` + a vehicle); never recommend
   `AVAILABLE_NO_TRANSPORT`, however willing.
4. **Estimated ability to meet the deadline** — using the canonical location model's
   `estimatedTravelMinutes` (§6) against the job's pickup deadline.
5. **Distance from the pickup point** — shorter `distanceMiles` (§6) wins among remaining ties.
6. **Stable resolver order** — `pickupCandidates`' own deterministic ordering, as the final,
   never-ambiguous tie-break.

**Permissibility gate, separate from the six keys above:** among candidates who pass 1–6, only
those **within the household's ride-cost cap** (not `OVER_POLICY`) are placed in the normal
recommendation pool. If that pool is empty but at least one `OVER_POLICY` candidate passed 1–6,
the best `OVER_POLICY` candidate is recommended anyway, explicitly flagged, and the approver's
`approvePickup` call is what authorizes spending over the cap — the cap decides permissibility;
approval decides permission; these are deliberately two different gates (§6a).

## 6. The canonical location model

**One location model, shared by outreach prioritization (§5a), the ride-cost policy (§6a), the
recommendation route mini-map, the Geographic Map surface (`frontend-data.md` §4), and — not in
this milestone — opted-in live tracking (§9).** All **NEW**; no geographic field exists anywhere
in `schema/*.graphql` today.

```graphql
enum LocationSource { SUPPLIED ESTIMATED VERIFIED }

type Location {
  lat: Float!
  lng: Float!
  source: LocationSource!
  capturedAt: String!   # freshness — when this value was supplied/estimated/verified, not "now"
}

type PickupRoute {
  child: Child!
  pickupPoint: Location!        # Nora's school
  destinationPoint: Location!   # Nora's home
  legs: [CandidateRouteLeg!]!
}

type CandidateRouteLeg {
  candidate: Person!
  origin: Location!
  distanceMiles: Float!
  distanceBasis: String!            # "haversine straight-line" — always this, never a routed distance
  estimatedTravelMinutes: Float!
  travelTimeBasis: String!          # a labelled modelling assumption, e.g. "30 mph flat average over straight-line distance — not a routed ETA"
}
```

- Every `Location` carries `source` (so a stored address never reads as live GPS) and
  `capturedAt` (so staleness is visible, not implied-fresh).
- `address.read` (decided in the previous revision, owned by `village`) is **enforced before any
  `Location` field is returned** — same pattern as every other scope gate: missing scope →
  `null` + `UNAUTHORIZED`, never a silently degraded value.
- Demo coordinates are **fictional and non-residential** — reference points, not real addresses,
  even though the underlying concept ("Nora's school," "Nora's home") is a real-shaped one.

### 6a. Ride cost — a documented, fictional formula

**Formula, the same for every candidate, no exceptions:**
`estimatedRideCostUsd = distanceMiles (haversine straight-line) × $1.40/mile`

Stored on `CandidateEvaluation` (**NEW fields**): `estimatedRideCostUsd: Float`,
`costBasis: String!` (always `"FridgeGraph synthetic planning estimate: haversine distance ×
$1.40/mi"`), `distanceMiles: Float`, `locationProvenance: LocationSource` (copied from the
candidate's origin `Location.source`), `costCalculatedAt: String!`.

- **This is never an Uber quote, a fare, a road distance, a verified ETA, or a booking.** The
  `costBasis` string says so on every record; nothing in the UI may relabel it as a real quote.
- Travel time (`CandidateRouteLeg.estimatedTravelMinutes`) is a **labelled modelling assumption**
  (flat average speed over straight-line distance), not a routed ETA — same honesty rule as the
  cost.
- The household's `ride_cost_cap_usd` policy value (`HouseholdPolicy`, EXISTING type, decided in
  the previous revision) decides **permissibility** (§5b). Kendra's real demo cap is $10; Loretta
  Brooks' real demo estimate is **≈ $12.40** (8.86 mi × $1.40/mi), which is why she is
  `OVER_POLICY` — not unavailable, not disqualified, just over the line a parent would need to
  explicitly cross.
- **Parent approval stays a separate authorization.** Even an in-cap recommendation still needs
  `approvePickup` — the cap never substitutes for consent, and consent never substitutes for the
  cap check having run.

## 7. State machine

```
pending ──> discovering ──> awaiting_approval ──> confirmed
               │                    │
               └────────────────────┴──────> failed
```

| State | Meaning |
| --- | --- |
| `pending` | job created, idempotency key enforced, no outbound sends yet |
| `discovering` | `Attempt`s dispatched **in parallel** to every candidate from `pickupCandidates`; caregiver responses recorded via `acceptPickup`'s two entry points (§8) |
| `awaiting_approval` | the ranking (§5b) selected exactly one candidate (`RECOMMENDED` → `APPROVAL_PENDING`); waiting on the approver named by `approverFor` for that date |
| `confirmed` | the correct parent called `approvePickup` with `decision: APPROVED`; a `Confirmation` row exists; **terminal** |
| `failed` | discovery deadline passed with no usable candidate, the approval deadline passed with no response, **or the approver explicitly declined**; a `failureReason` is recorded either way; **terminal** |

- Every transition increments `version`, rejected if stale — unchanged.
- **At most one active `RECOMMENDED`/`APPROVAL_PENDING` per `(job, requestVersion)`** — enforced
  by a DB constraint (a unique partial index on `CandidateEvaluation` where
  `reasonCode IN (RECOMMENDED, APPROVAL_PENDING)`, scoped to `(jobId, requestVersion)`) or an
  equivalent transactional, version-checked write. `requestVersion` (**NEW** `CoordinationJob`
  field, distinct from the optimistic-concurrency `version`) is always `1` in this milestone —
  it exists so a future re-pick-in-the-same-job (§14, explicitly **P2**, not now) has somewhere to
  live without becoming a new job.
- **Simultaneous acceptances are resolved by that same constraint**, not by application logic
  racing: if two candidates' responses arrive close enough together that both could plausibly be
  ranked first, only one write can win the unique slot; the other is retried against the
  already-decided state and recorded without changing the outcome.
- `confirmed` and `failed` remain the only terminal states. **A new request is a new job, with a
  new idempotency key — unchanged.** Re-picking a different candidate **inside the same job**,
  after a decline or a failure, is explicitly **P2** — not built, not attempted here.
- `confirmed` still requires **at least one** `Confirmation` row (**NEW fields**:
  `candidate: Person!`, `approvedBy: Person!`).
- **Approver decline.** `approvePickup(decision: DECLINED)` moves the job directly to `failed`,
  recording `failureReason: "approver_declined"` plus the approver's own free-text reason if given.
  This is immutable audit history, same as every other write in this contract — a decline is never
  edited or removed after the fact.
- **Late replies, duplicate replies, and stale-version writes are rejected or recorded without
  effect** — unchanged in substance from the previous revision; restated precisely in
  `webhook.md` §9.

## 8. Mutations and the `acceptPickup` entry points

All mutations below are **NEW** — `schema/coordination.graphql` has no `Mutation` type today.

```graphql
requestPickup(childId: ID!, asOf: String): CoordinationJob!
acceptPickup(attemptId: ID!, available: Boolean!, declineReason: DeclineReason): CandidateEvaluation!
approvePickup(jobId: ID!, version: Int!, decision: ApprovalDecision!, declineReason: String): CoordinationJob!
```

`acceptPickup` is **one transactional transition with two documented entry points.** Both apply
**identical** rules — job version / `requestVersion`, intended recipient, channel, idempotency,
and terminal-state checks — and both record **which entry point produced the acceptance**
(**NEW** `CandidateEvaluation.acceptedVia: AcceptanceEntryPoint` enum:
`WEBHOOK_CALLBACK | CANDIDATE_JWT`). Neither entry point is a second, looser way to accept — they
are two callers into the same shared transactional logic.

- **Entry point A — Primary, this demo: the authenticated n8n/GHL webhook callback.** Not reachable
  as a public GraphQL mutation; only FridgeGraph's own webhook handler (HMAC-authenticated per
  `webhook.md` §3) can reach the shared transactional function. It binds the response to an
  **existing `Attempt`**, that `Attempt`'s intended recipient, its channel, and the job's
  `requestVersion` at dispatch time — using **verified provider metadata where available** (e.g.
  the GHL conversation/call id established when the `Attempt` was dispatched, or the destination
  number actually dialed/texted matching the `Attempt`'s destination). **It never trusts a spoken
  identity on a call (someone saying "this is Bryan") or a bare `attemptId` alone as sufficient
  binding** — the recipient/channel/version match is required in addition.
- **Entry point B — P1, not this demo: the candidate's own Supabase JWT, via an approved MCP
  mutation.** A real GraphQL mutation call, authenticated the same way as every other write in this
  repo: the caller's own token, server-resolved to a `personId`, checked against the `Attempt`'s
  `candidate` — never a client-asserted person id.
- **Either way, acceptance means willingness/availability only.** It is not parent approval
  (`approvePickup`), not school release (not modeled this milestone), and not pickup completion
  (`PickupCompletion`, §2, §14).

`approvePickup`'s `decision` is `APPROVED` or `DECLINED` (**NEW** enum `ApprovalDecision`) — see
§7 for the decline path. Only the person `approverFor(childId, asOf)` names as `approver` for that
date may call it, enforced server-side.

## 9. Idempotency

Unchanged in substance: `requestPickup`'s idempotency key still needs an enforced create path.
Re-running with the same key returns the existing job, never a second row. Every `Attempt`, and
now every `acceptPickup` call regardless of entry point, needs its own crash-safe, replay-safe
guard — detailed per-transport in `webhook.md` §4/§8.

## 10. Channels — test rules, and the one real-call exception

No real person is contacted during development **except the one exception below.**

**Real-call exception.** Governed by a named flag, `REAL_CALL_EXCEPTION_ENABLED`, **default
`false` in code** — there is no environment or config path that makes it default-on. When `true`
for a run:

1. Exactly **one** explicitly consented recipient — a stand-in for "Grandma Loretta" — may be
   dialed.
2. That number is **provisioned once, inside GHL** (as a GHL contact/config), **never in this
   repo** — not in a fixture, not in an example, not even as a redacted placeholder shaped like a
   real number. FridgeGraph references it by a GHL-side identifier, not a literal digit string.
3. Every log line, `Attempt`, and `CandidateEvaluation` touching that call is labelled
   **`real-consented`** — see `frontend-data.md` §1.4's three-way badge. Every other responder,
   on every other run, is labelled `simulated`/`test-responder`.

`DeclineReason` (**NEW** enum, used by `acceptPickup` and the voice-turn `DECLINED` decision,
`webhook.md` §10): `BUSY`, `NO_TRANSPORT`, `OTHER`. `NO_TRANSPORT` feeds `AVAILABLE_NO_TRANSPORT`
in the ranking; `BUSY`/`OTHER` feed plain `UNAVAILABLE`.

## 11. Authorization

Unchanged: the job runs as the caller's identity through the normal per-request client; no
privileged path; no service-role key in request handling; scope checks per resolver, including the
new `address.read` gate (§3, §6).

## 12. Forbidden

- Contacting anyone not returned by `pickupCandidates`, including anyone tagged `UNAUTHORIZED`.
- Sending to an unverified method, or claiming `UNREACHABLE` for a candidate who was never
  actually dispatched an `Attempt` (that's `NO_VERIFIED_CONTACT_METHOD`, a different fact).
- Treating `acceptPickup`'s `available: true` — from **either** entry point — as permission,
  school release, or pickup completion.
- Trusting a spoken identity on a call, or a bare `attemptId`, as sufficient to bind an acceptance
  — the recipient/channel/version checks in §8 are mandatory, not optional hardening.
- Marking a job `confirmed` without `approvePickup` from the correct parent.
- Letting a late `acceptPickup` reply reopen `discovering` or change an already-made
  recommendation.
- Re-picking a different candidate inside the same job after a decline or failure — that is P2,
  not built; the correct move is a new `requestPickup` call (a new job, new idempotency key).
- Assigning a reason code from the model's own judgment rather than the deterministic policy in
  §5/§5a/§5b.
- Inferring availability from a calendar gap, a home location, or a route/distance estimate —
  those drive outreach order (§5a) and ranking among responders (§5b), never a claim that someone
  is free.
- Presenting the ride-cost estimate (§6a) as an Uber quote, a fare, a road distance, a verified
  ETA, or a booking.
- Enabling the real-call exception by default, storing its number in the repo, or dialing anything
  other than the one consented number while it's enabled.
- Re-sending after a crash without an idempotency guard.
- Claiming a live call or text worked when only a mock (or an un-enabled real-call exception) ran.
- Spending money (voice minutes, SMS credits, model calls at scale) without explicit approval.

## 13. Definition of done

1. `requestPickup` dispatches to every candidate from `pickupCandidates` **in parallel**.
2. A full walk `pending → discovering → awaiting_approval → confirmed`, with at least one
   acceptance recorded through **each** entry point across the test suite (even though only
   entry point A is wired for the demo itself), `version` incrementing on every step.
3. At least one candidate tagged `OVER_POLICY`, one `UNAVAILABLE`, and the ranking in §5b
   correctly skips both in favor of a clean candidate — proven, not asserted.
4. The unique-active-recommendation constraint (§7) is proven by attempting to create a second
   `RECOMMENDED`/`APPROVAL_PENDING` row for the same `(job, requestVersion)` and watching it fail.
5. `approvePickup(decision: DECLINED)` is proven to move the job to `failed` with a recorded
   `failureReason`, without touching any other job.
6. A late `acceptPickup` from a non-recommended candidate, sent after `awaiting_approval`, is
   recorded but changes nothing.
7. `approvePickup` from someone who is **not** that date's `approverFor` approver is rejected.
8. `confirmed` without a `Confirmation` row still fails.
9. No candidate outside `pickupCandidates` is ever contacted — negative test.
10. If the real-call exception was used, the run's logs show `REAL_CALL_EXCEPTION_ENABLED=true`
    was set explicitly, the number came from GHL (not the repo), and every touched record is
    labelled `real-consented`.
11. Evidence file in `docs/evidence/`, plus `npm run check` and `npm run typecheck` clean.

## 14. Open questions for Bryan

Resolved this revision (recorded in place above, not repeated here): the two `acceptPickup` entry
points and their shared transactional rules (§8); the approver-decline path and re-pick-in-same-job
being explicitly P2 (§7); the exact ranking order and the authorization/availability/transport/
deadline/distance/resolver-order sequence (§5b); `NO_VERIFIED_CONTACT_METHOD` vs. `UNREACHABLE`
(§5); the canonical location model and its ownership/scope (§6); the ride-cost formula (§6a); and
`REAL_CALL_EXCEPTION_ENABLED` as a named, default-off flag with the number provisioned only in GHL
(§10).

Still genuinely open:

1. **`PickupCompletion` is specified but not built.** How it's actually recorded — a school
   check-out integration, a parent self-report, something else — is undecided, and nothing in this
   milestone wires it to anything.
2. **`AVAILABLE_NO_TRANSPORT` has no real seed example.** Every actual `pickup.request` holder for
   Nora already has a vehicle in `src/fixtures.ts`.
3. **No real seed example cleanly demonstrates `NO_VERIFIED_CONTACT_METHOD` either**, for a subtler
   reason: Dana Coleman (`p_dana`) is used for it in `docs/mocks/pickup-candidates.json` because
   her only contact method is unverified, but she **also** fails the authorization gate
   independently (her relationship to Nora is `DISCOVERED`, not `ACTIVE`, and she holds no grant
   for Nora at all) — in the strict gate order in §5, she would actually be caught as
   `UNAUTHORIZED` first, never reaching the contact-method check. She is used anyway, per explicit
   instruction, as the clearest available real-seed illustration of what the code means; a person
   who is authorized but fails only the contact-method check does not exist in today's seed.
4. **Where `PickupRoute`/`CandidateRouteLeg` data actually comes from for real people** — today's
   schema has zero stored addresses anywhere; §6 specifies the shape but seeding real (fictional)
   coordinates for Nora's school/home and each candidate's origin is unstarted work.
