# As Angela: vehicles of Nora's pickupCandidates allowed (pickup.verify)

- endpoint: `http://127.0.0.1:4010/`
- identity: Bearer eyJhbG…<redacted, 804 chars>  (verified Supabase JWT; token redacted, never stored)
- x-demo-date: `2026-10-26`  (test clock; honoured only while DEMO_CLOCK=1)
- HTTP status: 200

## Query

```graphql
query { pickupCandidates(childId: "p_nora", asOf: "2026-10-26") { person { displayName vehicles { plate } } } }
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
          "displayName": "Loretta Brooks",
          "vehicles": [
            {
              "plate": "DEMO-103"
            }
          ]
        }
      },
      {
        "person": {
          "displayName": "Bryan Brooks",
          "vehicles": [
            {
              "plate": "DEMO-104"
            }
          ]
        }
      },
      {
        "person": {
          "displayName": "Tasha Ellison",
          "vehicles": [
            {
              "plate": "DEMO-105"
            }
          ]
        }
      },
      {
        "person": {
          "displayName": "Monique Davis",
          "vehicles": [
            {
              "plate": "DEMO-106"
            }
          ]
        }
      }
    ]
  }
}
```
