# As Dana (Jax's parent): supervisionCandidates(Jax) -> [] (authorized, none exist)

- endpoint: `http://127.0.0.1:4010/`
- x-demo-user: `p_dana`  (INSECURE dev header)
- x-demo-date: `2026-10-26`
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
