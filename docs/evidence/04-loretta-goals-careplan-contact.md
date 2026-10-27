# As Loretta: approved goal only, carePlan and Bryan contact denied

- endpoint: `http://127.0.0.1:4010/`
- x-demo-user: `p_gma`  (INSECURE dev header)
- x-demo-date: `2026-10-26`
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
          "    at deny (/Users/user/Desktop/bentley/fridgegraph/src/authz.ts:27:10)",
          "    at authorizeChild (/Users/user/Desktop/bentley/fridgegraph/src/authz.ts:94:9)",
          "    at carePlan (/Users/user/Desktop/bentley/fridgegraph/src/subgraphs/village.ts:220:7)",
          "    at field.resolve (/Users/user/Desktop/bentley/fridgegraph/node_modules/@apollo/server/src/utils/schemaInstrumentation.ts:82:22)",
          "    at executeField (/Users/user/Desktop/bentley/fridgegraph/node_modules/graphql/execution/execute.js:733:20)",
          "    at executeFields (/Users/user/Desktop/bentley/fridgegraph/node_modules/graphql/execution/execute.js:653:22)",
          "    at executeOperation (/Users/user/Desktop/bentley/fridgegraph/node_modules/graphql/execution/execute.js:579:14)",
          "    at execute (/Users/user/Desktop/bentley/fridgegraph/node_modules/graphql/execution/execute.js:309:20)",
          "    at executeIncrementally (/Users/user/Desktop/bentley/fridgegraph/node_modules/@apollo/server/dist/esm/incrementalDeliveryPolyfill.js:21:12)",
          "    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)"
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
          "    at deny (/Users/user/Desktop/bentley/fridgegraph/src/authz.ts:27:10)",
          "    at authorizeChild (/Users/user/Desktop/bentley/fridgegraph/src/authz.ts:94:9)",
          "    at contactMethods (/Users/user/Desktop/bentley/fridgegraph/src/subgraphs/village.ts:261:9)",
          "    at field.resolve (/Users/user/Desktop/bentley/fridgegraph/node_modules/@apollo/server/src/utils/schemaInstrumentation.ts:82:22)",
          "    at executeField (/Users/user/Desktop/bentley/fridgegraph/node_modules/graphql/execution/execute.js:733:20)",
          "    at executeFields (/Users/user/Desktop/bentley/fridgegraph/node_modules/graphql/execution/execute.js:653:22)",
          "    at completeObjectValue (/Users/user/Desktop/bentley/fridgegraph/node_modules/graphql/execution/execute.js:1174:10)",
          "    at completeValue (/Users/user/Desktop/bentley/fridgegraph/node_modules/graphql/execution/execute.js:887:12)",
          "    at executeField (/Users/user/Desktop/bentley/fridgegraph/node_modules/graphql/execution/execute.js:741:19)",
          "    at executeFields (/Users/user/Desktop/bentley/fridgegraph/node_modules/graphql/execution/execute.js:653:22)"
        ],
        "service": "village"
      }
    }
  ]
}
```
