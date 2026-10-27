# As Loretta: approveRelationship denied (not a parent)

- endpoint: `http://127.0.0.1:4010/`
- identity: Bearer eyJhbG…<redacted, 807 chars>  (verified Supabase JWT; token redacted, never stored)
- x-demo-date: `2026-10-26`  (test clock; honoured only while DEMO_CLOCK=1)
- HTTP status: 200

## Query

```graphql
mutation { approveRelationship(relationshipId: "r_dana_friend_parent") { id status } }
```

## Variables

```json
{}
```

## Response

```json
{
  "data": {
    "approveRelationship": null
  },
  "errors": [
    {
      "message": "UNAUTHORIZED",
      "locations": [
        {
          "line": 1,
          "column": 12
        }
      ],
      "path": [
        "approveRelationship"
      ],
      "extensions": {
        "code": "UNAUTHORIZED",
        "stacktrace": [
          "GraphQLError: UNAUTHORIZED",
          "    at deny (/Users/user/Desktop/bentley/fridgegraph/src/authz.ts:42:10)",
          "    at approveRelationship (/Users/user/Desktop/bentley/fridgegraph/src/subgraphs/village.ts:339:29)",
          "    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)"
        ],
        "service": "village"
      }
    }
  ]
}
```
