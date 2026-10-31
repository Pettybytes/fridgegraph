# No Authorization header -> UNAUTHENTICATED (unknown caller)

- endpoint: `http://127.0.0.1:4012/`
- identity: (none)  (verified Supabase JWT; token redacted, never stored)
- x-demo-date: `2026-10-26`  (test clock; honoured only while DEMO_CLOCK=1)
- note: No identity is sent at all. Failure code is UNAUTHENTICATED, not UNAUTHORIZED.
- HTTP status: 200

## Query

```graphql
query { pickupCandidates(childId: "p_nora", asOf: "2026-10-26") { reason } }
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
      "message": "UNAUTHENTICATED",
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
        "code": "UNAUTHENTICATED",
        "stacktrace": [
          "GraphQLError: UNAUTHENTICATED",
          "    at unauthenticated (/Users/user/Desktop/bentley/fridgegraph/src/authz.ts:54:10)",
          "    at requireCaller (/Users/user/Desktop/bentley/fridgegraph/src/authz.ts:60:24)",
          "    at requirePickupAccess (/Users/user/Desktop/bentley/fridgegraph/src/subgraphs/access.ts:184:3)",
          "    at pickupCandidates (/Users/user/Desktop/bentley/fridgegraph/src/subgraphs/access.ts:286:13)",
          "    at field.resolve (/Users/user/Desktop/bentley/fridgegraph/node_modules/@apollo/server/src/utils/schemaInstrumentation.ts:82:22)",
          "    at executeField (/Users/user/Desktop/bentley/fridgegraph/node_modules/graphql/execution/execute.js:733:20)",
          "    at executeFields (/Users/user/Desktop/bentley/fridgegraph/node_modules/graphql/execution/execute.js:653:22)",
          "    at executeOperation (/Users/user/Desktop/bentley/fridgegraph/node_modules/graphql/execution/execute.js:579:14)",
          "    at execute (/Users/user/Desktop/bentley/fridgegraph/node_modules/graphql/execution/execute.js:309:20)",
          "    at executeIncrementally (/Users/user/Desktop/bentley/fridgegraph/node_modules/@apollo/server/dist/esm/incrementalDeliveryPolyfill.js:21:12)"
        ],
        "service": "access"
      }
    }
  ]
}
```
