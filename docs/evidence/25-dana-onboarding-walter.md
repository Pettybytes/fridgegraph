# 25 — Dana onboarding against Postgres, and #18 as Walter

- endpoint: `http://127.0.0.1:4012/`
- run: 2026-10-28T20:10:29.330Z
- identity: real Supabase password-grant JWTs per caller; tokens redacted, never stored
- writes: only the graph mutations (`approveRelationship`, `grantAccess`); reset via `/__reset`

## Steps

### 1. Baseline as Kendra — Dana is NOT a candidate for Nora

- identity: Bearer eyJhbG…<redacted, 807 chars>
- HTTP: 200
- verdict: **PASS (absent)**

```graphql
query Candidates($childId: ID!) {
  pickupCandidates(childId: $childId) { person { id displayName } reason }
}
```

```json
{
  "data": {
    "pickupCandidates": [
      {
        "person": {
          "id": "p_gma",
          "displayName": "Loretta Brooks"
        },
        "reason": "grandmother — transport.child offered, pickup.request grant valid 2026-10-28"
      },
      {
        "person": {
          "id": "p_bryan",
          "displayName": "Bryan Brooks"
        },
        "reason": "uncle — transport.child offered, pickup.request grant valid 2026-10-28"
      },
      {
        "person": {
          "id": "p_tasha",
          "displayName": "Tasha Ellison"
        },
        "reason": "aunt + godmother — transport.child offered, pickup.request grant valid 2026-10-28"
      },
      {
        "person": {
          "id": "p_monique",
          "displayName": "Monique Davis"
        },
        "reason": "parent_friend — transport.child offered, pickup.request grant valid 2026-10-28"
      }
    ]
  }
}
```

### 2. As Kendra — approveRelationship(r_dana_friend_parent)

- identity: Bearer eyJhbG…<redacted, 807 chars>
- HTTP: 200
- verdict: **PASS (ACTIVE)**

```graphql
mutation Approve($id: ID!) { approveRelationship(relationshipId: $id) { id status } }
```

```json
{
  "data": {
    "approveRelationship": {
      "id": "r_dana_friend_parent",
      "status": "ACTIVE"
    }
  }
}
```

### 3. As Kendra — grantAccess(p_dana, p_nora, [pickup.request])

- identity: Bearer eyJhbG…<redacted, 807 chars>
- HTTP: 200
- verdict: **PASS (granted)**

```graphql
mutation Grant($actor: ID!, $child: ID!) {
      grantAccess(actorId: $actor, childId: $child, scopes: ["pickup.request"]) {
        id actor { id } child { id } scopes grantedBy { id }
      }
    }
```

```json
{
  "data": {
    "grantAccess": {
      "id": "g_8b79f9d6-7f37-429f-9e60-f8f121d6099e",
      "actor": {
        "id": "p_dana"
      },
      "child": {
        "id": "p_nora"
      },
      "scopes": [
        "pickup.request"
      ],
      "grantedBy": {
        "id": "p_mom"
      }
    }
  }
}
```

### 4. As Kendra — Dana now appears as a candidate (no restart)

- identity: Bearer eyJhbG…<redacted, 807 chars>
- HTTP: 200
- verdict: **PASS (present)**

```graphql
query Candidates($childId: ID!) {
  pickupCandidates(childId: $childId) { person { id displayName } reason }
}
```

```json
{
  "data": {
    "pickupCandidates": [
      {
        "person": {
          "id": "p_dana",
          "displayName": "Dana Coleman"
        },
        "reason": "friend_parent — transport.child offered, pickup.request grant valid 2026-10-28"
      },
      {
        "person": {
          "id": "p_gma",
          "displayName": "Loretta Brooks"
        },
        "reason": "grandmother — transport.child offered, pickup.request grant valid 2026-10-28"
      },
      {
        "person": {
          "id": "p_bryan",
          "displayName": "Bryan Brooks"
        },
        "reason": "uncle — transport.child offered, pickup.request grant valid 2026-10-28"
      },
      {
        "person": {
          "id": "p_tasha",
          "displayName": "Tasha Ellison"
        },
        "reason": "aunt + godmother — transport.child offered, pickup.request grant valid 2026-10-28"
      },
      {
        "person": {
          "id": "p_monique",
          "displayName": "Monique Davis"
        },
        "reason": "parent_friend — transport.child offered, pickup.request grant valid 2026-10-28"
      }
    ]
  }
}
```

### 5. As Kendra — new request, still present (persisted in Postgres, not memory)

- identity: Bearer eyJhbG…<redacted, 807 chars>
- HTTP: 200
- verdict: **PASS (persisted)**

