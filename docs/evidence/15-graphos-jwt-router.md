# 15 — GraphOS-connected router: JWT enforced at the edge

Isolated router: `router.graphos.yaml`, listen `127.0.0.1:4011`, health `127.0.0.1:8091`,
connected to GraphOS with `APOLLO_GRAPH_REF=fridgegraph@dev` and a graph API key from the
environment. The main router (4010/8090), the MCP server and all seven subgraphs were left
untouched.

## Licence

Startup log (sanitized): `state machine transitioned`, `event: UpdateLicense(Licensed)`,
`state: Running`. The Authentication plugin is entitled on this connection. Nothing was
purchased or changed in GraphOS.

## Cases

| Case | Sent to | HTTP | GraphQL error code |
| --- | --- | --- | --- |
| valid token (Kendra) | :4011 router | 200 | — |
| no Authorization header | :4011 router | 200 | UNAUTHENTICATED |
| malformed token | :4011 router | 400 | AUTH_ERROR |
| alg:none token | :4011 router | 400 | AUTH_ERROR |
| HS256 token (wrong alg) | :4011 router | 401 | AUTH_ERROR |
| tampered signature | :4011 router | 401 | AUTH_ERROR |
| malformed token | :4002 subgraph (direct) | 200 | UNAUTHENTICATED |

## What the results mean

1. **A valid token is accepted and the graph really routes.** The GraphOS-fetched supergraph
   returned live rows from the local subgraphs: 4 candidates (Loretta Brooks, Bryan Brooks, Tasha Ellison, Monique Davis). A schema that merely *looks* equivalent could not do this.
2. **A missing token is not blocked by the router.** Documented: "If no JWT is present, the
   request proceeds." It is stopped downstream instead — `UNAUTHENTICATED`, the subgraph's own
   code, which is the same code we saw before any router auth existed. That is the two-layer
   design working, and it is why the demo dot stays green with the edge layer removed.
3. **Invalid tokens are rejected AT THE ROUTER, not downstream.** Malformed, `alg:none`, `HS256`
   and tampered-signature tokens all fail with the router's own `AUTH_ERROR` — HTTP 400 when the
   token cannot even be parsed, HTTP 401 when validation fails — without reaching a subgraph.
   The contrast case proves the layers differ: the *same* malformed token sent directly to :4002
   returns `UNAUTHENTICATED` at HTTP 200, which is the subgraph's own code, not the router's. If the router rejection were merely
   downstream, those two rows would be identical.
4. **Algorithm allowlist holds.** `alg:none` and `HS256` are refused even though the payload was
   shaped like a valid token, because the JWKS entry lists `ES256` only.

## Router log corroboration

The router logged JWT validation failures for the rejected cases. Excerpts are sanitized; no key,
secret, password or token appears in this file or in the router log excerpt.

## Sanitized log lines

```
{"timestamp":"2026-10-27T02:48:54.561974000Z","level":"INFO","trace_id":"ff6603156f5dfb79feb380ec89dd1d38","span_id":"9e0c4749437532de","message":"compute job thread pool created","threads":12,"queue_capacity":12000,"target":"apollo_router::compute_job","spans":[{"http.request.method":"POST","http.route":"/","url.path":"/","client.name":"","client.version":"","name":"router"},{"authentication serv
```

## Notes / limits

- Token signing key is Supabase's; no token was minted here and none was written to disk.
- Issuer/audience are additionally pinned in the router JWKS block (`issuers`, `audiences`),
  but a wrong-issuer or wrong-audience token cannot be forged without Supabase's private key,
  so those two paths are enforced-by-configuration rather than demonstrated by request.
- `on_error: Error` returns detailed validation messages. That is fine for a localhost test and
  would be `RedactedError` on anything internet-facing.
