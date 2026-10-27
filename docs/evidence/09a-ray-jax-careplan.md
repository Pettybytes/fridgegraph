# Ray Coleman (parent) has full access to Jax's carePlan

- endpoint: `http://127.0.0.1:4010/`
- identity: Bearer eyJhbG…<redacted, 803 chars>  (verified Supabase JWT; token redacted, never stored)
- x-demo-date: `2026-10-26`  (test clock; honoured only while DEMO_CLOCK=1)
- note: Ray Coleman is Jax's parent. A parent of the child has full access, so this is correct.
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
