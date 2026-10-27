# As Gloria: pickupCandidates -> empty

- endpoint: `http://127.0.0.1:4010/`
- x-demo-user: `p_gloria`  (INSECURE dev header)
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
    "pickupCandidates": []
  }
}
```
