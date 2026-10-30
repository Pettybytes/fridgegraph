# After reset: Dana is gone from pickupCandidates again

- endpoint: `http://127.0.0.1:4010/`
- identity: Bearer eyJhbG…<redacted, 823 chars>  (verified Supabase JWT; token redacted, never stored)
- x-demo-date: `2026-10-26`  (test clock; honoured only while DEMO_CLOCK=1)
- HTTP status: 200

## Query

```graphql
query { pickupCandidates(childId: "p_nora", asOf: "2026-10-26") { person { displayName } } }
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
        }
      },
      {
        "person": {
          "displayName": "Bryan Brooks"
        }
      },
      {
        "person": {
          "displayName": "Tasha Ellison"
        }
      },
      {
        "person": {
          "displayName": "Monique Davis"
        }
      }
    ]
  }
}
```
