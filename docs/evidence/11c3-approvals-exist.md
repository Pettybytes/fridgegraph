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
        "id": "ap_1363918b-08d8-4354-ae83-90e2c072f430",
        "approver": {
          "displayName": "Kendra Ellison"
        },
        "subjectType": "Relationship",
        "subjectId": "r_dana_friend_parent",
        "decision": "APPROVED",
        "at": "2026-10-30"
      },
      {
        "id": "ap_e616e126-fcf7-4da4-a6f3-153c45c9bd86",
        "approver": {
          "displayName": "Kendra Ellison"
        },
        "subjectType": "Grant",
        "subjectId": "g_937c327f-5e50-4880-a74d-2e8476ea7fb8",
        "decision": "GRANTED",
        "at": "2026-10-30"
      }
    ]
  }
}
```
