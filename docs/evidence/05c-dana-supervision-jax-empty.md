# As Dana (Jax's parent): supervisionCandidates(Jax) -> [] (authorized, none exist)

- endpoint: `http://127.0.0.1:4010/`
- identity: Bearer eyJhbG…<redacted, 820 chars>  (verified Supabase JWT; token redacted, never stored)
- x-demo-date: `2026-10-26`  (test clock; honoured only while DEMO_CLOCK=1)
- note: Authorized caller with no candidates returns an empty list, not an error.
- HTTP status: 200

## Query

```graphql
query { supervisionCandidates(childId: "p_jax", asOf: "2026-10-26") { person { displayName } } }
```

## Variables

```json
{}
```

## Response

```json
{
  "data": {
    "supervisionCandidates": []
  }
}
```
