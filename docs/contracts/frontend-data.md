# Contract — frontend data (`web/`)

Status: **DRAFT — needs Bryan's approval.**

Companion to `docs/contracts/frontend.md` (stack boundaries, motion, env). This contract covers
**what data each screen asks for, from where, marked EXISTING or NEW against today's schema**
(`schema/*.graphql`, composed into `supergraph.graphql`). Nothing here authorizes a schema change —
every NEW item is a request, not an implementation.

## 1. Shared rules (apply to every surface below)

### 1.1 Identity: Supabase Auth → JWT → router

- The browser signs in with Supabase Auth (`@supabase/supabase-js`, publishable key only — see
  `frontend.md` §3). It never holds a service-role key or a DB URL.
- Apollo Client attaches the signed-in user's Supabase **access token** as the GraphQL request's
  `Authorization: Bearer <token>` header. There is no separate FridgeGraph login.
- **Router-level JWT is active** on the GraphOS-connected router (`docs/evidence/15-graphos-jwt-router.md`,
  `docs/evidence/16-edge-auth-and-mcp.md`) — this corrects the earlier draft, which cited
  `docs/auth-plan.md`'s Oct 26 "licence-gated, not active" note; the licence was confirmed and
  router-level JWT has been enforced at the edge since evidence 15/16. A tampered or malformed
  token is rejected **at the router** (`AUTH_ERROR`, before any subgraph runs). A **missing**
  token is **not** stopped at the edge — documented router behaviour — so it still reaches a
  subgraph and is rejected there as `UNAUTHENTICATED`. That is why subgraph-level verification
  stays regardless of the router: the edge only ever sees tokens that exist. Each subgraph still
  verifies the same token itself (ES256, `jose`, `sub` → `personId` via the server-side identity
  map). The frontend does not need to know which layer caught a given rejection — only that it
  must always send the token and handle `UNAUTHENTICATED` / `UNAUTHORIZED` distinctly (§1.3).
- No `x-demo-user` / `x-demo-date` header from the browser, ever. Those are server-side test-clock
  and historical dev-only inputs (`data-model.md` §7, `auth-plan.md` §0.1) — a production-shaped
  client does not send identity or clock hints, it sends a token and lets the server decide.

### 1.2 Identity propagation and child/village scope

- The frontend never asks "what can I see" by filtering client-side. It asks every query for the
  specific `childId` / `villageId` it wants, and trusts the server's answer:
  - a field it may not read comes back `null` with an `UNAUTHORIZED` error (per-resolver, not
    router-level — `data-model.md` §4);
  - a caller the server cannot identify at all gets `UNAUTHENTICATED`.
- The UI must render these two cases differently. `UNAUTHENTICATED` → send the user back through
  Supabase sign-in. `UNAUTHORIZED` → show "you don't have access to this," never a blank/broken
  widget, and never retry as if it were a network error.
- No screen hardcodes a `childId`. Kendra's phone, in every mock below, is scoped to Nora
  (`p_nora`) only because Kendra is a parent of Nora in the graph — the same query run as a
  different signed-in person returns different (or no) data.

### 1.3 Live updates: polling, not Realtime — decided

**Decided (Bryan): Apollo Client `pollInterval`, not Supabase Realtime, for v1.** Reason unchanged
from the draft: **no subgraph defines a `Subscription` type today** (verified:
`grep -rl "type Subscription" schema/` returns nothing), and Supabase Realtime would mean the
browser reads raw Postgres tables directly under RLS, bypassing the per-resolver field-level
authorization that `data-model.md` §4 calls "the real boundary." Polling against the
existing/NEW GraphQL queries below reuses the exact same scope checks the rest of the graph
already enforces, at the cost of latency (poll interval, not push). This was Open question #1 in
the previous draft — it is now settled for v1; Realtime remains a possible future escalation if
polling proves too slow, not a decision reopened here.

Intervals: **Mission Control polls every 2–3 s** for the demo (tightened from the draft's generic
5s — Mission Control's "acknowledge instantly, show progress, then verified results" requirement
needs it). The parent chat thread also polls at 5s. The Living Village graph and the calendar poll
at 30s. No polling for the map (coordinates change rarely in this milestone).

### 1.4 Simulated / real-consented labels

