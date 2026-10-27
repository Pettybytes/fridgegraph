# Apollo MCP Server spike notes

**Doc URLs (read Oct 26, 2026):**
- https://www.apollographql.com/docs/apollo-mcp-server
- https://www.apollographql.com/docs/apollo-mcp-server/quickstart
- https://www.apollographql.com/docs/apollo-mcp-server/config-file

**Versions actually running**

| Component | Version | How installed |
| --- | --- | --- |
| Node | v22.22.3 | pre-existing |
| npm | 12.0.2 | pre-installed (no pnpm on this machine) |
| Rover | 1.0.1 | `curl -sSL https://rover.apollo.dev/nix/latest \| sh` (official docs) |
| Apollo Router | 2.18.0 | `rover dev --router-version 2.18.0` |
| Federation composition | 2.9.0 | `supergraph.yaml` → `supergraph` plugin 2.9.0 |
| Apollo MCP Server | 2.1.0 | `rover dev --mcp` (auto-installed `apollo-mcp-server-v2.1.0`) |
| @apollo/server | 4.13.0 | npm |
| @apollo/subgraph | 2.15.1 | npm |

**What worked**

1. `rover dev --supergraph-config supergraph.yaml --router-config router.yaml --router-version 2.18.0 --mcp .apollo/mcp.local.yaml`
   started both the router (4010) and the MCP server (5050) from one command.
2. `tools/list` returned exactly one tool, built from the single operation file in `ops/`.
   The tool description came from the GraphQL comment above the operation.
3. `tools/call PickupCandidates` returned live data resolved across three subgraphs.
4. Introspection off works: with `introspection.introspect/execute/search/validate` disabled,
   `tools/call introspect` fails with JSON-RPC `-32602 Tool introspect not found`.

**Gotchas worth remembering**

- `rover dev` accepts only a precise router version. `--router-version 2.x` fails with
  `unexpected character 'x' while parsing minor version number`. Pin an exact version.
- `pkill -f "rover dev"` does **not** kill the router child binary. An orphaned `router-v2`
  keeps holding the port and the next `rover dev` dies with `Address already in use`.
  Kill the PID that owns the port.
- The router's health check defaults to `127.0.0.1:8088`; a second local router collides there
  before it collides on the GraphQL port. `router.yaml` now sets `health_check.listen: 8090`.
- Router 2.18 warns that `headers.all.request` must be wrapped in an `operations:` key. The new
  form is used in `router.yaml`; the old form still works but is rewritten automatically.
- The MCP server config file is watched; editing it restarts the server in place.
- Static `headers:` in the MCP config are the spike's stand-in for auth. They pin one caller for
  every request — fine for a local demo, unacceptable anywhere else. Milestone 2 replaces this
  with a validated JWT and per-request identity.
