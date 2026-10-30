# As Gary: Nora's carePlan denied

- endpoint: `http://127.0.0.1:4010/`
- identity: Bearer eyJhbG…<redacted, 800 chars>  (verified Supabase JWT; token redacted, never stored)
- x-demo-date: `2026-10-26`  (test clock; honoured only while DEMO_CLOCK=1)
- HTTP status: 200

## Query

```graphql
query { carePlan(childId: "p_nora") { text } }
```

## Variables

```json
{}
```

## Response

```json
{
  "data": {
    "carePlan": null
  },
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
        "carePlan"
      ],
      "extensions": {
        "code": "UNAUTHORIZED",
        "stacktrace": [
          "GraphQLError: UNAUTHORIZED",
          "    at deny (/Users/user/Desktop/bentley/fridgegraph-level-b/src/authz.ts:42:10)",
          "    at authorizeChild (/Users/user/Desktop/bentley/fridgegraph-level-b/src/authz.ts:161:9)",
          "    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)",
          "    at async carePlan (/Users/user/Desktop/bentley/fridgegraph-level-b/src/subgraphs/village.ts:311:7)"
        ],
        "service": "village"
      }
    }
  ]
}
```
