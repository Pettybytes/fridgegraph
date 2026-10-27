# As Gary: busRoster allowed (transport.read)

- endpoint: `http://127.0.0.1:4010/`
- identity: Bearer eyJhbG…<redacted, 800 chars>  (verified Supabase JWT; token redacted, never stored)
- x-demo-date: `2026-10-26`  (test clock; honoured only while DEMO_CLOCK=1)
- HTTP status: 200

## Query

```graphql
query { busRoster(childId: "p_nora", date: "2026-10-26") { route riding date child { id } } }
```

## Variables

```json
{}
```

## Response

```json
{
  "data": {
    "busRoster": {
      "route": "Route 14",
      "riding": true,
      "date": "2026-10-26",
      "child": {
        "id": "p_nora"
      }
    }
  }
}
```
