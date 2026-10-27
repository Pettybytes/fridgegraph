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
          "    at deny (/Users/user/Desktop/bentley/fridgegraph/src/authz.ts:27:10)",
          "    at requirePickupAccess (/Users/user/Desktop/bentley/fridgegraph/src/subgraphs/access.ts:124:9)",
          "    at pickupCandidates (/Users/user/Desktop/bentley/fridgegraph/src/subgraphs/access.ts:163:7)",
          "    at field.resolve (/Users/user/Desktop/bentley/fridgegraph/node_modules/@apollo/server/src/utils/schemaInstrumentation.ts:82:22)",
          "    at executeField (/Users/user/Desktop/bentley/fridgegraph/node_modules/graphql/execution/execute.js:733:20)",
          "    at executeFields (/Users/user/Desktop/bentley/fridgegraph/node_modules/graphql/execution/execute.js:653:22)",
          "    at executeOperation (/Users/user/Desktop/bentley/fridgegraph/node_modules/graphql/execution/execute.js:579:14)",
          "    at execute (/Users/user/Desktop/bentley/fridgegraph/node_modules/graphql/execution/execute.js:309:20)",
          "    at executeIncrementally (/Users/user/Desktop/bentley/fridgegraph/node_modules/@apollo/server/dist/esm/incrementalDeliveryPolyfill.js:21:12)",
          "    at async execute (/Users/user/Desktop/bentley/fridgegraph/node_modules/@apollo/server/src/requestPipeline.ts:550:31)"
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
