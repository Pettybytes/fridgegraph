# approverFor on Thursday Oct 29 -> Andre, Kendra FYI

- endpoint: `http://127.0.0.1:4010/`
- x-demo-user: `p_mom`  (INSECURE dev header)
- x-demo-date: `2026-10-26`
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
