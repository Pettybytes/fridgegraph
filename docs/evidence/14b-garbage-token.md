# Malformed bearer token -> rejected (edge AUTH_ERROR or downstream UNAUTHENTICATED)

- endpoint: `http://127.0.0.1:4010/`
- identity: (none)  (verified Supabase JWT; token redacted, never stored)
- x-demo-date: `2026-10-26`  (test clock; honoured only while DEMO_CLOCK=1)
- extra headers: `{"authorization":"Bearer not-a-jwt"}`
- note: Rejection may come from the router (AUTH_ERROR) or the subgraph (UNAUTHENTICATED) depending on whether router-level JWT is active. Either way no data is returned and the caller stays unknown. The edge-specific assertion lives in evidence 16.
- HTTP status: 400

## Query

```graphql
query { pickupCandidates(childId: "p_nora", asOf: "2026-10-26") { reason } }
```

## Variables

```json
{}
```

## Response

```json
{
  "errors": [
    {
      "message": "'(truncated)' is not a valid JWT header: InvalidToken",
      "extensions": {
        "code": "AUTH_ERROR"
      }
    }
  ]
}
```
