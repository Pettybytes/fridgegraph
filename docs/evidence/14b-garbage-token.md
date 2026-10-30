# Malformed bearer token -> rejected (edge AUTH_ERROR or downstream UNAUTHENTICATED)

- endpoint: `http://127.0.0.1:4010/`
- identity: (none)  (verified Supabase JWT; token redacted, never stored)
- x-demo-date: `2026-10-26`  (test clock; honoured only while DEMO_CLOCK=1)
- extra headers: `{"authorization":"Bearer not-a-jwt"}`
- note: Rejection may come from the router (AUTH_ERROR) or the subgraph (UNAUTHENTICATED) depending on whether router-level JWT is active. Either way no data is returned and the caller stays unknown. The edge-specific assertion lives in evidence 16.
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
          "    at unauthenticated (/Users/user/Desktop/bentley/fridgegraph-level-b/src/authz.ts:54:10)",
          "    at requireCaller (/Users/user/Desktop/bentley/fridgegraph-level-b/src/authz.ts:60:24)",
          "    at requirePickupAccess (/Users/user/Desktop/bentley/fridgegraph-level-b/src/subgraphs/access.ts:169:3)",
          "    at pickupCandidates (/Users/user/Desktop/bentley/fridgegraph-level-b/src/subgraphs/access.ts:268:13)",
          "    at field.resolve (/Users/user/Desktop/bentley/fridgegraph-level-b/node_modules/@apollo/server/src/utils/schemaInstrumentation.ts:82:22)",
          "    at executeField (/Users/user/Desktop/bentley/fridgegraph-level-b/node_modules/graphql/execution/execute.js:733:20)",
          "    at executeFields (/Users/user/Desktop/bentley/fridgegraph-level-b/node_modules/graphql/execution/execute.js:653:22)",
          "    at executeOperation (/Users/user/Desktop/bentley/fridgegraph-level-b/node_modules/graphql/execution/execute.js:579:14)",
          "    at execute (/Users/user/Desktop/bentley/fridgegraph-level-b/node_modules/graphql/execution/execute.js:309:20)",
          "    at executeIncrementally (/Users/user/Desktop/bentley/fridgegraph-level-b/node_modules/@apollo/server/dist/esm/incrementalDeliveryPolyfill.js:21:12)"
        ],
        "service": "access"
      }
    }
  ]
}
```
