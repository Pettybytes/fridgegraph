# As Dana: Nora's schedule denied (cross-village)

- endpoint: `http://127.0.0.1:4010/`
- identity: Bearer eyJhbG…<redacted, 804 chars>  (verified Supabase JWT; token redacted, never stored)
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
          "    at deny (/Users/user/Desktop/bentley/fridgegraph/src/authz.ts:27:10)",
          "    at authorizeChild (/Users/user/Desktop/bentley/fridgegraph/src/authz.ts:102:9)",
          "    at events (/Users/user/Desktop/bentley/fridgegraph/src/subgraphs/schedule.ts:32:7)",
          "    at field.resolve (/Users/user/Desktop/bentley/fridgegraph/node_modules/@apollo/server/src/utils/schemaInstrumentation.ts:82:22)",
          "    at executeField (/Users/user/Desktop/bentley/fridgegraph/node_modules/graphql/execution/execute.js:733:20)",
          "    at executeFields (/Users/user/Desktop/bentley/fridgegraph/node_modules/graphql/execution/execute.js:653:22)",
          "    at executeOperation (/Users/user/Desktop/bentley/fridgegraph/node_modules/graphql/execution/execute.js:579:14)",
          "    at execute (/Users/user/Desktop/bentley/fridgegraph/node_modules/graphql/execution/execute.js:309:20)",
          "    at executeIncrementally (/Users/user/Desktop/bentley/fridgegraph/node_modules/@apollo/server/dist/esm/incrementalDeliveryPolyfill.js:21:12)",
          "    at async execute (/Users/user/Desktop/bentley/fridgegraph/node_modules/@apollo/server/src/requestPipeline.ts:550:31)"
        ],
        "service": "schedule"
      }
    }
  ]
}
```
