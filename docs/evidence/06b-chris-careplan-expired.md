# As Chris: carePlan -> UNAUTHORIZED (grant window closed 2026-09-30)

- endpoint: `http://127.0.0.1:4010/`
- identity: Bearer eyJhbG…<redacted, 804 chars>  (verified Supabase JWT; token redacted, never stored)
- x-demo-date: `(not sent)`  (test clock; honoured only while DEMO_CLOCK=1)
- note: Chris holds careplan.read for Nora, but the window ended 2026-09-30 — before today, with no clock manipulation. Scope is present, so only the date check can explain the denial.
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
          "    at deny (/Users/user/Desktop/bentley/fridgegraph/src/authz.ts:27:10)",
          "    at authorizeChild (/Users/user/Desktop/bentley/fridgegraph/src/authz.ts:102:9)",
          "    at carePlan (/Users/user/Desktop/bentley/fridgegraph/src/subgraphs/village.ts:224:7)",
          "    at field.resolve (/Users/user/Desktop/bentley/fridgegraph/node_modules/@apollo/server/src/utils/schemaInstrumentation.ts:82:22)",
          "    at executeField (/Users/user/Desktop/bentley/fridgegraph/node_modules/graphql/execution/execute.js:733:20)",
          "    at executeFields (/Users/user/Desktop/bentley/fridgegraph/node_modules/graphql/execution/execute.js:653:22)",
          "    at executeOperation (/Users/user/Desktop/bentley/fridgegraph/node_modules/graphql/execution/execute.js:579:14)",
          "    at execute (/Users/user/Desktop/bentley/fridgegraph/node_modules/graphql/execution/execute.js:309:20)",
          "    at executeIncrementally (/Users/user/Desktop/bentley/fridgegraph/node_modules/@apollo/server/dist/esm/incrementalDeliveryPolyfill.js:21:12)",
          "    at async execute (/Users/user/Desktop/bentley/fridgegraph/node_modules/@apollo/server/src/requestPipeline.ts:550:31)"
        ],
        "service": "village"
      }
    }
  ]
}
```
