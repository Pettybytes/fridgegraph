# Two Approval rows exist after the two mutations

- endpoint: `http://127.0.0.1:4012/`
- identity: Bearer eyJhbG…<redacted, 823 chars>  (verified Supabase JWT; token redacted, never stored)
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
        "id": "ap_2ab2ed0c-5934-4e29-b922-fa574e74f69f",
        "approver": {
          "displayName": "Kendra Ellison"
        },
        "subjectType": "Relationship",
        "subjectId": "r_dana_friend_parent",
        "decision": "APPROVED",
        "at": "2026-10-31"
      },
      {
        "id": "ap_24798ead-e1f5-46ea-8b73-fd366aa58fc4",
        "approver": {
          "displayName": "Kendra Ellison"
        },
        "subjectType": "Grant",
        "subjectId": "g_f076566d-02d5-43b3-a08e-17149fb3b903",
        "decision": "GRANTED",
        "at": "2026-10-31"
      }
    ]
  }
}
```