Milestone 3 contacts **no real person**, with exactly one narrow exception gated by a named,
default-off flag — `REAL_CALL_EXCEPTION_ENABLED` (`pickup-job.md` §10, `webhook.md` §6a — the one
consented "Grandma Loretta" stand-in number, provisioned only in GHL, never in this repo). Any UI
surfacing an `Attempt` must render one of **three** distinct visible states — never collapse the
exception into looking like an ordinary, unlabelled production call:

- **NEW** field request: `Attempt.destinationMode: DestinationMode!` (**NEW** enum:
  `TEST_RESPONDER`, `REAL_CONSENTED`) on the coordination subgraph, mirroring the wire field of
  the same name in `webhook.md` §5/§6a. This replaces the earlier boolean `simulated` field from
  the previous draft — a boolean can't carry the three-way distinction the real-call exception
  needs (ordinary test fixture vs. the one real-consented number vs., hypothetically, an
  unlabelled real call that should never happen at all).
- `TEST_RESPONDER` → "Simulated" badge. `REAL_CONSENTED` → a visually distinct "Real call
  (consented)" badge — never styled identically to "Simulated," and never allowed to read as a
  plain, unbadged production call.
- A `Confirmation`'s badge is derived from its `Attempt`'s `destinationMode` (via the candidate
  it confirms) rather than carrying its own copy of the field — one source of truth per job.

### 1.5 User-facing labels (binding)

Cost and policy copy is not free-form. These exact strings are required, and the prohibited words
must not appear in any label, badge, toast or notification:

| Concept | Required label |
| --- | --- |
| `estimatedRideCostUsd` / `distanceMiles` on a candidate | **"Estimated travel cost"** |
| `OVER_POLICY` state | **"Ride estimate over your limit"** |

- Never "ride fare", "Uber", "quote", "reimbursement", "charge" or "spend". The figure is a
  synthetic planning estimate of the candidate's trip to the pickup point (`pickup-job.md` §6a),
  applied consistently to every candidate including those using their own vehicles.
- Kendra's $10 is a **household travel-cost policy threshold**, not a spending authorization for
  any ride provider. Reviewing an over-limit option is an explicit exception, never a purchase.
- Where the estimate is displayed, `costBasis` must be shown verbatim.

## 2. Surface: Parent chat (Kendra's phone)

Display name and tagline, wherever the UI names the agent: **"Rosina, FridgeGraph's AI family
coordinator."** Attribution copy, if shown, reads "planning and decisions powered by Meta's Muse
Spark Open" — never implying the voice itself is a Meta model (full naming rule:
`docs/contracts/webhook.md`'s "Naming and attribution" section).

Type or voice note → Rosina reply, in one thread that also shows Rosina's questions and approval
requests — i.e., the thread is not just a messages table, it interleaves three kinds of server
truth (chat messages, coordination questions, approval requests) in time order. **Decided
(Bryan): no aggregate query in v1** — `chatThread` returns only genuine `ChatMessage` rows; the
client merges in `informationRequests` and job-approval items by timestamp itself, the same
client-side-composition pattern as every other surface in this contract.

### Queries / mutations

| Operation | Status | Cites |
| --- | --- | --- |
| `chatThread(childId: ID!): [ChatMessage!]!` | **NEW** | no message/thread type exists anywhere in `schema/*.graphql` today |
| `sendParentMessage(childId: ID!, text: String, voiceNoteUrl: String): ChatMessage!` | **NEW** | same — no chat mutation exists |
| `informationRequests(childId: ID!): [InformationRequest!]!` | EXISTING | `schema/coordination.graphql` `Query.informationRequests` — Rosina's questions, rendered inline in the thread by `at`-ish ordering (the type has no timestamp yet — see Requested changes) |
| `coordinationJobs(childId: ID): [CoordinationJob!]!` | EXISTING | `schema/coordination.graphql` `Query.coordinationJobs` — read to show the thread's "can you approve this pickup?" banner when a job the parent is the named approver for (`pickup-job.md` §6) reaches `awaiting_approval` |

`ChatMessage` (**NEW** type, proposed shape):

```graphql
enum ChatSender { PARENT ROSINA }
enum ChatMessageKind { TEXT VOICE_NOTE QUESTION APPROVAL_REQUEST }

type ChatMessage {
  id: ID!
  child: Child!
  from: ChatSender!
  kind: ChatMessageKind!
  text: String
  voiceNoteUrl: String
  at: String!
  relatedInformationRequestId: ID
  relatedJobId: ID
}
```

### Mock

`docs/mocks/parent-chat.json`

### Requested changes

