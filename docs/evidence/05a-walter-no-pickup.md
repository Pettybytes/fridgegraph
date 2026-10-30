# As Walter: pickupCandidates -> UNAUTHORIZED (no pickup.verify)

- endpoint: `http://127.0.0.1:4010/`
- identity: Bearer eyJhbG…<redacted, 807 chars>  (verified Supabase JWT; token redacted, never stored)
- x-demo-date: `2026-10-26`  (test clock; honoured only while DEMO_CLOCK=1)
- note: Walter holds schedule.read and goals.read only, so he may not read the candidate list at all.
- HTTP status: 200

## Query

```graphql
query { pickupCandidates(childId: "p_nora", asOf: "2026-10-26") { person { displayName } } }
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
        "pickupCandidates"
      ],
      "extensions": {
        "code": "UNAUTHORIZED",
        "stacktrace": [
          "GraphQLError: UNAUTHORIZED",
          "    at deny (/Users/user/Desktop/bentley/fridgegraph-level-b/src/authz.ts:42:10)",
          "    at requirePickupAccess (/Users/user/Desktop/bentley/fridgegraph-level-b/src/subgraphs/access.ts:171:9)",
          "    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)",
          "    at async pickupCandidates (/Users/user/Desktop/bentley/fridgegraph-level-b/src/subgraphs/access.ts:267:7)"
        ],
        "service": "access"
      }
    }
  ],
  "extensions": {
    "valueCompletion": [
      {
        "message": "Cannot return null for non-nullable type Candidate",
        "path": []
      }
    ]
  }
}
```
