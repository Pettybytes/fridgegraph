# FridgeGraph

One shared, permission-aware graph for everything a child's week touches — family, school,
transport, activities — with exactly one place that answers "may this person see this?".
Built for the Meta Global AI Developer Hackathon; Milestone 1 only.

Fictional data only: invented people, phone numbers in the reserved `555-01xx` range under a
fictional `313` area code, `@example.com` emails, and `DEMO-###` licence plates.

> **Visibility:** this repository is **private** today and **goes public before the Nov 4, 2026
> submission.**

## Run it

```bash
npm install
npm start                    # all seven subgraphs in one Node process, 4001-4007

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
curl -s http://127.0.0.1:4010/ \
  -H 'content-type: application/json' \
  -H 'x-demo-user: p_mom' \
  -H 'x-demo-date: 2026-10-26' \
  -d '{"query":"{ pickupCandidates(childId: \"p_nora\", asOf: \"2026-10-26\") { person { displayName } reason } }"}'
```

## SECURITY

**`x-demo-user` / `x-demo-date` are insecure local test inputs; real JWTs arrive in Milestone 2.**
Anyone who can reach port 4010 can claim to be any person. The authorization *rules* are real and
enforced in every resolver; the caller's *identity* is not yet verified. Every service is bound to
`127.0.0.1` only (proof: `docs/evidence/13-localhost-binding.md`). The pinned `headers:` block in
`.apollo/mcp.local.yaml` is the same shortcut for MCP requests.

## Ports

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

## The seven subgraphs and what each owns

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

## Evidence index (`docs/evidence/`)

| File | Checkpoint |
| --- | --- |
| `01-kendra-full-view.md` | Parent view: child, schedule, practices, approver, candidates with contacts + vehicles |
| `01b-query-plan.md`, `01c-query-plan-full.md` | Router query plans (short probe, full evidence #1) |
| `02-approver-thursday.md` | `approverFor` Oct 29 → Andre, Kendra FYI |
| `03-supervision-age-boundary.md` | Leo excluded at 15, included at 16 — threshold from policy |
| `04-loretta-goals-careplan-contact.md` | Approved goal only; care plan and another adult's contact denied |
| `05a`/`05b`/`05c` | Pickup list denied to schedule-only grantees; empty list for an authorized caller |
| `06a`/`06b`/`06c` | Time-boxed grant: allowed Oct 26, denied Oct 27; goals denied |
| `07a`/`07b`/`07c` | Bus driver: roster allowed, schedule and care plan denied |
| `08-angela-pickup-verify-vehicles.md` | `pickup.verify` sees candidate vehicles only |
| `09a`/`09b` | Ray (parent) full access to Jax's care plan; Evelyn without `careplan.read` denied |
| `10a`–`10d` | Cross-village denial for Dana; Loretta's grant does not reach Jax |
| `11a`–`11f2` | Mutations: blocked approval, approval, grant, two `Approval` rows, candidate appears, reset |
| `12-mcp-spike.md` | MCP: one tool, live data, introspection tool absent |
| `13-localhost-binding.md` | `lsof` proof that all ten listeners are `127.0.0.1` |

## Milestone 1 status

| Area | Result |
| --- | --- |
| Seven subgraphs compose | pass |
| Parent full view | pass |
| Parenting schedule → approver | pass |
| Sibling supervision age boundary | pass |
| Field-level scope denials (contacts, care plan, goals, schedule, transport) | pass |
| Time-boxed grants | pass |
| Authorized-but-empty vs unauthorized | pass |
| Mutations write `Approval` rows; reset restores fixtures | pass |
| Localhost-only binding | pass |
| MCP: one tool, introspection off | pass |

Not started: Milestone 2 (real auth, Supabase, Meta Model API). Nothing is published to GraphOS
from this repo's scripts, and the local router still composes locally.

## Layout

```
src/fixtures.ts        fictional village: everyone, what they offer, what they were granted
src/store.ts           one in-memory store, reset, approval recording
src/authz.ts           field-level rules (+ the INSECURE header warning)
src/derive.ts          candidates, approver-for-date, ages computed never stored
src/context.ts         caller + "now" from headers
src/server.ts          one subgraph per port (+ POST /__reset)
src/main.ts            starts all seven
src/subgraphs/*.ts     the seven owners
supergraph.yaml        rover dev composition config
router.yaml            Router 2.x: header propagation, introspection, loopback listeners
ops/*.graphql          predefined operations → MCP tools
docs/schema-plan.md    ownership, scopes, enums
docs/apollo-notes.md   composition, query planning, runtime authorization
docs/questions.md      open questions and deviations (read this)
docs/spike-notes.md    MCP spike: versions, what worked, gotchas
```
