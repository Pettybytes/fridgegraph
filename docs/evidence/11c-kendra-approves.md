# As Kendra: approveRelationship -> ACTIVE

- endpoint: `http://127.0.0.1:4012/`
- identity: Bearer eyJhbG…<redacted, 823 chars>  (verified Supabase JWT; token redacted, never stored)
- x-demo-date: `2026-10-26`  (test clock; honoured only while DEMO_CLOCK=1)
- HTTP status: 200

## Query

```graphql
mutation { approveRelationship(relationshipId: "r_dana_friend_parent") { id status history { at event } } }
```

## Variables

```json
{}
```

## Response

```json
{
  "data": {
    "approveRelationship": {
      "id": "r_dana_friend_parent",
      "status": "ACTIVE",
      "history": [
        {
          "at": "2026-10-24",
          "event": "DISCOVERED (friend_parent)"
        },
        {
          "at": "2026-10-31",
          "event": "APPROVED (dev shortcut: invitation and contact verification skipped)"
        }
      ]
    }
  }
}
```
