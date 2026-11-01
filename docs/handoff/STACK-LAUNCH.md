# Stack launch procedure — exact environment per service

Written after two refresh failures that each cost a live window:

1. **Rosina came up against a dead MCP** because it reads `ROSINA_MCP_URL`, and `MCP_URL` is silently
   ignored (`src/rosina/server.ts:25`, default `http://127.0.0.1:5050/mcp` — a port nothing serves).
2. **The demo-login listener never started** because `startDemoLogin()` returns early unless
   `DEMO_LOGIN_ENABLED=1` (`src/demo/server.ts:431`), so the picker answered 502 to every login.

Both are environment mistakes, not code faults, so they are fixed here by stating the environment and
proving it with a check that goes through the browser's own path.

## Services and their environment

| Service | Port(s) | Command | Environment that must be set |
|---|---|---|---|
| Subgraphs | 4001–4007 | `npx tsx src/main.ts` | — |
| Demo login / Orbit bridge | **4008** | same process (`src/main.ts`), or the dedicated `startDemoLogin()` entry | **`DEMO_LOGIN_ENABLED=1`**, **`DEMO_LOGIN_PORT=4008`** (default 4008, but state it) |
| Alt subgraphs | 4101–4107 | `DEMO_CLOCK=1 npx tsx ops/stack-alt.mjs` | `DEMO_CLOCK=1` for the test clock |
| Router (alt) | 4012 | `router-v2.18.0 --supergraph supergraph.graphql --config <alt-router.yaml>` | config generated from `router.yaml` (licence-free variant) |
| Router (licensed) | 4010 | `router-v2.18.0 --supergraph supergraph.graphql --config router.yaml` | `APOLLO_KEY` from `.env` |
| **Rosina** | 4200 | `npx tsx src/rosina/server.ts` | **`ROSINA_PORT=4200`**, **`ROSINA_MCP_URL=http://127.0.0.1:5051/mcp`**, `ROSINA_PROVIDER=meta` |
| MCP | 5051 | `apollo-mcp-server-v2.1.0 <mcp.yaml>` | config generated from `.apollo/mcp.local.yaml` with port rebased 5050→5051 |

**`MCP_URL` is NOT read by Rosina.** Setting it produces a process that starts happily, logs
`mcp=http://127.0.0.1:5050/mcp`, and fails every model turn. The startup line is the tell: it must say
`mcp=http://127.0.0.1:5051/mcp`.

## Measured running stack (2026-10-31 23:00Z)

Checked with `ps -o command=` / `ps -E` per PID — not copied from the table above. Note that the
demo-login listener is a **separate process** here, so `src/main.ts` itself carries no demo-login env.

| PID | Ports | Command (as run) | Env observed on the process |
|---|---|---|---|
| 94204 | 4001–4007 | `node --require tsx src/main.ts` | (none of the below) |
| **24552** | **4008** | `node --import tsx .runs/demo-login-entry.mjs` | `DEMO_LOGIN_ENABLED=1`, `DEMO_LOGIN_PORT=4008` |
| 94438 | 4101–4107 | `node --require tsx ops/stack-alt.mjs` | `DEMO_CLOCK=1` |
| 95097 | 4010 / 8090 | `router-v2.18.0 --supergraph supergraph.graphql --config router.yaml` | `APOLLO_KEY` (set, not printed) |
| 94477 | 4012 / 8092 | `router-v2.18.0 --supergraph supergraph.graphql --config /Users/user/.openclaw/tmp/fridgegraph-alt-router.yaml` | — |
| **38059** | 4200 | `node --require tsx src/rosina/server.ts` | **`ROSINA_MCP_URL=http://127.0.0.1:5051/mcp`**, `ROSINA_PORT=4200` |
| 94479 | 5051 | `apollo-mcp-server-v2.1.0 /tmp/refresh-mcp.yaml` | — |

All from checkout `fridgegraph-refresh` at **`e56434d`**. The MCP config is a hand-rebased copy of
`.apollo/mcp.local.yaml` (endpoint 4010→4012, port 5050→5051) because `ops/alt-stack.sh --up` cannot
generate it.

## Supergraph

Compose locally; publishing is a separate, deliberate act:

```bash
rover supergraph compose --config supergraph.yaml --output supergraph.graphql
```

Both routers must run this file. After a schema change, a stale supergraph serves the old schema
silently — check that a newly added mutation appears on **both** 4010 and 4012.

## Health check — through the browser proxy, not the raw port

`node ops/stack-health.mjs` (uses the dev server's proxy on 5189, exactly as the UI does):

- `/api/demo/health` answers **200** with `localOnly: true`;
- picker login for **`kendra`** (public persona id, never `p_mom`) returns **`status="READY"`** with a
  session present;
- an authenticated `myChildren` through `/graphql` returns a non-empty list;
- 4008 and 5051 are listening, and **Rosina's process environment actually points at 5051**.

It reads no token values and prints counts and booleans only.

## Known broken tooling

`ops/alt-stack.sh --up` aborts with *"could not rebase mcp.local.yaml ports; its shape changed"* — its
own header says `--up`/`--down` were untested. Until that is fixed, start the pieces as listed above
and rebase the MCP config by hand (endpoint → 4012, port → 5051).