1. A `ChatMessage` type and `chatThread` / `sendParentMessage` operations — there is no chat
   persistence anywhere in the graph today; this is new surface, not a gap in an existing one.
2. `InformationRequest` has no `at`/timestamp field (`schema/coordination.graphql`) — needed to
   interleave questions correctly into a time-ordered thread.
3. **Decided (Bryan): voice notes live in a private Supabase Storage bucket with signed URLs,
   priority P1** (not day-one blocking, but committed). `ChatMessage.voiceNoteUrl` resolves to a
   time-limited signed URL, never a public bucket path — exact expiry/retention is still open
   (§8).

## 3. Surface: Living Village (Obsidian Person Network style, `react-force-graph-2d`)

### Queries / mutations

| Operation | Status | Cites |
| --- | --- | --- |
| `village(id: ID!): Village` | EXISTING | `schema/village.graphql` `Query.village` |
| `householdMembers(childId: ID!): [HouseholdMember!]!` | EXISTING | `schema/village.graphql` `Query.householdMembers` |
| `relationships(childId: ID!): [Relationship!]!` | EXISTING | `schema/village.graphql` `Query.relationships` — edge type + status (`RelationshipStatus`) drives edge styling |
| `groups: [Group!]!` / `memberships(groupId: ID): [Membership!]!` | EXISTING | `schema/village.graphql` |
| `approveRelationship(relationshipId: ID!): Relationship` | EXISTING | `schema/village.graphql` `Mutation.approveRelationship` — used when a node's relationship needs promoting from the graph view itself |

**Decided (Bryan): no aggregate queries in v1.** The `villageGraph` convenience aggregate
proposed in the previous draft is **not building** for v1 — the client composes the four EXISTING
queries above (`village`, `householdMembers`, `relationships`, `groups`/`memberships`) itself and
assembles the force-graph's nodes/edges in the browser. The `docs/mocks/living-village.json` mock
still shows the shape of the assembled result for frontend reference, labelled accordingly.

### Mock

`docs/mocks/living-village.json` (illustrates the client-assembled shape, not a server aggregate)

## 4. Surface: Geographic Map (`react-map-gl` + MapLibre)

Supplied coordinates vs. estimates vs. verified locations — the map must visually distinguish all
three, never presenting an estimate as a fact. **This surface now consumes the canonical location
model defined once in `docs/contracts/pickup-job.md` §6** — `Location`/`LocationSource` are no
longer defined separately here; the same types also power outreach prioritization and the
ride-cost policy (`pickup-job.md` §5a/§6a) and the recommendation route mini-map, so there is one
source of truth instead of three.

### Queries / mutations

| Operation | Status | Cites |
| --- | --- | --- |
| `pickupRoute(childId: ID!, jobId: ID): PickupRoute!` | **NEW** | `pickup-job.md` §6 — the canonical `PickupRoute`/`CandidateRouteLeg` shape, reused as-is for this surface rather than a map-specific type |
| `householdMembers(childId: ID!)` / `households(childId: ID!)` | EXISTING | `schema/village.graphql` — identifies **whose** locations to ask for |

`Location`, `PickupRoute`, `CandidateRouteLeg` — see `pickup-job.md` §6 for the full shape. All
**NEW**, owned by the `village` subgraph, gated behind `address.read`, enforced **before** any
coordinate or address is returned.

### Live tracking (future capability, not Station 06)

After an approval, the UI **may** animate a caregiver along the proposed route — **Option B for
this hackathon**: a separate, explicitly **NEW** `SimulatedTrackingState` type
(`{ job: CoordinationJob!, progress: Float!, currentPoint: Location!, startedAt: String!, label:
String! }`), driven by client-side or server-side simulation, **never** the verified-location
field. It must be visibly labelled **SIMULATED** everywhere it renders, including in any recorded
demo video — it never implies verified GPS, arrival, or a completed pickup (`pickup-job.md` §2's
`PickupCompletion` fact is separate and not built this milestone either). Real opted-in GPS
tracking (consent capture, device update cadence, expiry, access control, revocation) is a
**future capability** — explicitly out of scope for Station 06, noted here only so nobody builds
toward it by accident.

### Mock

`docs/mocks/geographic-map.json`

### Requested changes

1. `pickupRoute` and the canonical location model itself — genuinely new domain data company-wide,
   not map-specific; tracked once in `pickup-job.md` §6/§14 rather than duplicated here.
2. Mapbox token: `frontend.md` §3 already names `VITE_MAPBOX_TOKEN` as optional publishable-only;
   MapLibre remains default per that contract, unchanged here.

