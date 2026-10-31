# As Daniel: carePlan allowed (grant window covers today)

- endpoint: `http://127.0.0.1:4012/`
- identity: Bearer eyJhbG…<redacted, 822 chars>  (verified Supabase JWT; token redacted, never stored)
- x-demo-date: `(not sent)`  (test clock; honoured only while DEMO_CLOCK=1)
- note: Daniel holds careplan.read for a window that covers the demo dates (2026-10-20..2026-11-30). No date header is sent, so this does not depend on DEMO_CLOCK.
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
