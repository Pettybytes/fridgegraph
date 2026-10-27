# As Loretta: approved goal only, carePlan and Bryan contact denied

- endpoint: `http://127.0.0.1:4010/`
- identity: Bearer eyJhbG…<redacted, 807 chars>  (verified Supabase JWT; token redacted, never stored)
- x-demo-date: `2026-10-26`  (test clock; honoured only while DEMO_CLOCK=1)
- HTTP status: 200

## Query

```graphql
query {
  goals(childId: "p_nora") { title status }
  carePlan(childId: "p_nora") { text }
  person(id: "p_bryan") { displayName contactMethods(childId: "p_nora") { channel value } }
}
```

## Variables

```json
{}
```

## Response

```json
{
  "data": {
    "goals": [
      {
        "title": "Reading level 3 by June",
        "status": "APPROVED"
      }
    ],
    "carePlan": null,
    "person": null
  },
  "errors": [
    {
      "message": "UNAUTHORIZED",
      "locations": [
        {
          "line": 1,
          "column": 45
        }
      ],
      "path": [
        "carePlan"
      ],
      "extensions": {
        "code": "UNAUTHORIZED",
        "stacktrace": [
          "GraphQLError: UNAUTHORIZED",
          "    at deny (/Users/user/Desktop/bentley/fridgegraph/src/authz.ts:42:10)",
          "    at authorizeChild (/Users/user/Desktop/bentley/fridgegraph/src/authz.ts:161:9)",
          "    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)",
          "    at async carePlan (/Users/user/Desktop/bentley/fridgegraph/src/subgraphs/village.ts:311:7)"
        ],
        "service": "village"
      }
    },
    {
      "message": "UNAUTHORIZED",
      "locations": [
        {
          "line": 1,
          "column": 118
        }
      ],
      "path": [
        "person",
        "contactMethods"
      ],
      "extensions": {
        "code": "UNAUTHORIZED",
        "stacktrace": [
          "GraphQLError: UNAUTHORIZED",
          "    at deny (/Users/user/Desktop/bentley/fridgegraph/src/authz.ts:42:10)",
          "    at authorizeChild (/Users/user/Desktop/bentley/fridgegraph/src/authz.ts:161:9)",
          "    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)",
          "    at async contactMethods (/Users/user/Desktop/bentley/fridgegraph/src/subgraphs/village.ts:404:9)"
        ],
        "service": "village"
      }
    }
  ]
}
```
