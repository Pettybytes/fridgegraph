# As Ray (Jax's father): Jax's carePlan -> ALLOWED (parent has full access)

- endpoint: `http://127.0.0.1:4010/`
- x-demo-user: `p_ray`  (INSECURE dev header)
- x-demo-date: `2026-10-26`
- note: Brief expected UNAUTHORIZED. A parent of the child has full access, so this is allowed.
- HTTP status: 200

## Query

```graphql
query { carePlan(childId: "p_jax") { text } }
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
      "text": "Mild asthma. Inhaler in the front pocket of the school bag."
    }
  }
}
```
