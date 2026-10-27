# As Daniel (grant valid only Oct 26): carePlan allowed

- endpoint: `http://127.0.0.1:4010/`
- x-demo-user: `p_okafor`  (INSECURE dev header)
- x-demo-date: `2026-10-26`
- HTTP status: 200

## Query

```graphql
query { carePlan(childId: "p_nora") { text } }
```

## Variables

```json
{}
```

## Response

```json
{
  "data": {
    "carePlan": {
      "text": "Peanut allergy. Epi-pen in right backpack pocket."
    }
  }
}
```
