# MCP spike: one tool, introspection OFF, caller identity forwarded

- MCP endpoint: `http://127.0.0.1:5050/mcp` (Streamable HTTP)
- Apollo MCP Server: v2.1.0, Router 2.18.0, Federation 2.9.0
- Config: `.apollo/mcp.local.yaml` — introspection off, **no pinned identity**, `forward_headers: [authorization]`
- Tool: `PickupCandidates` from `ops/PickupCandidates.graphql`
- Identity: the caller's own Supabase JWT, forwarded per request and verified by the subgraphs

## Transcript A — caller token forwarded

```
identity: p_mom Bearer eyJhbG…<redacted, 807 chars>

== initialize ==
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2025-06-18",
    "capabilities": {
      "tools": {
        "listChanged": true
      }
    },
    "serverInfo": {
      "name": "Apollo MCP Server",
      "title": "Apollo MCP Server",
      "version": "2.1.0",
      "description": "A Model Context Protocol (MCP) server for exposing GraphQL APIs as tools.",
      "websiteUrl": "https://www.apollographql.com/docs/apollo-mcp-server"
    }
  }
}

== tools/list ==
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "tools": [
      {
        "name": "PickupCandidates",
        "description": "Predefined operation for the Step 7 MCP spike: one tool, introspection disabled.",
        "inputSchema": {
          "type": "object",
          "properties": {
            "childId": {
              "type": "string"
            },
            "asOf": {
              "anyOf": [
                {
                  "type": "string"
                },
                {
                  "type": "null"
                }
              ]
            }
          },
          "required": [
            "childId"
          ]
        },
        "annotations": {
          "readOnlyHint": true,
          "destructiveHint": false,
          "idempotentHint": true,
          "openWorldHint": true
        }
      }
    ]
  }
}

== tools/call PickupCandidates ==
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"data\":{\"pickupCandidates\":[{\"person\":{\"id\":\"p_gma\",\"displayName\":\"Loretta Brooks\",\"contactMethods\":[{\"channel\":\"CALL\",\"value\":\"+1-313-555-0103\",\"preferred\":true,\"verified\":true}],\"vehicles\":[{\"year\":2016,\"make\":\"Buick\",\"model\":\"Enclave\",\"color\":\"white\",\"plate\":\"DEMO-103\"}]},\"reason\":\"grandmother — transport.child offered, pickup.request grant valid 2026-10-26\",\"authorization\":\"AUTHORIZED\",\"availability\":\"UNKNOWN\"},{\"person\":{\"id\":\"p_bryan\",\"displayName\":\"Bryan Brooks\",\"contactMethods\":[{\"channel\":\"SMS\",\"value\":\"+1-313-555-0104\",\"preferred\":true,\"verified\":true}],\"vehicles\":[{\"year\":2020,\"make\":\"Dodge\",\"model\":\"Charger\",\"color\":\"blue\",\"plate\":\"DEMO-104\"}]},\"reason\":\"uncle — transport.child offered, pickup.request grant valid 2026-10-26\",\"authorization\":\"AUTHORIZED\",\"availability\":\"UNKNOWN\"},{\"person\":{\"id\":\"p_tasha\",\"displayName\":\"Tasha Ellison\",\"contactMethods\":[{\"channel\":\"SMS\",\"value\":\"+1-313-555-0107\",\"preferred\":true,\"verified\":true}],\"vehicles\":[{\"year\":2022,\"make\":\"Toyota\",\"model\":\"RAV4\",\"color\":\"red\",\"plate\":\"DEMO-105\"}]},\"reason\":\"aunt + godmother — transport.child offered, pickup.request grant valid 2026-10-26\",\"authorization\":\"AUTHORIZED\",\"availability\":\"UNKNOWN\"},{\"person\":{\"id\":\"p_monique\",\"displayName\":\"Monique Davis\",\"contactMethods\":[{\"channel\":\"SMS\",\"value\":\"+1-313-555-0108\",\"preferred\":true,\"verified\":true}],\"vehicles\":[{\"year\":2023,\"make\":\"Kia\",\"model\":\"Telluride\",\"color\":\"silver\",\"plate\":\"DEMO-106\"}]},\"reason\":\"parent_friend — transport.child offered, pickup.request grant valid 2026-10-26\",\"authorization\":\"AUTHORIZED\",\"availability\":\"UNKNOWN\"}]}}"
      }
    ],
    "isError": false
  }
}

== tools/call introspect (negative control) ==
{
  "jsonrpc": "2.0",
  "id": 4,
  "error": {
    "code": -32602,
    "message": "Tool introspect not found"
  }
}
```

