# FridgeGraph

**It takes a village to raise a child. FridgeGraph gives that village a way to work together.**

Families run on information that has no API, so parents become human routers.
School emails, soccer schedules, bus routes, pickup plans, allergy plans, two households raising the
same child, a grandmother who prefers a phone call and an uncle who only answers texts.
The information exists, but it lives everywhere, and when something changes a parent is left
connecting the dots, checking who's allowed to help, and calling around.

FridgeGraph turns that scattered village into one permission-aware graph, with **Muse**, the
village's coordinator (powered by Meta's Muse Spark), handling the logistics so parents can be present.

## The living village
- **Everyone has a place:** parents in two households, grandparents, aunts and uncles, siblings,
  sitters, teachers, the bus driver, the coach, and the parents of a child's friends.
- **Relationships aren't permissions.** Being Nora's coach lets Marcus post practice changes.
  It doesn't let him see her care plan or pick her up.
- **Parents set the rules, as data:** who may pick up, who may supervise and from what age,
  which parent approves on which day.
- **The village changes.** A new person joins when a parent approves the relationship, not when
  code changes. Birthdays change who's eligible on their own.

## What Muse will do
When Nora needs an early pickup, Muse will check who is authorized, ask each person on the channel
they prefer, wait for a real yes, move on when someone can't help, and only call the pickup confirmed
when the right parent has approved and the adult has accepted. When information is missing, Muse will
ask the person who knows instead of guessing. When a parent introduces someone new, Muse will propose
what they may do and wait for the parent's approval.

**The village grows. The graph evolves. Parents stay in control.**

## The architecture behind the village
Seven independently owned domains, composed into one Apollo supergraph:
- **village:** people, households, relationships, capabilities, care plans
- **access:** grants, delegations, approvals, household policies
- **coordination:** jobs, contact attempts, information requests, confirmations
- **schedule:** school days and family events
- **school:** reports and permission slips
- **transport:** bus rosters and vehicles
- **activities:** teams, practices and changes

Apollo MCP Server gives Muse a governed set of tools on that graph, running as the person who asked.
**Federation connects the information. Authorization establishes trust. Muse coordinates the action.**

## The bigger question
FridgeGraph starts with the logistics of raising a child, but it explores something larger: how AI
agents can coordinate across independently owned systems and human relationships while respecting
the authority people actually delegated.

## Status
**Working today**
- Seven Apollo Federation subgraphs, composed locally and registered in GraphOS (fridgegraph@dev)
- Field-level authorization in every subgraph, with regression evidence
- Runtime relationship activation and scoped, time-bound grants
- Supabase Auth sign-in for fictional demo identities; ES256 JWTs verified in every subgraph
- Server-side mapping from verified user IDs to village identities
- Apollo MCP Server forwarding the caller's token to the protected graph
- All services bound to localhost

**Router-level JWT: tested, not the default.** With the router connected to GraphOS it is licensed
and rejects bad tokens at the edge (evidence `15`). The unlicensed local router cannot enable it, and
even when it is on, a missing token is not stopped there — so verification also runs in every
subgraph.

**Coming this week:** Muse reasoning and tool use with Meta's Muse Spark · the pickup coordination job
with real calls and texts and labeled test responders · village data in Supabase · Add a Villager by
conversation · live screens and a village health dashboard · voice signing and check-ins.

*All people and data in this repo are fictional.*

## How it's built

### Install and run

```bash
npm install
npx tsx scripts/seed-auth-users.ts   # create the 13 demo auth users (idempotent)
DEMO_CLOCK=1 npm start                # 7 subgraphs in one process, 4001-4007
                                      # DEMO_CLOCK=1 lets tests pass x-demo-date as the clock;
                                      # without it the real local date is always used
```

```bash
# second terminal
export PATH="$HOME/.rover/bin:$PATH"
APOLLO_ELV2_LICENSE=accept rover dev \
  --supergraph-config supergraph.yaml \
  --router-config router.yaml \
  --router-version 2.18.0 \
  --mcp .apollo/mcp.local.yaml     # drop --mcp to run only the router

npm run reset                    # restore the in-memory store to the fixtures
node ops/run-evidence.mjs        # re-run the whole evidence suite against the router
node ops/mcp-probe.mjs           # MCP handshake, tools/list, tools/call
```

Query the router at `http://127.0.0.1:4010/`:

