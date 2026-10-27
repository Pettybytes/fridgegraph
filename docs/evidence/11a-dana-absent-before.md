# Before approving: Dana is not a pickupCandidate for Nora

- endpoint: `http://127.0.0.1:4010/`
- x-demo-user: `p_mom`  (INSECURE dev header)
- x-demo-date: `2026-10-26`
- HTTP status: 200

## Query

```graphql
query { pickupCandidates(childId: "p_nora", asOf: "2026-10-26") { person { displayName } } }
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
        }
      },
      {
        "person": {
          "displayName": "Bryan Brooks"
        }
      },
      {
        "person": {
          "displayName": "Tasha Ellison"
        }
      },
      {
        "person": {
          "displayName": "Monique Davis"
        }
      }
    ]
  }
}
```
