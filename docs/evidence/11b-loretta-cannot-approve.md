# As Loretta: approveRelationship denied (not a parent)

- endpoint: `http://127.0.0.1:4010/`
- x-demo-user: `p_gma`  (INSECURE dev header)
- x-demo-date: `2026-10-26`
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
          "    at deny (/Users/user/Desktop/bentley/fridgegraph/src/authz.ts:27:10)",
          "    at approveRelationship (/Users/user/Desktop/bentley/fridgegraph/src/subgraphs/village.ts:229:59)",
          "    at field.resolve (/Users/user/Desktop/bentley/fridgegraph/node_modules/@apollo/server/src/utils/schemaInstrumentation.ts:82:22)",
          "    at executeField (/Users/user/Desktop/bentley/fridgegraph/node_modules/graphql/execution/execute.js:733:20)",
          "    at /Users/user/Desktop/bentley/fridgegraph/node_modules/graphql/execution/execute.js:614:22",
          "    at promiseReduce (/Users/user/Desktop/bentley/fridgegraph/node_modules/graphql/jsutils/promiseReduce.js:25:9)",
          "    at executeFieldsSerially (/Users/user/Desktop/bentley/fridgegraph/node_modules/graphql/execution/execute.js:610:43)",
          "    at executeOperation (/Users/user/Desktop/bentley/fridgegraph/node_modules/graphql/execution/execute.js:582:14)",
          "    at execute (/Users/user/Desktop/bentley/fridgegraph/node_modules/graphql/execution/execute.js:309:20)",
          "    at executeIncrementally (/Users/user/Desktop/bentley/fridgegraph/node_modules/@apollo/server/dist/esm/incrementalDeliveryPolyfill.js:21:12)"
        ],
        "service": "village"
      }
    }
  ]
}
```
