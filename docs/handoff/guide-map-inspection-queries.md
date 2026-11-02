# Demo-guide map inspection — prepared queries (NOT EXECUTED)

**Status: PREPARED ONLY. None of these queries has been run.** They execute only inside a freshly
reserved window, after the reservation is posted and the stack verified.

**Why this file exists.** The UI deliberately refuses the guide on the map surface. That UI refusal is
a product decision and must not be read as evidence about the backend. This pack asks the **backend**
what it returns to a guide token, and reports those responses independently of what the UI renders.

**Corrections applied (2026-11-02)** — three claims in the first draft were wrong and are fixed here:
`recorded_places` is **household**-scoped, not child-scoped; the geometry helper is
`place_route_geometry_for(p_child, p_place)`; and the function the map resolver actually calls is
`village_places_for_child(p_child)`, which the first draft omitted entirely.

**Hard rules for the run**

- Report **backend responses separately** from the UI's intentional guide refusal. Never merge them.
- **Do not remove the UI guard.**
- **Read-only.** No scopes, homes, coordinates or permission changes.
- No `db push`, no reset, no seed.
- **An empty or refused response is a result to interpret, not automatically a failure.**

## Verification before execution (offline, do this first)

1. **GraphQL documents**: validate every document below against the **composed** schema that will be
   served — `rover supergraph compose --config supergraph.yaml` output, not `schema/*.graphql`, which
   is stale. A document that fails validation is corrected here, not at the stack.
2. **REST columns**: check each name against the migrations, not against memory. `recorded_places`
   (0053) has `id, household_id, kind, label, sandbox, fixture, created_at` — **there is no `child_id`
   column**; `child_id` appears in 0053 only for `orbit_alerts`.
3. **RPC signatures**: confirm against the defining migration before calling —
   `place_route_geometry_for(p_child text, p_place text)` (0058) and
   `village_places_for_child(p_child text)` (0075).

## Identity

```
POST http://127.0.0.1:4008/api/demo/login
content-type: application/json

{"personaId":"demo-guide"}
```
Expect `status:"READY"`, `marks.demoGuide:true`, `session.access_token`, `personId` `p_demo_guide`.
If `UNAVAILABLE`, stop and report `NO_GUIDE_SESSION` — do not substitute another persona.

## Expected gates (record these; do not assume they are met)

From `0075_village_places_for_child.sql`:

| Surface | Gate | Otherwise |
| --- | --- | --- |
| **labels** (`id, kind, label`) | `is_parent_of(child)` **or** `has_scope(child,'schedule.read')` | no row |
| **coordinates** (`latitude, longitude`) | `is_parent_of(child)` **or** `has_scope(child,'address.read')` | NULL together, `state='withheld'` |
| no catalog coordinates at all | — | `state='absent'` |

**A likely guide result, to be confirmed rather than assumed:** the guide's derived scopes observed on
`54e8abe` were `careplan.read, contacts.read, goals.read, schedule.read, school.read, transport.read` —
**`schedule.read` present, `address.read` absent.** On that basis the expected shape is **labels
returned, coordinates withheld**. That is a hypothesis to test, not a result to report.

**Do not assume a same-family place returns a row to the guide.** It may return labels, it may return
nothing, and either is a finding to interpret against the gates above.

## Backend probes — GraphQL (router `http://127.0.0.1:4012/`)

Authorization: `Bearer <guide access_token>`. Once per sandbox child id from G1.

**G1 — enumerate sandbox children**
```graphql
{ myChildren { child { id person { displayName } } scopes } }
```

**G2 — map world for one sandbox child** (this is the resolver path that calls
`village_places_for_child`)
```graphql
query GuideMap($childId: ID!) {
  villageWorld(childId: $childId) {
    village { id }
    child { id }
    places { id label kind lat lng coordinateState }
  }
}
```
Variables: `{"childId":"<id from G1>"}`

Record **per place**: `id`, `label`, `kind`, `lat`, `lng`, `coordinateState`. `lat`/`lng` null with
`coordinateState:WITHHELD` is a refusal, not an absence; `NOT_RECORDED` is a different fact again.

**G3 — single child, to separate "no places" from "world not visible"**
```graphql
query GuideChild($id: ID!) { child(id: $id) { id person { id displayName } } }
```
Variables: `{"id":"<id from G1>"}`

**G4 — negative control: no token.** Repeat G2 with no `authorization` header. Expect a refusal
recorded separately; it proves G2 is not simply open.

## Backend probes — REST (`SUPABASE_URL`, guide token)

**R1 — `village_places_for_child` — the function the map resolver actually calls** (0075)
```
POST /rest/v1/rpc/village_places_for_child
{"p_child":"<id from G1>"}
```
Returns `id, kind, label, latitude, longitude, state`. This is the primary backend answer; G2 should
agree with it.

**R2 — `place_route_geometry_for`** (0058) — geometry for one place, for one child
```
POST /rest/v1/rpc/place_route_geometry_for
{"p_child":"<id from G1>","p_place":"<place id from G2>"}
```
Expected: a row when the place belongs to **that child's household** and the caller passes the address
gate; **no row** otherwise, and the same empty answer for "not yours" as for "does not exist".

**R3 — `recorded_places` as the guide sees them** (**household-scoped**, 0053)
```
GET /rest/v1/recorded_places?select=id,household_id,kind,label,sandbox,fixture,created_at
```
There is **no `child_id`** to filter on. Household scoping means this read is *not* the child-scoped
answer — R1 is. Treat R3 as a cross-check of catalogue contents, not as the map read.

**R4 — context only, not map** `POST /rest/v1/rpc/can_view_shared_status {"p_person":"p_dad"}` —
record, do not re-litigate here.

## Recording table

| Probe | Caller | HTTP | Result | Interpretation (against the gate table) |
| --- | --- | --- | --- | --- |
| G1 | guide | | | |
| G2 | guide | | | per-child places + `coordinateState` |
| G3 | guide | | | |
| G4 | anonymous | | | negative control |
| R1 | guide | | | must agree with G2 |
| R2 | guide | | | row / no row, both meaningful |
| R3 | guide | | | catalogue cross-check |
| R4 | guide | | | shared-status context |

Then, separately: "the UI refuses the guide on the map; the backend returns **X** for the same
caller." Two facts, not one.
