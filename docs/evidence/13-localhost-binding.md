# Localhost-only binding (proof)

Checked 2026-10-27T00:58:26Z with `lsof -nP -iTCP -sTCP:LISTEN`, filtered to the FridgeGraph ports.

Config sources for each listener:

| Service | Port | Where the bind is set |
| --- | --- | --- |
| 7 subgraphs | 4001-4007 | `app.listen(port, '127.0.0.1')` in `src/server.ts` |
| Router | 4010 | `supergraph.listen: 127.0.0.1:4010` in `router.yaml` |
| Router health | 8090 | `health_check.listen: 127.0.0.1:8090` in `router.yaml` |
| MCP Server | 5050 | `transport.address: 127.0.0.1`, `transport.port: 5050` in `.apollo/mcp.local.yaml` |

## lsof output

```
COMMAND     PID USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
router-v2 31460 user   11u  IPv4 0x6ca00c1f7ed860f3      0t0  TCP 127.0.0.1:4010 (LISTEN)
router-v2 31460 user   12u  IPv4 0x9d8c5428470daa98      0t0  TCP 127.0.0.1:8090 (LISTEN)
apollo-mc 31464 user   11u  IPv4 0x45ee0bdf2da4c9e4      0t0  TCP 127.0.0.1:5050 (LISTEN)
node      39641 user   22u  IPv4 0xb2e8de3f3b7a4c21      0t0  TCP 127.0.0.1:4001 (LISTEN)
node      39641 user   23u  IPv4 0x77bc1dfee36fb049      0t0  TCP 127.0.0.1:4002 (LISTEN)
node      39641 user   24u  IPv4 0xd3b441caa15b67ae      0t0  TCP 127.0.0.1:4003 (LISTEN)
node      39641 user   25u  IPv4  0xbcc0642ddb728bc      0t0  TCP 127.0.0.1:4004 (LISTEN)
node      39641 user   26u  IPv4 0x2bbe5e3227599165      0t0  TCP 127.0.0.1:4005 (LISTEN)
node      39641 user   27u  IPv4 0x42db4c1545130ac3      0t0  TCP 127.0.0.1:4006 (LISTEN)
node      39641 user   28u  IPv4 0x3179fd6f87fdc0bd      0t0  TCP 127.0.0.1:4007 (LISTEN)
```

## Wildcard / non-loopback check

```
PASS: all ten listeners are 127.0.0.1; none on 0.0.0.0, ::, or *
```

The unrelated `router-v2` on 4000/8088 (a stale process from Oct 25, not started by this repo) was deliberately left untouched.

## Functional check through the loopback interfaces

```json
{"data":{"pickupCandidates":[{"person":{"displayName":"Loretta Brooks","contactMethods":[{"value":"+1-313-555-0103"}]}},{"person":{"displayName":"Bryan Brooks","contactMethods":[{"value":"+1-313-555-0104"}]}},{"person":{"displayName":"Tasha Ellison","contactMethods":[{"value":"+1-313-555-0107"}]}},{"person":{"displayName":"Monique Davis","contactMethods":[{"value":"+1-313-555-0108"}]}}]}}
```

MCP tool call (\`ops/mcp-probe.mjs\`): `PickupCandidates` returned `isError: false`; the introspection negative control still returns `Tool introspect not found`.