## 5. Surface: Rosina Mission Control

Recorded tool calls, responses, approvals, state transitions. Acknowledge instantly, show
progress, then verified results — i.e., three-stage rendering per event, not a flat log. This
section now mirrors `docs/contracts/pickup-job.md`'s reworked parallel-discovery /
accept-then-approve model (states: `pending → discovering → awaiting_approval → confirmed` /
`failed`).

### Over-limit alternative (NEW — Station 06)

When no candidate is inside the household travel-cost threshold, the job does **not** fail and does
**not** present a policy-compliant recommendation. It carries the best over-limit candidate instead.

| Field | Type | Meaning |
| --- | --- | --- |
| `CoordinationJob.overLimitCandidate` | `Person` (nullable) | the no-transport caregiver whose paid-ride estimate exceeds the household limit — surfaced for explicit review. That candidate keeps `reasonCode: OVER_POLICY` and is **never** `APPROVAL_PENDING` |
| `Confirmation.overLimitApproved` | `Boolean` | true only when the approver explicitly accepted an over-limit option |

- Label: **"Ride estimate over your limit"**. Never "fare", "Uber", "spend".
- The candidate's `estimatedRideCostUsd` and `costBasis` are shown verbatim; the figure is a
  synthetic planning estimate, not a charge.
- **Approving an over-limit candidate is a separate, explicit action.** The mutation must send
  `acceptOverLimit: true`; without it the backend refuses with `OVER_LIMIT_NOT_ACCEPTED` and no
  confirmation is written. There is no single-tap path from "review" to "approved".
- `overLimitCandidate` and `APPROVAL_PENDING` are mutually exclusive: a job has at most one, never
  both. Nothing in this flow books a ride, spends money, or raises the threshold.

### Queries / mutations

| Operation | Status | Cites |
| --- | --- | --- |
| `coordinationJobs(childId: ID): [CoordinationJob!]!` | EXISTING | `schema/coordination.graphql` `Query.coordinationJobs` |
| `attempts(jobId: ID): [Attempt!]!` | EXISTING, **+ NEW fields** | `schema/coordination.graphql` `Query.attempts` — `pickup-job.md` §5/§7 adds NEW `candidate: Person!`, `destinationMode: DestinationMode!` to the existing `Attempt` type |
| `candidateEvaluations(jobId: ID!): [CandidateEvaluation!]!` | **NEW** | the per-candidate reason-code record (`PENDING` / `UNAUTHORIZED` / `NO_VERIFIED_CONTACT_METHOD` / `UNREACHABLE` / `UNAVAILABLE` / `AVAILABLE_NO_TRANSPORT` / `OVER_POLICY` / `RECOMMENDED` / `APPROVAL_PENDING`, plus `acceptedVia: AcceptanceEntryPoint` and the ride-cost fields) — `pickup-job.md` §5/§6a/§8, no such type exists today. **`PENDING` is a workflow state** (outreach sent, no reply yet; `available` is null) and is not `APPROVAL_PENDING` |
| `confirmations(childId: ID): [Confirmation!]!` | EXISTING, **+ NEW fields** | `schema/coordination.graphql` — `pickup-job.md` §7 adds NEW `candidate: Person!`, `approvedBy: Person!` |
| `requestPickup(childId: ID!, asOf: String, window: String)` | **NEW** | `window` optional, defaults to `'afternoon'`; part of the idempotency key, so two windows are two jobs |
| `acceptPickup` / `approvePickup` | **NEW** | `pickup-job.md` §8 — `schema/coordination.graphql` has **no `Mutation` type at all** today; Mission Control cannot do anything beyond read-only playback until these ship |

**Decided (Bryan): no aggregate query in v1.** The previous draft's `missionControlFeed`
aggregate and its `MissionControlStage` enum are **not building**. The
`ACKNOWLEDGED → IN_PROGRESS → VERIFIED` three-stage read is computed **client-side** from the
primitive reads above: `ACKNOWLEDGED` the moment `coordinationJobs` shows the job exists,
`IN_PROGRESS` while any `candidateEvaluations` row is still unresolved, `VERIFIED` only once
`confirmations` has a row for that job — never from the model's own words, same rule as
`pickup-job.md` §2.

### Mock

`docs/mocks/mission-control.json` (illustrates the client-computed shape, not a server aggregate)

### Requested changes

