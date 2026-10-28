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
- Per `docs/auth-plan.md` §"Accepted decisions": router-level JWT is **not active today**
  (licence-gated). The router must still be configured to propagate `Authorization` to every
  subgraph unchanged; each subgraph verifies the token itself (ES256, `jose`, `sub` →
  `personId` via the server-side identity map). The frontend does not need to know which layer
  verifies — it only needs to always send the token and handle `UNAUTHENTICATED` /
  `UNAUTHORIZED` distinctly (§1.3).
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

### 1.3 Live updates: polling, not Realtime, for v1 — with one reason

**Recommendation: Apollo Client `pollInterval`, not Supabase Realtime, for every surface below.**

Reason: **no subgraph defines a `Subscription` type today** (verified:
`grep -rl "type Subscription" schema/` returns nothing). Supabase Realtime would mean the browser
reads raw Postgres tables directly, under RLS, bypassing the per-resolver field-level
authorization that `data-model.md` §4 calls "the real boundary." That is a bigger decision than a
frontend contract should make unilaterally — it is called out in §7 Open questions, not decided
here. Polling against the existing/NEW GraphQL queries below reuses the exact same scope checks
the rest of the graph already enforces, at the cost of latency (poll interval, not push).

Suggested intervals, tightened per surface where noted below: 5s for Mission Control and the chat
thread (most latency-sensitive), 30s for the Living Village graph and the calendar, no polling for
the map (coordinates change rarely in this milestone).

### 1.4 Simulated / test-fixture labels

Milestone 3 contacts **no real person** (`pickup-job.md` §7). Any UI surfacing an `Attempt`,
`Confirmation`, or chat message that rode on a test-labelled destination must render a visible
"Simulated" badge — never let a demo screen look like a real call happened.

- **NEW** field request: `Attempt.simulated: Boolean!` and `Confirmation.simulated: Boolean!`
  (coordination subgraph), set `true` whenever the underlying destination/channel is a
  test-responder fixture. Today that fact only exists as a naming convention
  (`destinationLabel` in `docs/contracts/webhook.md` §5); promoting it to a real field is what
  lets every surface badge it the same way without re-deriving the convention client-side.

## 2. Surface: Parent chat (Kendra's phone)

Type or voice note → Muse reply, in one thread that also shows Muse's questions and approval
requests — i.e., the thread is not just a messages table, it interleaves three existing kinds of
server truth (chat messages, coordination questions, approval requests) in time order.

### Queries / mutations

| Operation | Status | Cites |
| --- | --- | --- |
| `chatThread(childId: ID!): [ChatMessage!]!` | **NEW** | no message/thread type exists anywhere in `schema/*.graphql` today |
| `sendParentMessage(childId: ID!, text: String, voiceNoteUrl: String): ChatMessage!` | **NEW** | same — no chat mutation exists |
| `informationRequests(childId: ID!): [InformationRequest!]!` | EXISTING | `schema/coordination.graphql` `Query.informationRequests` — Muse's questions, rendered inline in the thread by `at`-ish ordering (the type has no timestamp yet — see Requested changes) |
| `coordinationJobs(childId: ID): [CoordinationJob!]!` | EXISTING | `schema/coordination.graphql` `Query.coordinationJobs` — read to show the thread "Kendra, can you confirm pickup?" banner when a job the parent is relevant to is `awaiting_parent` |

`ChatMessage` (**NEW** type, proposed shape):

