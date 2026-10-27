# As Kendra: grantAccess Dana pickup.request until Nov 30

- endpoint: `http://127.0.0.1:4010/`
- x-demo-user: `p_mom`  (INSECURE dev header)
- x-demo-date: `2026-10-26`
- HTTP status: 200

## Query

```graphql
mutation {
  grantAccess(actorId: "p_dana", childId: "p_nora", scopes: ["pickup.request"], validUntil: "2026-11-30") {
    id actor { displayName } scopes validFrom validUntil grantedBy { displayName }
  }
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
    "grantAccess": {
      "id": "g_new_1",
      "actor": {
        "displayName": "Dana Coleman"
      },
      "scopes": [
        "pickup.request"
      ],
      "validFrom": null,
      "validUntil": "2026-11-30",
      "grantedBy": {
        "displayName": "Kendra Ellison"
      }
    }
  }
}
```