1. The coordination mutations and the `CandidateEvaluation` type themselves
   (`requestPickup`/`acceptPickup`/`approvePickup`, reason codes) — this is the Milestone 3
   implementation gap described fully in `pickup-job.md`, not a Mission Control–specific ask, but
   Mission Control is the surface that makes the gap visible.

## 6. Surface: Family Calendar + outcomes

### Queries / mutations

| Operation | Status | Cites |
| --- | --- | --- |
| `events(childId: ID!, date: String!): [Event!]!` | EXISTING | `schema/schedule.graphql` |
| `practices(childId: ID!, date: String!): [Practice!]!` | EXISTING | `schema/activities.graphql` |
| `groupEvents(groupId: ID!): [GroupEvent!]!` | EXISTING | `schema/activities.graphql` |
| `schoolReports(childId: ID!): [SchoolReport!]!` | EXISTING | `schema/school.graphql` |
| `permissionSlips(childId: ID!): [PermissionSlip!]!` | EXISTING | `schema/school.graphql` |
| `busRoster(childId: ID!, date: String!): BusRoster` | EXISTING | `schema/transport.graphql` |
| `coordinationJobs(childId: ID): [CoordinationJob!]!` | EXISTING | `schema/coordination.graphql` — the "outcomes" half: did the pickup actually get confirmed for that day |

**Decided (Bryan): no aggregate query in v1.** The previous draft's `calendarDay` aggregate is
**not building**. The client composes the seven EXISTING queries above itself for one day's view.

### Mock

`docs/mocks/family-calendar.json` (illustrates the client-assembled shape, not a server aggregate)

## 7. PROPOSED — `web/` folder split

Against the real scaffold layout on `setup/web-scaffold`
(`git ls-tree -r --name-only setup/web-scaffold web/`: `src/App.tsx`, `src/main.tsx`,
`src/index.css`, `src/assets/`, plus the misplaced `@/components/ui/button.tsx` and `@/lib/utils.ts`
that `frontend.md` §5.1 already flags as needing a move to `src/`).

```
web/src/
  app/                    # Codex — app shell: router, providers, ApolloClient + Supabase client init
  lib/                    # Codex — data layer: apolloClient.ts, supabaseClient.ts, generated ops
  components/ui/          # shared shadcn primitives (post-move from web/@/components/ui)
  features/
    chat/                 # Codex — parent chat surface (§2)
    mission-control/      # Codex — Mission Control surface (§5)
    calendar/             # Codex — Family Calendar surface (§6)
    village/              # Hermes — Living Village surface (§3)
    map/                  # Hermes — Geographic Map surface (§4)
  pages/
    landing/              # Hermes — landing page + ambient polish (Vanta/Lenis/GSAP per frontend.md §1)
```

**Codex owns:** parent chat, Mission Control, Calendar, the data layer (`lib/`), the app shell
(`app/`).
**Hermes owns:** Living Village, Geographic Map, the landing page, general visual polish.

This is a proposal for how to split Milestone 3 frontend work across two agents without them
editing the same files — it is not a statement that either agent has started. `components/ui/` is
shared by construction (shadcn primitives both sides style against) and is nobody's exclusive
layer; a change there touching another surface's visual identity should say so in the PR.

## 8. Open questions for Bryan

Resolved from the previous draft (recorded in place above, not repeated here): Realtime vs.
polling (§1.3 — polling, 2–3s for Mission Control), `Location`/`LocationSource` ownership (§4 —
`village`, behind `address.read`), whether the four aggregate convenience queries ship in v1 (§3,
§5, §6 — no, client composes primitives), and voice note storage (§2 — private Supabase Storage
bucket, signed URLs, P1).

Still genuinely open:

1. **Signed URL expiry/retention for voice notes** (§2) — "P1, private bucket, signed URLs" is
   decided; how long a signed URL stays valid and how long a voice note is retained is not.
2. **`address.read` has no grant rows yet** (§4) — the scope name and owning subgraph are decided,
   but nobody in `src/fixtures.ts` holds it, so `pickupRoute` is `UNAUTHORIZED` for everyone until
   seed data is added. That's an implementation gap to track, not a contract question, but it
   blocks the Geographic Map surface from returning anything until it's resolved.
3. **`SimulatedTrackingState`'s actual driver** (§4) — whether the route animation is computed
   client-side (interpolating along `CandidateRouteLeg`) or server-pushed via polling is not
   decided; either way it stays a separate type from `Location`, per `pickup-job.md` §6/§9.
