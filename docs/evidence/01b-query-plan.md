# As Kendra: query plan for the composed operation

- endpoint: `http://127.0.0.1:4010/`
- identity: Bearer eyJhbG…<redacted, 807 chars>  (verified Supabase JWT; token redacted, never stored)
- x-demo-date: `2026-10-26`  (test clock; honoured only while DEMO_CLOCK=1)
- extra headers: `{"apollo-expose-query-plan":"true"}`
- HTTP status: 200

## Query

```graphql
query { pickupCandidates(childId: "p_nora", asOf: "2026-10-26") { person { displayName } reason } }
```

## Variables

```json
{}
```

## Response

```json
{
  "data": {
    "pickupCandidates": [
      {
        "person": {
          "displayName": "Loretta Brooks"
        },
        "reason": "grandmother — transport.child offered, pickup.request grant valid 2026-10-26"
      },
      {
        "person": {
          "displayName": "Bryan Brooks"
        },
        "reason": "uncle — transport.child offered, pickup.request grant valid 2026-10-26"
      },
      {
        "person": {
          "displayName": "Tasha Ellison"
        },
        "reason": "aunt + godmother — transport.child offered, pickup.request grant valid 2026-10-26"
      },
      {
        "person": {
          "displayName": "Monique Davis"
        },
        "reason": "parent_friend — transport.child offered, pickup.request grant valid 2026-10-26"
      }
    ]
  },
  "extensions": {
    "apolloQueryPlan": {
      "object": {
        "kind": "QueryPlan",
        "node": {
          "kind": "Sequence",
          "nodes": [
            {
              "kind": "Fetch",
              "serviceName": "access",
              "variableUsages": [],
              "operation": "{ pickupCandidates(asOf: \"2026-10-26\", childId: \"p_nora\") { person { __typename id } reason } }",
              "operationName": null,
              "operationKind": "query",
              "id": null,
              "inputRewrites": null,
              "outputRewrites": null,
              "contextRewrites": null,
              "schemaAwareHash": "032607b7c97a9c1ee83906fad64c1b865554a4e78e73c4cfb09aefcb55fb5eff",
              "authorization": {
                "is_authenticated": false,
                "scopes": [],
                "policies": []
              }
            },
            {
              "kind": "Flatten",
              "path": [
                "pickupCandidates",
                "@",
                "person"
              ],
              "node": {
                "kind": "Fetch",
                "serviceName": "village",
                "requires": [
                  {
                    "kind": "InlineFragment",
                    "typeCondition": "Person",
                    "selections": [
                      {
                        "kind": "Field",
                        "name": "__typename"
                      },
                      {
                        "kind": "Field",
                        "name": "id"
                      }
                    ]
                  }
                ],
                "variableUsages": [],
                "operation": "query($representations: [_Any!]!) { _entities(representations: $representations) { ... on Person { displayName } } }",
                "operationName": null,
                "operationKind": "query",
                "id": null,
                "inputRewrites": null,
                "outputRewrites": null,
                "contextRewrites": null,
                "schemaAwareHash": "572a6c3707bf51f9ec6e9ea973a52e376afa63c6fc5accc04549526dc61af188",
                "authorization": {
                  "is_authenticated": false,
                  "scopes": [],
                  "policies": []
                }
              }
            }
          ]
        }
      },
      "text": "QueryPlan {\n  Sequence {\n    Fetch(service: \"access\") {\n      {\n        pickupCandidates(asOf: \"2026-10-26\", childId: \"p_nora\") {\n          person {\n            __typename\n            id\n          }\n          reason\n        }\n      }\n    },\n    Flatten(path: \"pickupCandidates.@.person\") {\n      Fetch(service: \"village\") {\n        {\n          ... on Person {\n            __typename\n            id\n          }\n        } =>\n        {\n          ... on Person {\n            displayName\n          }\n        }\n      },\n    },\n  },\n}"
    }
  }
}
```
