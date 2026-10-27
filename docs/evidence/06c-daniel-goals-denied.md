# As Daniel: goals denied

- endpoint: `http://127.0.0.1:4010/`
- x-demo-user: `p_okafor`  (INSECURE dev header)
- x-demo-date: `2026-10-26`
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
          "    at deny (/Users/user/Desktop/bentley/fridgegraph/src/authz.ts:27:10)",
          "    at goals (/Users/user/Desktop/bentley/fridgegraph/src/subgraphs/village.ts:217:13)",
          "    at field.resolve (/Users/user/Desktop/bentley/fridgegraph/node_modules/@apollo/server/src/utils/schemaInstrumentation.ts:82:22)",
          "    at executeField (/Users/user/Desktop/bentley/fridgegraph/node_modules/graphql/execution/execute.js:733:20)",
          "    at executeFields (/Users/user/Desktop/bentley/fridgegraph/node_modules/graphql/execution/execute.js:653:22)",
          "    at executeOperation (/Users/user/Desktop/bentley/fridgegraph/node_modules/graphql/execution/execute.js:579:14)",
          "    at execute (/Users/user/Desktop/bentley/fridgegraph/node_modules/graphql/execution/execute.js:309:20)",
          "    at executeIncrementally (/Users/user/Desktop/bentley/fridgegraph/node_modules/@apollo/server/dist/esm/incrementalDeliveryPolyfill.js:21:12)",
          "    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)",
          "    at async execute (/Users/user/Desktop/bentley/fridgegraph/node_modules/@apollo/server/src/requestPipeline.ts:550:31)"
        ],
        "service": "village"
      }
    }
  ]
}
```