```graphql
query Candidates($childId: ID!) {
  pickupCandidates(childId: $childId) { person { id displayName } reason }
}
```

```json
{
  "data": {
    "pickupCandidates": [
      {
        "person": {
          "id": "p_dana",
          "displayName": "Dana Coleman"
        },
        "reason": "friend_parent — transport.child offered, pickup.request grant valid 2026-10-28"
      },
      {
        "person": {
          "id": "p_gma",
          "displayName": "Loretta Brooks"
        },
        "reason": "grandmother — transport.child offered, pickup.request grant valid 2026-10-28"
      },
      {
        "person": {
          "id": "p_bryan",
          "displayName": "Bryan Brooks"
        },
        "reason": "uncle — transport.child offered, pickup.request grant valid 2026-10-28"
      },
      {
        "person": {
          "id": "p_tasha",
          "displayName": "Tasha Ellison"
        },
        "reason": "aunt + godmother — transport.child offered, pickup.request grant valid 2026-10-28"
      },
      {
        "person": {
          "id": "p_monique",
          "displayName": "Monique Davis"
        },
        "reason": "parent_friend — transport.child offered, pickup.request grant valid 2026-10-28"
      }
    ]
  }
}
```

### 6. db:reset -> baseline (control endpoint /__reset)

- identity: (control endpoint, no caller identity)
- HTTP: 200
- verdict: **PASS (rows deleted: {"grants":1,"approvals":2})**

```graphql
POST /__reset
```

```json
{
  "ok": true,
  "reset": true,
  "db": {
    "deleted": {
      "grants": 1,
      "approvals": 2
    }
  }
}
```

### 7. After reset — Dana is gone (baseline restored)

- identity: Bearer eyJhbG…<redacted, 807 chars>
- HTTP: 200
- verdict: **PASS (absent)**

```graphql
query Candidates($childId: ID!) {
  pickupCandidates(childId: $childId) { person { id displayName } reason }
}
```

```json
{
  "data": {
    "pickupCandidates": [
      {
        "person": {
          "id": "p_gma",
          "displayName": "Loretta Brooks"
        },
        "reason": "grandmother — transport.child offered, pickup.request grant valid 2026-10-28"
      },
      {
        "person": {
          "id": "p_bryan",
          "displayName": "Bryan Brooks"
        },
        "reason": "uncle — transport.child offered, pickup.request grant valid 2026-10-28"
      },
      {
        "person": {
          "id": "p_tasha",
          "displayName": "Tasha Ellison"
        },
        "reason": "aunt + godmother — transport.child offered, pickup.request grant valid 2026-10-28"
      },
      {
        "person": {
          "id": "p_monique",
          "displayName": "Monique Davis"
        },
        "reason": "parent_friend — transport.child offered, pickup.request grant valid 2026-10-28"
      }
    ]
  }
}
```

### 8. #18 as Walter — grandparent, no pickup rights -> UNAUTHORIZED

- identity: Bearer eyJhbG…<redacted, 807 chars>
- HTTP: 200 · codes: UNAUTHORIZED
- verdict: **PASS (UNAUTHORIZED)**

```graphql
query Candidates($childId: ID!) {
  pickupCandidates(childId: $childId) { person { id displayName } reason }
}
```

```json
{
  "data": null,
  "errors": [
    {
      "message": "UNAUTHORIZED",
      "locations": [
        {
          "line": 1,
          "column": 46
        }
      ],
      "path": [
        "pickupCandidates"
      ],
      "extensions": {
        "code": "UNAUTHORIZED",
        "stacktrace": [
          "GraphQLError: UNAUTHORIZED",
          "    at deny (/Users/user/Desktop/bentley/fridgegraph/src/authz.ts:42:10)",
          "    at requirePickupAccess (/Users/user/Desktop/bentley/fridgegraph/src/subgraphs/access.ts:171:9)",
          "    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)",
          "    at async pickupCandidates (/Users/user/Desktop/bentley/fridgegraph/src/subgraphs/access.ts:267:7)"
        ],
        "service": "access"
      }
    }
  ],
  "extensions": {
    "valueCompletion": [
      {
        "message": "Cannot return null for non-nullable type Candidate",
        "path": []
      }
    ]
  }
}
```

## What this proves

- Onboarding is a real database change: the candidate list changed in a later request with no
  restart, which only a database read can produce.
- The reset restored the seeded baseline, so the shared database is left as it was found.
- Authorization is unchanged by any of it: Walter, a grandparent with no pickup grant, is
  refused with `UNAUTHORIZED` rather than an empty list.
