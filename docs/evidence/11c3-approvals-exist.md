# Two Approval rows exist after the two mutations

- endpoint: `http://127.0.0.1:4010/`
- identity: Bearer eyJhbG…<redacted, 807 chars>  (verified Supabase JWT; token redacted, never stored)
- x-demo-date: `2026-10-26`  (test clock; honoured only while DEMO_CLOCK=1)
- HTTP status: 200

## Query

```graphql
query { approvals { id approver { displayName } subjectType subjectId decision at } }
```

## Variables

```json
{}
```

## Response

```json
{
  "data": {
    "approvals": [
      {
        "id": "ap_c0da84ba-09b6-4789-99fd-d662727d7c58",
        "approver": {
          "displayName": "Kendra Ellison"
        },
        "subjectType": "Relationship",
        "subjectId": "r_dana_friend_parent",
        "decision": "APPROVED",
        "at": "2026-10-30"
      },
      {
        "id": "ap_a1a210b7-b426-411d-8b39-0cbb22206978",
        "approver": {
          "displayName": "Kendra Ellison"
        },
        "subjectType": "Grant",
        "subjectId": "g_ebd3427a-b9c9-47a7-b2e7-3c6bac3003c6",
        "decision": "GRANTED",
        "at": "2026-10-30"
      }
    ]
  }
}
```
