FridgeGraph: one shared, permission-aware graph for a child's whole village.

Built for the Meta Global AI Developer Hackathon. Work in progress — only Milestone 1 exists.

## What this is

Seven federated subgraphs behind one Apollo Router, sharing one in-memory store, with
field-level authorization enforced inside the subgraphs. A parent sees everything about their
child; a grandparent with `pickup.request` sees pickups, not the medical file; someone with
`schedule.read` sees the calendar and not who is cleared to collect the child.

Fictional data only. Every person is invented, phone numbers are in the reserved `+1-555-01xx`
range, emails are `@example.com`, plates are `DEMO-###`.

## Ports

| Service | Port |
| --- | --- |
| village | 4001 |
| access | 4002 |
| coordination | 4003 |
| schedule | 4004 |
| school | 4005 |
| transport | 4006 |
| activities | 4007 |
| Router (supergraph) | 4010 |
| Router health | 8090 |
| MCP server (spike) | 5050 |

## Run it

```bash
npm install
npm start                      # all seven subgraphs in one Node process

# in a second terminal
export PATH="$HOME/.rover/bin:$PATH"
APOLLO_ELV2_LICENSE=accept rover dev \
  --supergraph-config supergraph.yaml \
  --router-config router.yaml \
  --router-version 2.18.0 \
  --mcp .apollo/mcp.local.yaml      # omit --mcp to skip the MCP server
```

Then query `http://127.0.0.1:4010/` with the two demo headers:

```bash
curl -s http://127.0.0.1:4010/ \
  -H 'content-type: application/json' \
  -H 'x-demo-user: p_mom' \
  -H 'x-demo-date: 2026-10-26' \
  -d '{"query":"{ pickupCandidates(childId: \"p_nora\", asOf: \"2026-10-26\") { person { displayName } reason } }"}'
```

```bash
npm run reset        # restore the in-memory store to the fixtures
node ops/run-evidence.mjs   # re-run the whole evidence suite against the router
node ops/mcp-probe.mjs      # MCP handshake + tool list + tool call
```

## SECURITY — the demo headers are not authentication

`x-demo-user` and `x-demo-date` are **INSECURE development inputs**. Anyone who can reach the
router can claim to be any person. Authorization *logic* is real and enforced per resolver;
caller *identity* is not verified yet. This must be replaced with a validated JWT (Milestone 3)
before anything leaves this laptop. The same applies to the pinned `headers:` block in
`.apollo/mcp.local.yaml` — it hard-codes one caller for every MCP request.

## Layout

```
src/fixtures.ts        fictional village: everyone, everything they offer, everything granted
src/store.ts           one in-memory store, reset, approval recording
src/authz.ts           field-level rules + the INSECURE header warning
src/derive.ts          who can pick up / supervise; approver for a date; ages computed
src/context.ts         builds caller + "now" from headers
src/server.ts          one subgraph on one port (+ POST /__reset control endpoint)
src/main.ts            starts all seven
src/subgraphs/*.ts     village, access, coordination, schedule, school, transport, activities
supergraph.yaml        rover dev composition config (introspection of running subgraphs)
router.yaml            Router 2.x config: header propagation, introspection, health port
ops/*.graphql          predefined operation(s) → MCP tools
docs/schema-plan.md    ownership, scopes, enums
docs/questions.md      open questions and deviations (read this)
docs/spike-notes.md    MCP spike: versions, what worked, gotchas
docs/evidence/         every checkpoint: query + raw response
```

## Milestone 1 status

| Checkpoint | Result |
| --- | --- |
| Seven subgraphs compose | pass |
| Kendra: full view of Nora (schedule, candidates, contacts, vehicles, approver) | pass |
| approverFor Thu Oct 29 → Andre, Kendra FYI | pass |
| Supervision age boundary (Leo 15 → 16) | pass |
| Scope leaks denied (Loretta, Gary, Dana, Loretta-on-Jax) | pass |
| Time-boxed grant (Daniel, Oct 26 only) | pass |
| Candidate visibility (Walter/Gloria empty, Angela vehicles) | pass |
| Mutations write Approval rows, reset restores | pass |
| Item 9 (Ray denied / Evelyn allowed) | **contradicts the access rules — see docs/questions.md #10** |
| MCP: one tool, introspection off | pass |
