# As Kendra: grantAccess Dana pickup.request until Nov 30

- endpoint: `http://127.0.0.1:4010/`
- identity: Bearer eyJhbG…<redacted, 807 chars>  (verified Supabase JWT; token redacted, never stored)
- x-demo-date: `2026-10-26`  (test clock; honoured only while DEMO_CLOCK=1)
- HTTP status: 200

## Query

```graphql
mutation {
  grantAccess(actorId: "p_dana", childId: "p_nora", scopes: ["pickup.request"], validUntil: "2026-11-30") {
    id actor { displayName } scopes validFrom validUntil grantedBy { displayName }
  }
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
    "grantAccess": {
      "id": "g_3c27a943-be31-4845-aab4-3d679e673508",
      "actor": {
        "displayName": "Dana Coleman"
      },
      "scopes": [
        "pickup.request"
      ],
      "validFrom": null,
      "validUntil": "2026-11-30",
      "grantedBy": {
        "displayName": "Kendra Ellison"
      }
    }
  }
}
```
