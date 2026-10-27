# MCP spike: one tool from one operation, introspection OFF

- MCP endpoint: `http://127.0.0.1:5050/mcp` (Streamable HTTP)
- Apollo MCP Server: v2.1.0 (Rover plugin via `rover dev --mcp`)
- Router: v2.18.0 (2.x, not the 3.0 preview), composed with Federation 2.9.0
- Config: `.apollo/mcp.local.yaml` (schema local, operations local, introspection.execute/introspect/search/validate all disabled)
- Tool: `PickupCandidates` from `ops/PickupCandidates.graphql`
- Identity: `x-demo-user: p_mom`, `x-demo-date: 2026-10-26` pinned as static headers (INSECURE, spike only)

## Raw protocol transcript

```
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
        "text": "{\"data\":{\"pickupCandidates\":[{\"person\":{\"id\":\"p_gma\",\"displayName\":\"Loretta Brooks\",\"contactMethods\":[{\"channel\":\"CALL\",\"value\":\"+1-555-0103\",\"preferred\":true,\"verified\":true}],\"vehicles\":[{\"year\":2016,\"make\":\"Buick\",\"model\":\"Enclave\",\"color\":\"white\",\"plate\":\"DEMO-103\"}]},\"reason\":\"grandmother — transport.child offered, pickup.request grant valid 2026-10-26\",\"authorization\":\"AUTHORIZED\",\"availability\":\"UNKNOWN\"},{\"person\":{\"id\":\"p_bryan\",\"displayName\":\"Bryan Brooks\",\"contactMethods\":[{\"channel\":\"SMS\",\"value\":\"+1-555-0104\",\"preferred\":true,\"verified\":true}],\"vehicles\":[{\"year\":2020,\"make\":\"Dodge\",\"model\":\"Charger\",\"color\":\"blue\",\"plate\":\"DEMO-104\"}]},\"reason\":\"uncle — transport.child offered, pickup.request grant valid 2026-10-26\",\"authorization\":\"AUTHORIZED\",\"availability\":\"UNKNOWN\"},{\"person\":{\"id\":\"p_tasha\",\"displayName\":\"Tasha Ellison\",\"contactMethods\":[{\"channel\":\"SMS\",\"value\":\"+1-555-0107\",\"preferred\":true,\"verified\":true}],\"vehicles\":[{\"year\":2022,\"make\":\"Toyota\",\"model\":\"RAV4\",\"color\":\"red\",\"plate\":\"DEMO-105\"}]},\"reason\":\"aunt + godmother — transport.child offered, pickup.request grant valid 2026-10-26\",\"authorization\":\"AUTHORIZED\",\"availability\":\"UNKNOWN\"},{\"person\":{\"id\":\"p_monique\",\"displayName\":\"Monique Davis\",\"contactMethods\":[{\"channel\":\"SMS\",\"value\":\"+1-555-0108\",\"preferred\":true,\"verified\":true}],\"vehicles\":[{\"year\":2023,\"make\":\"Kia\",\"model\":\"Telluride\",\"color\":\"silver\",\"plate\":\"DEMO-106\"}]},\"reason\":\"parent_friend — transport.child offered, pickup.request grant valid 2026-10-26\",\"authorization\":\"AUTHORIZED\",\"availability\":\"UNKNOWN\"}]}}"
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

## Reading

- `tools/list` returns exactly one tool. No discovery tool exists.
- `tools/call` returns four live candidates with contacts and vehicles, fetched through the router by the MCP server, resolved across village + access + transport subgraphs.
- The negative control (`tools/call introspect`) fails with `-32602 Tool introspect not found`: the model cannot introspect the schema or invent fields.
