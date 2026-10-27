# supervisionCandidates: Leo excluded at 15, included at 16

- endpoint: `http://127.0.0.1:4010/`
- x-demo-user: `p_mom`  (INSECURE dev header)
- x-demo-date: `2026-10-26`
- HTTP status: 200

## Query

```graphql
query {
  at1026: supervisionCandidates(childId: "p_nora", asOf: "2026-10-26") { person { displayName } reason }
  at1029: supervisionCandidates(childId: "p_nora", asOf: "2026-10-29") { person { displayName } reason }
}
```

## Variables

```json
{}
```

## Response

```json
{
  "data": {
    "at1026": [
      {
        "person": {
          "displayName": "Priya Nair"
        },
        "reason": "sitter — supervise offer, supervise.request grant valid 2026-10-26"
      }
    ],
    "at1029": [
      {
        "person": {
          "displayName": "Leo Ellison"
        },
        "reason": "brother — age 16 at 2026-10-29 meets sibling_supervision_min_age 16"
      },
      {
        "person": {
          "displayName": "Priya Nair"
        },
        "reason": "sitter — supervise offer, supervise.request grant valid 2026-10-29"
      }
    ]
  }
}
```