```bash
# get a token for one demo person (nothing else is printed)
TOKEN=$(node -e 'import("./ops/auth.mjs").then(m=>m.tokenForPersonId("p_mom")).then(console.log)')

curl -s http://127.0.0.1:4010/ \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $TOKEN" \
  -d '{"query":"{ pickupCandidates(childId: \"p_nora\", asOf: \"2026-10-26\") { person { displayName } reason } }"}'
```

### Security

Identity is a **verified Supabase JWT**. Every subgraph verifies the bearer token (ES256 only,
issuer `<project>/auth/v1`, audience `authenticated`, `exp` required) and resolves `sub` → person
through `data/identity-map.json` (gitignored, server-side, loaded at startup). Failures are
`UNAUTHENTICATED`; a verified caller who lacks the scope gets `UNAUTHORIZED`.

- **`x-demo-user` is gone.** `x-demo-date` survives only as a test clock, ignored unless the server
  runs with `DEMO_CLOCK=1`. No check in the suite requires that clock.
- **Router-level JWT is licence-gated, and now measured.** Unlicensed, the router refuses to start
  with `authentication.router` configured (through `rover dev` that appears only as
  `Failed healthcheck`). Connected to GraphOS with `APOLLO_KEY` + `APOLLO_GRAPH_REF`, the identical
  config starts as `UpdateLicense(Licensed)` and rejects malformed, `alg:none`, `HS256` and
  tampered tokens at the edge with `AUTH_ERROR` — while a *missing* token still passes the edge and is
  stopped downstream as `UNAUTHENTICATED`. Both layers are therefore real and complementary; the edge
  is an earlier rejection point, the subgraphs remain the boundary, because each subgraph port is
  independently reachable on localhost.
- **MCP forwards the caller's token; downstream subgraphs reject missing or invalid tokens. The MCP
  HTTP endpoint itself does not authenticate requests.**
- The service-role key is used only by `scripts/seed-auth-users.ts`, server-side, and never appears
  in a response, log, or committed file.
- Every service binds `127.0.0.1` only (`docs/evidence/13-localhost-binding.md`).

### Ports

| Service | Port | Bind |
| --- | --- | --- |
| village | 4001 | 127.0.0.1 |
| access | 4002 | 127.0.0.1 |
| coordination | 4003 | 127.0.0.1 |
| schedule | 4004 | 127.0.0.1 |
| school | 4005 | 127.0.0.1 |
| transport | 4006 | 127.0.0.1 |
| activities | 4007 | 127.0.0.1 |
| Router (supergraph) | 4010 | 127.0.0.1 |
| Router health | 8090 | 127.0.0.1 |
| MCP Server | 5050 | 127.0.0.1 |

### The seven subgraphs and what each owns

| Subgraph | Owns | Notes |
| --- | --- | --- |
| **village** | `Person`, `Child`, `Village`, `Household`, `HouseholdMember`, `Relationship`, `ContactMethod`, `Capability`, `Group`, `Membership`, `Goal`, `CarePlan` | The spine. Entities are keyed by `id`. |
| **access** | `Grant`, `Approval`, `HouseholdPolicy`, `ParentingSchedule` + the derived queries `pickupCandidates`, `supervisionCandidates`, `approverFor` | Answers "who is authorized"; holds no child data itself. |
| **coordination** | `CoordinationJob`, `Attempt`, `InformationRequest`, `Confirmation` | Schema only tonight; every resolver returns `[]`. |
| **schedule** | `Event` | Calendar entries. |
| **school** | `SchoolReport`, `PermissionSlip` | `school.read`. |
| **transport** | `BusRoster`, `Vehicle` + the entity field `Person.vehicles` | Only subgraph that extends someone else's entity. |
| **activities** | `Practice`, `GroupEvent` | Team practices and group announcements. |

Scope names (`schedule.read`, `transport.read`, `goals.read`, `careplan.read`, `school.read`,
`contacts.read`, `pickup.verify`, `pickup.request`, `supervise.request`) are strings in data, never
enums. Relationship types, capability names, group kinds and policy rules are strings too.
Full ownership + scope table: `docs/schema-plan.md`.

### GraphOS registration

Published to `fridgegraph@dev` on Oct 26, 2026 with `rover subgraph publish`, one subgraph at a
time; Studio composed Federation 2.15 LTS from them. Local development never needs GraphOS. Every
subgraph SDL declares `extend schema @link(url: "https://specs.apollo.dev/federation/v2.9",
import: ["@key"])` — see `docs/spike-notes.md` gotcha #3 for why that had to be added explicitly.

### Evidence index (`docs/evidence/`)