## Transcript B — negative control, no token sent (must fail closed)

```
identity: (none sent)

== initialize ==
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2025-06-18",
    "capabilities": {
      "tools": {
        "listChanged": true
      }
    },
    "serverInfo": {
      "name": "Apollo MCP Server",
      "title": "Apollo MCP Server",
      "version": "2.1.0",
      "description": "A Model Context Protocol (MCP) server for exposing GraphQL APIs as tools.",
      "websiteUrl": "https://www.apollographql.com/docs/apollo-mcp-server"
    }
  }
}

== tools/list ==
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "tools": [
      {
        "name": "PickupCandidates",
        "description": "Predefined operation for the Step 7 MCP spike: one tool, introspection disabled.",
        "inputSchema": {
          "type": "object",
          "properties": {
            "childId": {
              "type": "string"
            },
            "asOf": {
              "anyOf": [
                {
                  "type": "string"
                },
                {
                  "type": "null"
                }
              ]
            }
          },
          "required": [
            "childId"
          ]
        },
        "annotations": {
          "readOnlyHint": true,
          "destructiveHint": false,
          "idempotentHint": true,
          "openWorldHint": true
        }
      }
    ]
  }
}

== tools/call PickupCandidates ==
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"data\":null,\"errors\":[{\"message\":\"UNAUTHENTICATED\",\"locations\":[{\"line\":1,\"column\":67}],\"path\":[\"pickupCandidates\"],\"extensions\":{\"code\":\"UNAUTHENTICATED\",\"stacktrace\":[\"GraphQLError: UNAUTHENTICATED\",\"    at unauthenticated (/Users/user/Desktop/bentley/fridgegraph/src/authz.ts:35:10)\",\"    at requireCaller (/Users/user/Desktop/bentley/fridgegraph/src/authz.ts:41:72)\",\"    at requirePickupAccess (/Users/user/Desktop/bentley/fridgegraph/src/subgraphs/access.ts:121:20)\",\"    at pickupCandidates (/Users/user/Desktop/bentley/fridgegraph/src/subgraphs/access.ts:163:7)\",\"    at field.resolve (/Users/user/Desktop/bentley/fridgegraph/node_modules/@apollo/server/src/utils/schemaInstrumentation.ts:82:22)\",\"    at executeField (/Users/user/Desktop/bentley/fridgegraph/node_modules/graphql/execution/execute.js:733:20)\",\"    at executeFields (/Users/user/Desktop/bentley/fridgegraph/node_modules/graphql/execution/execute.js:653:22)\",\"    at executeOperation (/Users/user/Desktop/bentley/fridgegraph/node_modules/graphql/execution/execute.js:579:14)\",\"    at execute (/Users/user/Desktop/bentley/fridgegraph/node_modules/graphql/execution/execute.js:309:20)\",\"    at executeIncrementally (/Users/user/Desktop/bentley/fridgegraph/node_modules/@apollo/server/dist/esm/incrementalDeliveryPolyfill.js:21:12)\"],\"service\":\"access\"}}],\"extensions\":{\"valueCompletion\":[{\"message\":\"Cannot return null for non-nullable type Candidate\",\"path\":[]}]}}"
      }
    ],
    "isError": true
  }
}

== tools/call introspect (negative control) ==
{
  "jsonrpc": "2.0",
  "id": 4,
  "error": {
    "code": -32602,
    "message": "Tool introspect not found"
  }
}
```
