# approverFor on Thursday Oct 29 -> Andre, Kendra FYI

- endpoint: `http://127.0.0.1:4012/`
- identity: Bearer eyJhbG…<redacted, 823 chars>  (verified Supabase JWT; token redacted, never stored)
- x-demo-date: `2026-10-26`  (test clock; honoured only while DEMO_CLOCK=1)
- HTTP status: 200

## Query

```graphql
query { approverFor(childId: "p_nora", date: "2026-10-29") { approver { displayName } fyiParents { displayName } } }
```

## Variables

```json
{}
```

## Response

```json
{
  "data": {
    "approverFor": {
      "approver": {
        "displayName": "Andre Ellison"
      },
      "fyiParents": [
        {
          "displayName": "Kendra Ellison"
        }
      ]
    }
  }
}
```
