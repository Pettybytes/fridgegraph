# FridgeGraph schema plan (Milestone 1)

One shared graph. Seven subgraphs, one in-memory store. Each subgraph **writes only its own
tables**; in-process reads across tables are allowed (the store is replaced by Supabase later).

## Ownership

### village (port 4001)
| Type | Fields |
| --- | --- |
| `Person` `@key(id)` | `displayName` (full name), `birthDate`, `age(asOf: String): Int!` (computed, never stored) |
| `Child` `@key(id)` | `person` |
| `Village` | `id`, `name` |
| `Household` `@key(id)` | `id`, `village` |
| `HouseholdMember` | `person`, `household`, `role: String` |
| `Relationship` | `id`, `from: Person`, `to: Child`, `type: String`, `status`, `createdAt`, `history[]` |
| `ContactMethod` | `person`, `channel: CALL\|SMS\|EMAIL`, `value`, `preferred`, `verified` |
| `Capability` | `person`, `name: String`, `conditions: String` — what someone **offers**, never permission |
| `Group` `@key(id)` | `id`, `name`, `kind: String` |
| `Membership` | `person`, `group`, `role: String` |
| `Goal` | `child`, `title`, `owner`, `proposedBy`, `horizon`, `status` |
| `CarePlan` | `child`, `text` |

Mutation: `approveRelationship(relationshipId)` — DEV SHORTCUT, skips invite + contact verification.

### access (port 4002)
`Grant(id, actor, child, scopes: [String], validFrom, validUntil, grantedBy)`,
`Approval(id, approver, subjectType, subjectId, decision, at)`,
`HouseholdPolicy(household, rule: String, value: String)`,
`ParentingSchedule(child, parent, weekdays)`.

Derived queries (access owns "who is authorized"):
- `pickupCandidates(childId, asOf): [Candidate]`
- `supervisionCandidates(childId, asOf): [Candidate]`
- `approverFor(childId, date): { approver: Person, fyiParents: [Person] }`

`Candidate { person; reason; authorization: AUTHORIZED; availability }`.

Mutations: `grantAccess(actorId, childId, scopes, validFrom, validUntil)`, `revokeGrant(id)`.

### coordination (port 4003) — schema only tonight
`CoordinationJob(id, idempotencyKey, type: PICKUP|INVITATION|ONBOARDING, child, status, version)`,
`Attempt`, `InformationRequest`, `Confirmation`. All resolvers return empty lists.

### schedule (port 4004)
`Event(child, title, start, end, location)`.

### school (port 4005)
`SchoolReport(child, kind, text, at)`, `PermissionSlip(child, title, signed)`.

### transport (port 4006)
`BusRoster(date, child, route, riding)`, `Vehicle(id, owner: Person, year, make, model, color, plate)`,
plus the entity field `Person.vehicles` contributed by this subgraph.

### activities (port 4007)
`Practice(group, start, location)`, `GroupEvent(group, kind, text, at)`.

## Enums

```
Relationship.status: DISCOVERED | INTRODUCED | VERIFIED | APPROVED | ACTIVE | EXPIRED | REVOKED
Availability:        UNKNOWN | CONTACTED | CONFIRMED | DECLINED   # tonight everything is UNKNOWN
```

Relationship **types**, capability **names**, scope **names**, group **kinds** and policy **rules**
are plain strings in data, never enums — they are village data, not graph vocabulary.

## Scope table (enforced per resolver, never at the router)

| Field | Scope |
| --- | --- |
| `Event`, `Practice` | `schedule.read` |
| `BusRoster` | `transport.read` |
| `Goal` (status `APPROVED` only) | `goals.read` |
| `CarePlan` | `careplan.read` |
| `SchoolReport`, `PermissionSlip` | `school.read` |
| other people's `ContactMethod` | `contacts.read` |
| `Vehicle` of a pickupCandidate | `pickup.verify` |

Parents of the child have full access. A `PROPOSED` goal is visible to parents only. Anyone may
read their own vehicle and own contacts. Being a pickupCandidate grants nothing extra; a
relationship without a grant grants nothing. Denied field → `null` + error code `UNAUTHORIZED`.
Unknown caller → deny.
