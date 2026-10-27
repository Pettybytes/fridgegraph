# 16 — Edge auth on the main router, and MCP through the graph

Main router: `router.graphos.yaml` on `127.0.0.1:4010` (health 8090), connected to GraphOS,
router-level JWT **on**. Started from `~/.rover/bin/router-v2.18.0`, not `rover dev`.
Startup log: `UpdateLicense(Licensed)`, 0 ERROR lines.

## Edge assertions

| Case | Expected | HTTP | Code | Data |
| --- | --- | --- | --- | --- |
| valid token (Kendra) | 200 ready | 200 | — | 4 people |
| tampered signature | AUTH_ERROR | 401 | AUTH_ERROR | no data |
| no Authorization header | UNAUTHENTICATED | 200 | UNAUTHENTICATED | no data |

- **Tampered token is rejected at the edge**: HTTP 401, `AUTH_ERROR`, before any subgraph executes.
- **A missing token is NOT stopped at the edge** (documented router behaviour). It reaches the
  subgraph and is rejected there as `UNAUTHENTICATED`. That is why subgraph verification must
  stay: the edge layer only sees tokens that exist.
- Valid token returns live rows: Loretta Brooks, Bryan Brooks, Tasha Ellison, Monique Davis.

## MCP

`tools/call PickupCandidates` as Kendra (the caller's own token forwarded by the MCP server):

```
Loretta Brooks
Bryan Brooks
Tasha Ellison
Monique Davis
```

Identity used: Bearer eyJhbG…<redacted, 807 chars> (never written).