```graphql
enum ChatSender { PARENT MUSE }
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
3. Voice notes need a storage answer (Supabase Storage bucket, URL shape) — not decided here.

## 3. Surface: Living Village (Obsidian Person Network style, `react-force-graph-2d`)

### Queries / mutations

| Operation | Status | Cites |
| --- | --- | --- |
| `village(id: ID!): Village` | EXISTING | `schema/village.graphql` `Query.village` |
| `householdMembers(childId: ID!): [HouseholdMember!]!` | EXISTING | `schema/village.graphql` `Query.householdMembers` |
| `relationships(childId: ID!): [Relationship!]!` | EXISTING | `schema/village.graphql` `Query.relationships` — edge type + status (`RelationshipStatus`) drives edge styling |
| `groups: [Group!]!` / `memberships(groupId: ID): [Membership!]!` | EXISTING | `schema/village.graphql` |
| `villageGraph(villageId: ID!): VillageGraph!` | **NEW** | convenience aggregate — see below |
| `approveRelationship(relationshipId: ID!): Relationship` | EXISTING | `schema/village.graphql` `Mutation.approveRelationship` — used when a node's relationship needs promoting from the graph view itself |

`VillageGraph` (**NEW**, proposed shape — purely a server-side join of the EXISTING queries above,
to avoid the client doing 1 + N round trips to build one force-graph render):

```graphql
type VillageGraph {
  nodes: [VillageNode!]!
  edges: [VillageEdge!]!
}
type VillageNode {
  person: Person!
  household: Household
  role: String
}
type VillageEdge {
  from: Person!
  to: Person!
  relationship: Relationship!
}
```

### Mock

`docs/mocks/living-village.json`

### Requested changes

1. `villageGraph(villageId)` — pure convenience; everything it returns is already EXISTING data.
   Could ship v1 without it (client composes the four EXISTING queries) if Bryan would rather not
   add a server aggregate yet.

## 4. Surface: Geographic Map (`react-map-gl` + MapLibre)

Supplied coordinates vs. estimates vs. verified locations — the map must visually distinguish all
three, never presenting an estimate as a fact.

### Queries / mutations

| Operation | Status | Cites |
| --- | --- | --- |
| `mapLocations(childId: ID!): [MapLocation!]!` | **NEW** | no geographic field exists in any subgraph today (`grep -rn "lat\|lng\|location" schema/*.graphql` finds nothing) |
| `householdMembers(childId: ID!)` / `households(childId: ID!)` | EXISTING | `schema/village.graphql` — identifies **whose** locations to ask for |

`MapLocation` / `Location` (**NEW**, proposed shape):

```graphql
enum LocationSource { SUPPLIED ESTIMATED VERIFIED }

type Location {
  lat: Float!
  lng: Float!
  source: LocationSource!
}

type MapLocation {
  person: Person!
  household: Household
  location: Location!
  label: String!
}
```

### Mock

`docs/mocks/geographic-map.json`

### Requested changes

1. `Location`/`LocationSource` is genuinely new domain data — nothing today models "where someone
   is," only "who they are related to." This needs a schema + migration decision (which subgraph
   owns it — likely `village`, since it is a `Person`/`Household` attribute, not school/transport
   specific), not just a frontend ask.
2. Mapbox token: `frontend.md` §3 already names `VITE_MAPBOX_TOKEN` as optional publishable-only;
   MapLibre remains default per that contract, unchanged here.

## 5. Surface: Muse Mission Control

Recorded tool calls, responses, approvals, state transitions. Acknowledge instantly, show
progress, then verified results — i.e., three-stage rendering per event, not a flat log.

### Queries / mutations

| Operation | Status | Cites |
| --- | --- | --- |
| `coordinationJobs(childId: ID): [CoordinationJob!]!` | EXISTING | `schema/coordination.graphql` `Query.coordinationJobs` |
| `attempts(jobId: ID): [Attempt!]!` | EXISTING | `schema/coordination.graphql` `Query.attempts` |
| `informationRequests(childId: ID): [InformationRequest!]!` | EXISTING | `schema/coordination.graphql` |
| `confirmations(childId: ID): [Confirmation!]!` | EXISTING | `schema/coordination.graphql` |
| `approvals(subjectId: ID): [Approval!]!` | EXISTING | `schema/access.graphql` `Query.approvals` |
| `missionControlFeed(childId: ID!): [MissionControlEvent!]!` | **NEW** | aggregate + the acknowledge/progress/verified tri-state — see below |
| any job-creating/attempt-recording mutation | **NEW** — **does not exist** | `schema/coordination.graphql` has **no `Mutation` type at all** today; Milestone 3 is "not implemented" per `docs/spec/milestone-3-pickup-job.md` line 3. Mission Control cannot do anything beyond read-only playback until this ships. |

`MissionControlEvent` (**NEW**, proposed shape):

```graphql
enum MissionControlStage { ACKNOWLEDGED IN_PROGRESS VERIFIED }

type MissionControlEvent {
  id: ID!
  job: CoordinationJob!
  stage: MissionControlStage!
  kind: String!   # "attempt" | "information_request" | "confirmation" | "approval"
  summary: String!
  at: String!
}
```

`stage` is the direct answer to "acknowledge instantly, show progress, then verified results":
`ACKNOWLEDGED` the moment the job records intent to act, `IN_PROGRESS` while an `Attempt` is
outstanding, `VERIFIED` only once backed by a `Confirmation` row — never by the model's own words,
same rule as `pickup-job.md` §2.

### Mock

`docs/mocks/mission-control.json`

### Requested changes

1. The coordination mutations themselves (create job with enforced idempotency, record attempt,
   record confirmation, transition state) — this is the Milestone 3 implementation gap, not a
   Mission Control–specific ask, but Mission Control is the surface that makes the gap visible.
2. `missionControlFeed` aggregate — convenience; v1 could instead compose the five EXISTING/NEW
   reads client-side and compute `stage` in the browser.

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
| `calendarDay(childId: ID!, date: String!): CalendarDay!` | **NEW** | aggregate of all of the above for one day — see below |

`CalendarDay` (**NEW**, proposed shape, pure aggregate of EXISTING + EXISTING data):

```graphql
type CalendarDay {
  date: String!
  child: Child!
  events: [Event!]!
  practices: [Practice!]!
  groupEvents: [GroupEvent!]!
  schoolReports: [SchoolReport!]!
  permissionSlips: [PermissionSlip!]!
  busRoster: BusRoster
  outcomes: [CoordinationJob!]!
}
```

### Mock

`docs/mocks/family-calendar.json`

### Requested changes

1. `calendarDay` — convenience only; v1 could compose the seven EXISTING queries client-side
   instead of adding a server aggregate. Flagged the same way as `villageGraph` and
   `missionControlFeed`: nice-to-have, not load-bearing.

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

1. **Realtime vs. polling, for real.** §1.3 recommends polling for v1 because no `Subscription`
   type exists. If Mission Control's "acknowledge instantly" requirement needs sub-second
   feedback that polling cannot give cheaply, the alternative is Supabase Realtime on raw tables
   — which means deciding whether the browser may read `coordination_jobs`/`attempts` directly
   under RLS, bypassing the subgraph's field-level authorization layer that `data-model.md` §4
   calls the real boundary. That trade-off is Bryan's call, not an implementation detail.
2. **Which subgraph owns `Location`/`LocationSource`?** Proposed as `village` (§4) since it reads
   as a `Person`/`Household` attribute, but it could just as easily be a new `location` subgraph if
   the data model wants geo kept separate from identity/relationship data.
3. **Do the four aggregate convenience queries (`villageGraph`, `missionControlFeed`,
   `calendarDay`, and implicitly a chat aggregate) get built at all for v1**, or does the frontend
   compose EXISTING/NEW primitive queries client-side and accept the extra round trips? Each
   "Requested changes" section above flags its aggregate as optional for exactly this reason.
4. **Voice note storage** for the parent chat surface (§2) — bucket, URL signing, retention — is
   unspecified; blocks `ChatMessage.voiceNoteUrl` from being more than a placeholder string.
