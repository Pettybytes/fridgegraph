# As Kendra: query plan for the composed operation

- endpoint: `http://127.0.0.1:4010/`
- identity: Bearer eyJhbG…<redacted, 807 chars>  (verified Supabase JWT; token redacted, never stored)
- x-demo-date: `2026-10-26`  (test clock; honoured only while DEMO_CLOCK=1)
- extra headers: `{"apollo-expose-query-plan":"true"}`
- HTTP status: 200

## Query

```graphql
query { pickupCandidates(childId: "p_nora", asOf: "2026-10-26") { person { displayName } reason } }
```

## Variables

```json
{}
```

## Response

```json
{
  "data": {
    "pickupCandidates": [
      {
        "person": {
          "displayName": "Loretta Brooks"
        },
        "reason": "grandmother — transport.child offered, pickup.request grant valid 2026-10-26"
      },
      {
        "person": {
          "displayName": "Bryan Brooks"
        },
        "reason": "uncle — transport.child offered, pickup.request grant valid 2026-10-26"
      },
      {
        "person": {
          "displayName": "Tasha Ellison"
        },
        "reason": "aunt + godmother — transport.child offered, pickup.request grant valid 2026-10-26"
      },
      {
        "person": {
          "displayName": "Monique Davis"
        },
        "reason": "parent_friend — transport.child offered, pickup.request grant valid 2026-10-26"
      }
    ]
  }
}
```