Run with `node ops/run-evidence.mjs`. **31 checks; outcomes are identical at `DEMO_CLOCK=0` and
`DEMO_CLOCK=1`.** No test requires the test clock — date-dependent behaviour is exercised through
explicit `asOf` / `date` arguments in `02`, `03`, `05c` and `11*`.

| File | Checkpoint |
| --- | --- |
| `01-kendra-full-view.md` | Parent view: child, schedule, practices, approver, candidates with contacts + vehicles |
| `01b-query-plan.md`, `01c-query-plan-full.md` | Router query plans (short probe, full evidence #1) |
| `02-approver-thursday.md` | `approverFor` Oct 29 → Andre, Kendra FYI |
| `03-supervision-age-boundary.md` | Leo excluded at 15, included at 16 — threshold from policy |
| `04-loretta-goals-careplan-contact.md` | Approved goal only; care plan and another adult's contact denied |
| `05a`/`05c` | Pickup list denied to a schedule-only grantee; empty list for an authorized caller (`05b` retired — `questions.md` #14) |
| `06a`/`06b`/`06c` | Care plan allowed while the window covers today; denied once it has closed; goals denied |
| `07a`/`07b`/`07c` | Bus driver: roster allowed, schedule and care plan denied |
| `08-angela-pickup-verify-vehicles.md` | `pickup.verify` sees candidate vehicles only |
| `09a`/`09b` | Ray (parent) full access to Jax's care plan; Evelyn without `careplan.read` denied |
| `10a`–`10d` | Cross-village denial for Dana; Loretta's grant does not reach Jax |
| `11a`–`11f2` | Mutations: blocked approval, approval, grant, two `Approval` rows, candidate appears, reset |
| `12-mcp-spike.md` | MCP: one tool, caller token forwarded, tokenless call fails closed |
| `13-localhost-binding.md` | `lsof` proof that all ten listeners are `127.0.0.1` |
| `14a`/`14b` | No token and a malformed token both return `UNAUTHENTICATED` |
| `15-graphos-jwt-router.md` | GraphOS-connected router: `UpdateLicense(Licensed)`, edge rejects bad tokens (`AUTH_ERROR`), missing token falls through to `UNAUTHENTICATED` |

### Milestone status

| Area | Result |
| --- | --- |
| Seven subgraphs compose | pass |
| Parent full view | pass |
| Parenting schedule → approver | pass |
| Sibling supervision age boundary | pass |
| Field-level scope denials (contacts, care plan, goals, schedule, transport) | pass |
| Time-boxed and expired grants | pass |
| Authorized-but-empty vs unauthorized | pass |
| Mutations write `Approval` rows; reset restores fixtures | pass |
| Localhost-only binding | pass |
| MCP: one tool, introspection off | pass |
| Verified Supabase JWT identity (13 demo users, `sub` → person via server-side map) | pass |
| `UNAUTHENTICATED` (unknown caller) vs `UNAUTHORIZED` (known, no scope) | pass |
| MCP forwards the caller's token; tokenless call fails closed | pass |
| Router-level JWT validation | **not active — licence-gated; see `docs/questions.md` #13** |

### Layout

```
src/fixtures.ts        fictional village: everyone, what they offer, what they were granted
src/store.ts           one in-memory store, reset, approval recording
src/authz.ts           field-level rules; UNAUTHENTICATED vs UNAUTHORIZED
src/auth/verify.ts     Supabase JWT verification (ES256, iss, aud) + sub → person map
src/context.ts         verified identity + local "today" (APP_TIME_ZONE)
src/derive.ts          candidates, approver-for-date, ages computed never stored
src/server.ts          one subgraph per port (+ POST /__reset)
src/main.ts            starts all seven
src/subgraphs/*.ts     the seven owners
scripts/seed-auth-users.ts   idempotent demo-user creation (Admin API)
supergraph.yaml        rover dev composition config
router.yaml            Router 2.x: header propagation, introspection, loopback listeners
ops/*.graphql          predefined operations → MCP tools
ops/auth.mjs           sign-in helpers; tokens in memory only
docs/schema-plan.md    ownership, scopes, enums
docs/apollo-notes.md   composition, query planning, runtime authorization, verified identity
docs/auth-plan.md      Milestone 2A decisions
docs/questions.md      open questions and deviations
docs/spike-notes.md    MCP spike: versions, what worked, gotchas
```

Provenance: everything here was written during this hackathon; see `PROVENANCE.md`.
