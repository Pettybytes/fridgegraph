# After grant: Dana appears once as a pickupCandidate with the Pacifica

- endpoint: `http://127.0.0.1:4010/`
- x-demo-user: `p_mom`  (INSECURE dev header)
- x-demo-date: `2026-10-26`
- HTTP status: 200

## Query

```graphql
query {
  pickupCandidates(childId: "p_nora", asOf: "2026-10-26") {
    person { displayName vehicles { year make model color plate } }
    reason
  }
  danaOnly: person(id: "p_dana") { displayName vehicles { year make model color plate } }
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
    "pickupCandidates": [
      {
        "person": {
          "displayName": "Loretta Brooks",
          "vehicles": [
            {
              "year": 2016,
              "make": "Buick",
              "model": "Enclave",
              "color": "white",
              "plate": "DEMO-103"
            }
          ]
        },
        "reason": "grandmother — transport.child offered, pickup.request grant valid 2026-10-26"
      },
      {
        "person": {
          "displayName": "Bryan Brooks",
          "vehicles": [
            {
              "year": 2020,
              "make": "Dodge",
              "model": "Charger",
              "color": "blue",
              "plate": "DEMO-104"
            }
          ]
        },
        "reason": "uncle — transport.child offered, pickup.request grant valid 2026-10-26"
      },
      {
        "person": {
          "displayName": "Tasha Ellison",
          "vehicles": [
            {
              "year": 2022,
              "make": "Toyota",
              "model": "RAV4",
              "color": "red",
              "plate": "DEMO-105"
            }
          ]
        },
        "reason": "aunt + godmother — transport.child offered, pickup.request grant valid 2026-10-26"
      },
      {
        "person": {
          "displayName": "Monique Davis",
          "vehicles": [
            {
              "year": 2023,
              "make": "Kia",
              "model": "Telluride",
              "color": "silver",
              "plate": "DEMO-106"
            }
          ]
        },
        "reason": "parent_friend — transport.child offered, pickup.request grant valid 2026-10-26"
      },
      {
        "person": {
          "displayName": "Dana Coleman",
          "vehicles": [
            {
              "year": 2018,
              "make": "Chrysler",
              "model": "Pacifica",
              "color": "silver",
              "plate": "DEMO-110"
            }
          ]
        },
        "reason": "friend_parent — transport.child offered, pickup.request grant valid 2026-10-26"
      }
    ],
    "danaOnly": {
      "displayName": "Dana Coleman",
      "vehicles": [
        {
          "year": 2018,
          "make": "Chrysler",
          "model": "Pacifica",
          "color": "silver",
          "plate": "DEMO-110"
        }
      ]
    }
  }
}
```
