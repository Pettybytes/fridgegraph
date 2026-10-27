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
        "id": "ap_fd9a16c7-70c7-42d5-9540-a8c9aa49427e",
        "approver": {
          "displayName": "Kendra Ellison"
        },
        "subjectType": "Relationship",
        "subjectId": "r_dana_friend_parent",
        "decision": "APPROVED",
        "at": "2026-10-27"
      },
      {
        "id": "ap_bb6f183e-581f-430b-82c3-4fa381f5f838",
        "approver": {
          "displayName": "Kendra Ellison"
        },
        "subjectType": "Grant",
        "subjectId": "g_e675ccaa-02c1-4803-8f28-19108878dd9d",
        "decision": "GRANTED",
        "at": "2026-10-27"
      }
    ]
  }
}
```
