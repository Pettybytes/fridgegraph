# As Dana: Nora's goals denied

- endpoint: `http://127.0.0.1:4010/`
- identity: Bearer eyJhbG…<redacted, 804 chars>  (verified Supabase JWT; token redacted, never stored)
- x-demo-date: `2026-10-26`  (test clock; honoured only while DEMO_CLOCK=1)
- HTTP status: 200

## Query

```graphql
query { goals(childId: "p_nora") { title } }
```

## Variables

```json
{}
```

## Response

```json
{
  "data": null,
  "errors": [
    {
      "message": "UNAUTHORIZED",
      "locations": [
        {
          "line": 1,
          "column": 3
        }
      ],
      "path": [
        "goals"
      ],
      "extensions": {
        "code": "UNAUTHORIZED",
        "stacktrace": [
          "GraphQLError: UNAUTHORIZED",
          "    at deny (/Users/user/Desktop/bentley/fridgegraph/src/authz.ts:42:10)",
          "    at goals (/Users/user/Desktop/bentley/fridgegraph/src/subgraphs/village.ts:308:13)",
          "    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)"
        ],
        "service": "village"
      }
    }
  ]
}
```
