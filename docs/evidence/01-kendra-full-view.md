# As Kendra: Nora, today's schedule, pickupCandidates (contacts + vehicles), approverFor

- endpoint: `http://127.0.0.1:4012/`
- identity: Bearer eyJhbG…<redacted, 823 chars>  (verified Supabase JWT; token redacted, never stored)
- x-demo-date: `2026-10-26`  (test clock; honoured only while DEMO_CLOCK=1)
- HTTP status: 200

## Query

```graphql
query KendraView($childId: ID!, $date: String!) {
  child(id: $childId) {
    id
    person { displayName birthDate age(asOf: $date) }
  }
  events(childId: $childId, date: $date) { title start end location }
  practices(childId: $childId, date: $date) { start location group { name } }
  approverFor(childId: $childId, date: $date) {
    approver { displayName }
    fyiParents { displayName }
  }
  pickupCandidates(childId: $childId, asOf: $date) {
    person {
      displayName
      contactMethods(childId: $childId) { channel value preferred verified }
      vehicles { year make model color plate }
    }
    reason
    authorization
    availability
  }
}
```

## Variables

```json
{
  "childId": "p_nora",
  "date": "2026-10-26"
}
```

## Response

```json
{
  "data": {
    "child": {
      "id": "p_nora",
      "person": {
        "displayName": "Nora Ellison",
        "birthDate": "2018-03-14",
        "age": 8
      }
    },
    "events": [
      {
        "title": "School",
        "start": "2026-10-26T08:15:00",
        "end": "2026-10-26T15:00:00",
        "location": "Room 12, Lincoln Elementary"
      }
    ],
    "practices": [
      {
        "start": "2026-10-26T17:30:00",
        "location": "Field 2",
        "group": {
          "name": "Tigers U9 soccer"
        }
      }
    ],
    "approverFor": {
      "approver": {
        "displayName": "Kendra Ellison"
      },
      "fyiParents": [
        {
          "displayName": "Andre Ellison"
        }
      ]
    },
    "pickupCandidates": [
      {
        "person": {
          "displayName": "Loretta Brooks",
          "contactMethods": [
            {
              "channel": "CALL",
              "value": "+1-313-555-0103",
              "preferred": true,
              "verified": true
            }
          ],
          "vehicles": []
        },
        "reason": "grandmother — transport.child offered, pickup.request grant valid 2026-10-26",
        "authorization": "AUTHORIZED",
        "availability": "UNKNOWN"
      },
      {
        "person": {
          "displayName": "Bryan Brooks",
          "contactMethods": [
            {
              "channel": "SMS",
              "value": "+1-313-555-0104",
              "preferred": true,
              "verified": true
            }
          ],
          "vehicles": []
        },
        "reason": "uncle — transport.child offered, pickup.request grant valid 2026-10-26",
        "authorization": "AUTHORIZED",
        "availability": "UNKNOWN"
      },
      {
        "person": {
          "displayName": "Tasha Ellison",
          "contactMethods": [
            {
              "channel": "SMS",
              "value": "+1-313-555-0107",
              "preferred": true,
              "verified": true
            }
          ],
          "vehicles": []
        },
        "reason": "aunt + godmother — transport.child offered, pickup.request grant valid 2026-10-26",
        "authorization": "AUTHORIZED",
        "availability": "UNKNOWN"
      },
      {
        "person": {
          "displayName": "Monique Davis",
          "contactMethods": [
            {
              "channel": "SMS",
              "value": "+1-313-555-0108",
              "preferred": true,
              "verified": true
            }
          ],
          "vehicles": []
        },
        "reason": "parent_friend — transport.child offered, pickup.request grant valid 2026-10-26",
        "authorization": "AUTHORIZED",
        "availability": "UNKNOWN"
      }
    ]
  }
}
```
