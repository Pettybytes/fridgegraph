# Query plan for evidence #1 (full Kendra view)

- endpoint: `http://127.0.0.1:4010/`
- identity: Bearer eyJhbG…<redacted, 807 chars>  (verified Supabase JWT; token redacted)
- x-demo-date: `2026-10-26` (test clock)
- Router: 2.18.0

## Fetch order (traversal of `extensions.apolloQueryPlan`)

```
Parallel
 Fetch -> village
 Fetch -> schedule
 Sequence
  Fetch -> activities
  Flatten [practices.@.group]
  Fetch -> village
 Sequence
  Fetch -> access
  Parallel
   Flatten [pickupCandidates.@.person]
   Fetch -> village
   Flatten [pickupCandidates.@.person]
   Fetch -> transport
   Flatten [approverFor.fyiParents.@]
   Fetch -> village
   Flatten [approverFor.approver]
   Fetch -> village
```

## Raw plan

```json
{
  "apolloQueryPlan": {
    "object": {
      "kind": "QueryPlan",
      "node": {
        "kind": "Parallel",
        "nodes": [
          {
            "kind": "Fetch",
            "serviceName": "village",
            "variableUsages": [
              "childId",
              "date"
            ],
            "operation": "query KendraView__village__0($childId: ID!, $date: String!) { child(id: $childId) { id person { displayName birthDate age(asOf: $date) } } }",
            "operationName": "KendraView__village__0",
            "operationKind": "query",
            "id": null,
            "inputRewrites": null,
            "outputRewrites": null,
            "contextRewrites": null,
            "schemaAwareHash": "6f4df334d18583269c57ae5f1e7735fd9f4ffe34802c8dc902da078c725a5506",
            "authorization": {
              "is_authenticated": false,
              "scopes": [],
              "policies": []
            }
          },
          {
            "kind": "Fetch",
            "serviceName": "schedule",
            "variableUsages": [
              "childId",
              "date"
            ],
            "operation": "query KendraView__schedule__1($childId: ID!, $date: String!) { events(childId: $childId, date: $date) { title start end location } }",
            "operationName": "KendraView__schedule__1",
            "operationKind": "query",
            "id": null,
            "inputRewrites": null,
            "outputRewrites": null,
            "contextRewrites": null,
            "schemaAwareHash": "94bcbcc989c8ec315d935e630bdfb10b3209772259d2ffd4113edf154c3d57c6",
            "authorization": {
              "is_authenticated": false,
              "scopes": [],
              "policies": []
            }
          },
          {
            "kind": "Sequence",
            "nodes": [
              {
                "kind": "Fetch",
                "serviceName": "activities",
                "variableUsages": [
                  "childId",
                  "date"
                ],
                "operation": "query KendraView__activities__2($childId: ID!, $date: String!) { practices(childId: $childId, date: $date) { start location group { __typename id } } }",
                "operationName": "KendraView__activities__2",
                "operationKind": "query",
                "id": null,
                "inputRewrites": null,
                "outputRewrites": null,
                "contextRewrites": null,
                "schemaAwareHash": "f2ff8b3e5efd4ec8ed8a05b7a41edb25401dc56cb989efe790a93e1f4e3668ff",
                "authorization": {
                  "is_authenticated": false,
                  "scopes": [],
                  "policies": []
                }
              },
              {
                "kind": "Flatten",
                "path": [
                  "practices",
                  "@",
                  "group"
                ],
                "node": {
                  "kind": "Fetch",
                  "serviceName": "village",
                  "requires": [
                    {
                      "kind": "InlineFragment",
                      "typeCondition": "Group",
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
                  "operation": "query KendraView__village__3($representations: [_Any!]!) { _entities(representations: $representations) { ... on Group { name } } }",
                  "operationName": "KendraView__village__3",
                  "operationKind": "query",
                  "id": null,
                  "inputRewrites": null,
                  "outputRewrites": null,
                  "contextRewrites": null,
                  "schemaAwareHash": "3c696ee4d0062208e960cd3f34649409e7f1b8ce4ef3c86a70085b7e8876d4a0",
                  "authorization": {
                    "is_authenticated": false,
                    "scopes": [],
                    "policies": []
                  }
                }
              }
            ]
          },
          {
            "kind": "Sequence",
            "nodes": [
              {
                "kind": "Fetch",
                "serviceName": "access",
                "variableUsages": [
                  "childId",
                  "date"
                ],
                "operation": "query KendraView__access__4($childId: ID!, $date: String!) { approverFor(childId: $childId, date: $date) { approver { ...a } fyiParents { ...a } } pickupCandidates(asOf: $date, childId: $childId) { person { ...a } reason authorization availability } } fragment a on Person { __typename id }",
                "operationName": "KendraView__access__4",
                "operationKind": "query",
                "id": null,
                "inputRewrites": null,
                "outputRewrites": null,
                "contextRewrites": null,
                "schemaAwareHash": "5105332ddeaeca9e440219af41ce866cc251646bf0745b62176cbd61dc9dc505",
                "authorization": {
                  "is_authenticated": false,
                  "scopes": [],
                  "policies": []
                }
              },
              {
                "kind": "Parallel",
                "nodes": [
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
                      "variableUsages": [
                        "childId"
                      ],
                      "operation": "query KendraView__village__5($representations: [_Any!]!, $childId: ID!) { _entities(representations: $representations) { ... on Person { displayName contactMethods(childId: $childId) { channel value preferred verified } } } }",
                      "operationName": "KendraView__village__5",
                      "operationKind": "query",
                      "id": null,
                      "inputRewrites": null,
                      "outputRewrites": null,
                      "contextRewrites": null,
                      "schemaAwareHash": "efe09695c31fbcc5940a2c491fb90538ace65064cd25583773e470f8973df6ac",
                      "authorization": {
                        "is_authenticated": false,
                        "scopes": [],
                        "policies": []
                      }
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
                      "serviceName": "transport",
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
                      "operation": "query KendraView__transport__6($representations: [_Any!]!) { _entities(representations: $representations) { ... on Person { vehicles { year make model color plate } } } }",
                      "operationName": "KendraView__transport__6",
                      "operationKind": "query",
                      "id": null,
                      "inputRewrites": null,
                      "outputRewrites": null,
                      "contextRewrites": null,
                      "schemaAwareHash": "c8b910180fede11110e2e92c410711f6e0f2879d198ec9bec80bdc1f5e624f65",
                      "authorization": {
                        "is_authenticated": false,
                        "scopes": [],
                        "policies": []
                      }
                    }
                  },
                  {
                    "kind": "Flatten",
                    "path": [
                      "approverFor",
                      "fyiParents",
                      "@"
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
                      "operation": "query KendraView__village__7($representations: [_Any!]!) { _entities(representations: $representations) { ... on Person { displayName } } }",
                      "operationName": "KendraView__village__7",
                      "operationKind": "query",
                      "id": null,
                      "inputRewrites": null,
                      "outputRewrites": null,
                      "contextRewrites": null,
                      "schemaAwareHash": "17bdcf8a4516bcc602841cbb82c93ce9dddbb1cdeb9dc49814520a5e9d051d19",
                      "authorization": {
                        "is_authenticated": false,
                        "scopes": [],
                        "policies": []
                      }
                    }
                  },
                  {
                    "kind": "Flatten",
                    "path": [
                      "approverFor",
                      "approver"
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
                      "operation": "query KendraView__village__8($representations: [_Any!]!) { _entities(representations: $representations) { ... on Person { displayName } } }",
                      "operationName": "KendraView__village__8",
                      "operationKind": "query",
                      "id": null,
                      "inputRewrites": null,
                      "outputRewrites": null,
                      "contextRewrites": null,
                      "schemaAwareHash": "f38c5d824061a8c1f4c970d8bb51fe2995abdaf3d0b87f097f64be512642f17d",
                      "authorization": {
                        "is_authenticated": false,
                        "scopes": [],
                        "policies": []
                      }
                    }
                  }
                ]
              }
            ]
          }
        ]
      }
    },
    "text": "QueryPlan {\n  Parallel {\n    Fetch(service: \"village\") {\n      {\n        child(id: $childId) {\n          id\n          person {\n            displayName\n            birthDate\n            age(asOf: $date)\n          }\n        }\n      }\n    },\n    Fetch(service: \"schedule\") {\n      {\n        events(childId: $childId, date: $date) {\n          title\n          start\n          end\n          location\n        }\n      }\n    },\n    Sequence {\n      Fetch(service: \"activities\") {\n        {\n          practices(childId: $childId, date: $date) {\n            start\n            location\n            group {\n              __typename\n              id\n            }\n          }\n        }\n      },\n      Flatten(path: \"practices.@.group\") {\n        Fetch(service: \"village\") {\n          {\n            ... on Group {\n              __typename\n              id\n            }\n          } =>\n          {\n            ... on Group {\n              name\n            }\n          }\n        },\n      },\n    },\n    Sequence {\n      Fetch(service: \"access\") {\n        {\n          approverFor(childId: $childId, date: $date) {\n            approver {\n              ...a\n            }\n            fyiParents {\n              ...a\n            }\n          }\n          pickupCandidates(asOf: $date, childId: $childId) {\n            person {\n              ...a\n            }\n            reason\n            authorization\n            availability\n          }\n        }\n\n        fragment a on Person {\n          __typename\n          id\n        }\n      },\n      Parallel {\n        Flatten(path: \"pickupCandidates.@.person\") {\n          Fetch(service: \"village\") {\n            {\n              ... on Person {\n                __typename\n                id\n              }\n            } =>\n            {\n              ... on Person {\n                displayName\n                contactMethods(childId: $childId) {\n                  channel\n                  value\n                  preferred\n                  verified\n                }\n              }\n            }\n          },\n        },\n        Flatten(path: \"pickupCandidates.@.person\") {\n          Fetch(service: \"transport\") {\n            {\n              ... on Person {\n                __typename\n                id\n              }\n            } =>\n            {\n              ... on Person {\n                vehicles {\n                  year\n                  make\n                  model\n                  color\n                  plate\n                }\n              }\n            }\n          },\n        },\n        Flatten(path: \"approverFor.fyiParents.@\") {\n          Fetch(service: \"village\") {\n            {\n              ... on Person {\n                __typename\n                id\n              }\n            } =>\n            {\n              ... on Person {\n                displayName\n              }\n            }\n          },\n        },\n        Flatten(path: \"approverFor.approver\") {\n          Fetch(service: \"village\") {\n            {\n              ... on Person {\n                __typename\n                id\n              }\n            } =>\n            {\n              ... on Person {\n                displayName\n              }\n            }\n          },\n        },\n      },\n    },\n  },\n}"
  }
}
```
