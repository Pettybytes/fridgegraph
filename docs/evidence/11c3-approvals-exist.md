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
        "id": "ap_95db15f3-6b37-463d-b1c8-0c4a494fddae",
        "approver": {
          "displayName": "Kendra Ellison"
        },
        "subjectType": "Relationship",
        "subjectId": "r_dana_friend_parent",
        "decision": "APPROVED",
        "at": "2026-10-27"
      },
      {
        "id": "ap_51ff0af6-9e8f-4b1a-8dc6-ac81f612bd3b",
        "approver": {
          "displayName": "Kendra Ellison"
        },
        "subjectType": "Grant",
        "subjectId": "g_f1fc9108-78a1-4247-b565-c3c1aca082c4",
        "decision": "GRANTED",
        "at": "2026-10-27"
      }
    ]
  }
}
```
