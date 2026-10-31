# As Dana: Nora's schedule denied (cross-village)

- endpoint: `http://127.0.0.1:4012/`
- identity: Bearer eyJhbG…<redacted, 820 chars>  (verified Supabase JWT; token redacted, never stored)
- x-demo-date: `2026-10-26`  (test clock; honoured only while DEMO_CLOCK=1)
- HTTP status: 200

## Query

```graphql
query { events(childId: "p_nora", date: "2026-10-26") { title } }
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
        "events"
      ],
      "extensions": {
        "code": "UNAUTHORIZED",
        "stacktrace": [
          "GraphQLError: UNAUTHORIZED",
          "    at deny (/Users/user/Desktop/bentley/fridgegraph/src/authz.ts:46:10)",
          "    at authorizeChild (/Users/user/Desktop/bentley/fridgegraph/src/authz.ts:217:9)",
          "    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)",
          "    at async events (/Users/user/Desktop/bentley/fridgegraph/src/subgraphs/schedule.ts:96:7)"
        ],
        "service": "schedule"
      }
    }
  ]
}
```
