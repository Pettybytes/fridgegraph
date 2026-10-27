# As Gary: busRoster allowed (transport.read)

- endpoint: `http://127.0.0.1:4010/`
- x-demo-user: `p_holt`  (INSECURE dev header)
- x-demo-date: `2026-10-26`
- HTTP status: 200

## Query

```graphql
query { busRoster(childId: "p_nora", date: "2026-10-26") { route riding date child { id } } }
```

## Variables

```json
{}
```

## Response

```json
{
  "data": {
    "busRoster": {
      "route": "Route 14",
      "riding": true,
      "date": "2026-10-26",
      "child": {
        "id": "p_nora"
      }
    }
  }
}
```
