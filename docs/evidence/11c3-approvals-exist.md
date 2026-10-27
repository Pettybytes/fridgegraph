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
        "id": "ap_34927950-7be3-4ee3-91b7-8fb0aa416e19",
        "approver": {
          "displayName": "Kendra Ellison"
        },
        "subjectType": "Relationship",
        "subjectId": "r_dana_friend_parent",
        "decision": "APPROVED",
        "at": "2026-10-27"
      },
      {
        "id": "ap_ce5724fa-f23f-4aac-bdc7-0869bcb45bc2",
        "approver": {
          "displayName": "Kendra Ellison"
        },
        "subjectType": "Grant",
        "subjectId": "g_31f8ab16-2f52-4604-b73b-59aa7424d1f6",
        "decision": "GRANTED",
        "at": "2026-10-27"
      }
    ]
  }
}
```
