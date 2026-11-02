# Stack launch procedure — exact environment per service

Written after two refresh failures that each cost a live window:

0. **Rosina MUST carry `ROSINA_GRAPHQL_URL` (2026-11-02).** Without it, `GRAPHQL_URL` falls back to
`ROSINA_MCP_URL.replace(/\/mcp\/?$/, '/graphql')` — i.e. **5051/graphql**, not the router — and every
Notice→Plan prepare answers **502 NOTICE_ERROR (SCHEDULE_READ_FAILED)** because the authorized schedule
read fails closed. Point it at the router the demo/browser path uses (`http://127.0.0.1:4012/`).
`ops/stack-health.mjs` now refuses to call a stack healthy unless a prepare returns a proposal.

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
| **Rosina** | 4200 | `npx tsx src/rosina/server.ts` | **`ROSINA_PORT=4200`**, **`ROSINA_MCP_URL=http://127.0.0.1:5051/mcp`**, `ROSINA_PROVIDER=meta`; for notice-plan also **`ROSINA_PROPOSAL_SIGNING_KEY=<64-hex>`** and **`ROSINA_GRAPHQL_URL=http://127.0.0.1:4012/`** (the ROUTER) |
| MCP | 5051 | `apollo-mcp-server-v2.1.0 <mcp.yaml>` | config generated from `.apollo/mcp.local.yaml` with port rebased 5050→5051 |

**`MCP_URL` is NOT read by Rosina.** Setting it produces a process that starts happily, logs
`mcp=http://127.0.0.1:5050/mcp`, and fails every model turn. The startup line is the tell: it must say
`mcp=http://127.0.0.1:5051/mcp`.

**`ROSINA_GRAPHQL_URL` is REQUIRED when `ROSINA_PROPOSAL_SIGNING_KEY` is set (notice-plan on).** It is
the GraphQL **router** (4012), NOT the MCP URL — there is no default and no MCP-derived fallback. If it
is unset while the signing key is set, Rosina **exits at startup** (`[rosina] BLOCKED: ROSINA_GRAPHQL_URL
is required …`). The earlier deploy incident was exactly this: with it unset, the authorized schedule
read defaulted to `5051/graphql` (404) and every `POST /api/rosina/notice-plan` failed closed with 502.

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

All from checkout `fridgegraph-refresh` at **`e56434d`**. That run used a hand-rebased copy of
`.apollo/mcp.local.yaml` (endpoint 4010→4012, port 5050→5051) because `ops/alt-stack.sh --up` could
not generate one. **It can now** — see “Generating the alt-stack configs” below.

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

## Generating the alt-stack configs — `ops/alt-stack.sh` (fixed 2026-11-01)

`--up` is no longer broken. The abort was a one-character class of bug: its guard tested for the
string `":5051"`, but the file it wrote says `port: 5051` (with a space), so the guard failed on
every run **after** a successful rebase. The guard now tests the exact strings it writes, and it:

- rebases the endpoint (4010 → the alt router) and the transport port (5050 → the MCP port);
- rewrites **every** operation path to an absolute path (it used to rewrite only
  `PickupCandidates.graphql`, so the other ten depended on the caller's cwd);
- refuses to write a config whose schema or operation files do not exist, or when fewer than 11
  operations were rewritten — a missing operation file silently removes a tool.

`ops/alt-stack-check.mjs` now fails on a **missing or stale** config before it makes any call:
missing at the expected path; transport port ≠ the port being probed; endpoint not targeting the alt
router; the derived file older than `.apollo/mcp.local.yaml`; or any path it names that no longer
exists. It then runs its existing `PickupCandidates` check (4/4 as Kendra).

Ports and artefact names are overridable, which is how the whole thing was proven **without
stopping the shared stack**:

```bash
ALT_STACK_SUFFIX=-spare ALT_SUBGRAPH_BASE=4201 ALT_ROUTER_PORT=4022 \
  ALT_HEALTH_PORT=8093 ALT_MCP_PORT=5071 ops/alt-stack.sh --up     # then --check, then --down
```

Measured 2026-11-01 18:09Z on exactly that range: `router health OK`, `router graphql OK`,
`mcp config 12 path(s) present, port 5071 → router 4022`, `mcp candidates 4/4 as Kendra`,
`CHECK PASSED`; `--down` stopped only the three PIDs it had recorded; the shared stack on
4001–4007 / 4010 / 4012 / 5051 stayed `HEALTHY` throughout, demo cast unchanged. Do **not** pick
5060/5061 for the MCP port — Undici (and Chrome) treat them as blocked ports and `fetch` fails with
`bad port`.

`--gen` generates and validates both configs without starting anything, which is the cheap way to
test a config change.

## Known broken tooling

Nothing here is known-broken as of 2026-11-01. Previously: `ops/alt-stack.sh --up` aborted with *"could not rebase mcp.local.yaml ports; its shape changed"* — the guard bug described above. `--up`, `--check` and `--down` are now proven, so hand-rebasing the MCP config is no longer part of the procedure.
