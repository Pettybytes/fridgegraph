# After grant: Dana appears once as a pickupCandidate with the Pacifica

- endpoint: `http://127.0.0.1:4010/`
- identity: Bearer eyJhbG…<redacted, 807 chars>  (verified Supabase JWT; token redacted, never stored)
- x-demo-date: `2026-10-26`  (test clock; honoured only while DEMO_CLOCK=1)
- HTTP status: 200

## Query

```graphql
query {
  pickupCandidates(childId: "p_nora", asOf: "2026-10-26") {
    person { displayName vehicles { year make model color plate } }
    reason
  }
  danaOnly: person(id: "p_dana") { displayName vehicles { year make model color plate } }
}
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
          "displayName": "Dana Coleman",
          "vehicles": []
        },
        "reason": "friend_parent — transport.child offered, pickup.request grant valid 2026-10-26"
      },
      {
        "person": {
          "displayName": "Loretta Brooks",
          "vehicles": []
        },
        "reason": "grandmother — transport.child offered, pickup.request grant valid 2026-10-26"
      },
      {
        "person": {
          "displayName": "Bryan Brooks",
          "vehicles": []
        },
        "reason": "uncle — transport.child offered, pickup.request grant valid 2026-10-26"
      },
      {
        "person": {
          "displayName": "Tasha Ellison",
          "vehicles": []
        },
        "reason": "aunt + godmother — transport.child offered, pickup.request grant valid 2026-10-26"
      },
      {
        "person": {
          "displayName": "Monique Davis",
          "vehicles": []
        },
        "reason": "parent_friend — transport.child offered, pickup.request grant valid 2026-10-26"
      }
    ],
    "danaOnly": {
      "displayName": "Dana Coleman",
      "vehicles": []
    }
  }
}
```
