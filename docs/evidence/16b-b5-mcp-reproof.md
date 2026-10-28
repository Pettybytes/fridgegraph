# 16b — B5 re-proof: MCP `PickupCandidates` as Kendra through the full path

Re-proves the item AGENTS.md §8 records as **UNVERIFIED** (`MCP on 5050 as Kendra returning 4
pickup candidates`, last attempt blocked by `ROUTER_FREE_PLAN_RATE_LIMIT_REACHED`).

- Run: 2026-10-28 (local, America/Detroit)
- Worktree: `/Users/user/orca/workspaces/fridgegraph/muse-first-call`
- Branch: `feat/muse-first-call`, base commit `f810d40`
- Tool: `PickupCandidates` from `ops/PickupCandidates.graphql` (introspection off)
- Arguments: `{"childId":"p_nora","asOf":"2026-10-26"}`
- Caller: `p_mom` (Kendra Ellison, parent of Nora). Her own Supabase JWT is forwarded by
  `forward_headers: [authorization]`; nothing is pinned in the MCP config.
- Probe: `node ops/mcp-probe.mjs` — initialize → notifications/initialized → tools/list → tools/call
- `DEMO_CLOCK` is not required for this result: every grant involved has NULL `valid_from` /
  `valid_until`, so the candidate set does not depend on the test clock.

## Why the running subgraph layer was reused

A stack from the main checkout was already listening on 4001-4007 / 4010 / 5050 and was left
untouched. It was reused only after proving it runs the same bytes as this branch's base:

```
$ git diff --stat f810d40 2c48b72 -- src ops schema supabase router.yaml router.graphos.yaml .apollo supergraph.graphql
(no output)
```

This run's own router and MCP server were started **from the worktree** on isolated ports, so the
shared stack saw no traffic and no restart:

| Component | Port | Config |
| --- | --- | --- |
| Offline router (rollback config, no edge JWT) | 4012 (health 8092) | `router.yaml` equivalent, written outside the repo |
| MCP server v2.1.0 | 5051 | `.apollo/mcp.local.yaml` equivalent, absolute `schema.path` / `operations.paths` |

## 1. Offline router — full path

```
identity: p_mom Bearer eyJhbG…<redacted, 807 chars>

== tools/list ==
[ { "name": "PickupCandidates",
    "description": "Predefined operation for the Step 7 MCP spike: one tool, introspection disabled.",
    "inputSchema": { "type": "object",
                     "properties": { "childId": {"type":"string"},
                                     "asOf": {"anyOf":[{"type":"string"},{"type":"null"}]} },
                     "required": ["childId"] } } ]

== tools/call PickupCandidates ==
isError: false
```

Candidates (4):

| # | Person | Contact | Reason (verbatim from the tool) | Vehicles |
| --- | --- | --- | --- | --- |
| 1 | Loretta Brooks (`p_gma`) | CALL +1-313-555-0103 | grandmother — transport.child offered, pickup.request grant valid 2026-10-26 | `[]` |
| 2 | Bryan Brooks (`p_bryan`) | SMS +1-313-555-0104 | uncle — transport.child offered, pickup.request grant valid 2026-10-26 | `[]` |
| 3 | Tasha Ellison (`p_tasha`) | SMS +1-313-555-0107 | aunt + godmother — transport.child offered, pickup.request grant valid 2026-10-26 | `[]` |
| 4 | Monique Davis (`p_monique`) | SMS +1-313-555-0108 | parent_friend — transport.child offered, pickup.request grant valid 2026-10-26 | `[]` |

Negative control in the same transcript:

```
== tools/call introspect ==
{ "jsonrpc": "2.0", "id": 4,
  "error": { "code": -32602, "message": "Tool introspect not found" } }
```

## 2. GraphOS-connected router — one paced probe

Single `tools/call` against the GraphOS-connected router (`router.graphos.yaml`, licensed, edge
JWT on). No retry, no loop.

```
isError: false
Loretta Brooks, Bryan Brooks, Tasha Ellison, Monique Davis
```

No `ROUTER_FREE_PLAN_RATE_LIMIT_REACHED` was returned. The plan limit was not approached: this was
one request, and the two routers were probed sequentially rather than in a loop.

## 3. What this proves

- The MCP server executes the operation as **the caller**: the token travels MCP → router →
  subgraph → Postgres, and the subgraph's `verifyBearer` + RLS decide the result. Nothing is pinned.
- The candidate list is the same through both routers (4 people), so the edge-auth layer does not
  change the answer — it only rejects tokens earlier.
- Introspection stays off: `introspect` is not a tool.

## Notes / limits

- `person.vehicles` resolves `[]` for Kendra in this view. That is the current, pre-existing
  behaviour of the `vehicles` RLS policy (visibility is gated on `pickup.verify`, which Kendra does
  not hold as a grant — she is a parent). The committed baseline evidence `08` shows the same
  `[]`, so this run did not change it. The assertion here is the candidate list, not vehicles.
- Status of the previously-blocking rate limit: this run did not hit it. It is an account limit,
  not a code path, so it can still appear under heavier probing.
