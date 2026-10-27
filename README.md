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
npx tsx scripts/seed-auth-users.ts   # create the 13 demo auth users (idempotent)
DEMO_CLOCK=1 npm start                # 7 subgraphs in one process, 4001-4007
                                      # DEMO_CLOCK=1 lets tests pass x-demo-date as the clock;
                                      # without it the real local date is always used

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
  -H 'x-demo-date: 2026-10-26' \
  -d '{"query":"{ pickupCandidates(childId: \"p_nora\", asOf: \"2026-10-26\") { person { displayName } reason } }"}'
```

## SECURITY

Identity is a **verified Supabase JWT**, not a header. Every subgraph verifies the bearer token
(ES256 only, issuer `<project>/auth/v1`, audience `authenticated`, `exp` required) and resolves
`sub` → person through `data/identity-map.json` (gitignored, server-side, loaded at startup).
Failures are `UNAUTHENTICATED`; a verified caller who lacks the scope gets `UNAUTHORIZED`.

- **`x-demo-user` is gone.** `x-demo-date` survives only as a test clock, ignored unless the server
  runs with `DEMO_CLOCK=1`.
- **No router-level JWT validation** — `authentication.router` is licence-gated and an unlicensed
  router refuses to start (see `router.yaml` and `docs/questions.md` #13). Verification therefore
  lives in the subgraphs, which is also the stronger place: each subgraph port is independently
  reachable on localhost, so an edge-only check would be bypassable.
- The MCP server no longer pins an identity. It forwards the caller's `authorization` header
  (`forward_headers`), and a tokenless MCP call fails closed.
- The service-role key is used only by `scripts/seed-auth-users.ts`, server-side, and never appears
  in a response, log, or committed file.
- Every service still binds `127.0.0.1` only (`docs/evidence/13-localhost-binding.md`).

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
| `05a`/`05c` | Pickup list denied to a schedule-only grantee; empty list for an authorized caller (`05b` retired — see `questions.md` #14) |
| `06a`/`06b`/`06c` | Time-boxed grant: allowed Oct 26, denied Oct 27; goals denied |
| `07a`/`07b`/`07c` | Bus driver: roster allowed, schedule and care plan denied |
| `08-angela-pickup-verify-vehicles.md` | `pickup.verify` sees candidate vehicles only |
| `09a`/`09b` | Ray (parent) full access to Jax's care plan; Evelyn without `careplan.read` denied |
| `10a`–`10d` | Cross-village denial for Dana; Loretta's grant does not reach Jax |
| `11a`–`11f2` | Mutations: blocked approval, approval, grant, two `Approval` rows, candidate appears, reset |
| `12-mcp-spike.md` | MCP: one tool, caller token forwarded, tokenless call fails closed |
| `13-localhost-binding.md` | `lsof` proof that all ten listeners are `127.0.0.1` |
| `14a`/`14b` | No token and a malformed token both return `UNAUTHENTICATED` |

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
| Verified Supabase JWT identity (13 demo users, `sub` → person via server-side map) | pass |
| `UNAUTHENTICATED` (unknown caller) vs `UNAUTHORIZED` (known, no scope) | pass |
| Test clock honoured only under `DEMO_CLOCK=1` (checked both ways) | pass |
| MCP forwards the caller's token; tokenless call fails closed | pass |
| Router-level JWT validation | **blocked — licence-gated feature; see `questions.md` #13** |

Milestone 2A is done. Next: Supabase-backed store, then the Meta Model API. Nothing is published
to GraphOS from this repo's scripts beyond the seven subgraphs already in `fridgegraph@dev`.

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
