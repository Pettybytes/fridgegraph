# Demo-guide map inspection — prepared queries (NOT EXECUTED)

**Status: PREPARED ONLY. None of these queries has been run.** They execute only inside a freshly
reserved window, after the reservation is posted and the stack verified.

**Why this file exists.** The current UI deliberately refuses the guide on the map surface. That UI
refusal is a product decision and must not be read as evidence about the backend. This pack separates
the two: it asks the **backend** what it returns to a guide token, and reports those responses
independently of what the UI chooses to render.

**Hard rules for the run**

- Report **backend responses separately** from the UI's intentional guide refusal. Never merge them
  into one verdict.
- **Do not remove the UI guard** to make the inspection "complete".
- **No new scopes, homes, coordinates or permission changes.** Read-only throughout.
- No `db push`, no reset, no seed, no write of any kind.
- If a caller is refused, record the exact status and code. A refusal is a result, not a failure.

## Identity

```
POST http://127.0.0.1:4008/api/demo/login
content-type: application/json

{"personaId":"demo-guide"}
```
Expect `status:"READY"`, `marks.demoGuide:true`, `session.access_token`. Record `personId` (expected
`p_demo_guide`). If `UNAVAILABLE`, stop and report `NO_GUIDE_SESSION` — do not substitute another persona.

## Backend probes — GraphQL (router `http://127.0.0.1:4012/`)

Authorization: `Bearer <guide access_token>`. Run once per sandbox child id returned by `myChildren`.

**B1 — enumerate sandbox children (already proven 12 at `54e8abe`)**
```graphql
{ myChildren { child { id person { displayName } } scopes } }
```

**B2 — map world for one sandbox child**
```graphql
query GuideMap($childId: ID!) {
  villageWorld(childId: $childId) {
    village { id }
    child { id }
    places { id label kind lat lng coordinateState }
  }
}
```
Variables: `{"childId":"<id from B1>"}`

Record **per place**: `id`, `label`, `kind`, `lat`, `lng`, `coordinateState`. The expected shape is
labels for map readers and `coordinateState` distinguishing `SET` / `WITHHELD` / `NOT_RECORDED`.
**Retrieve, do not infer**: a null `lat`/`lng` with `coordinateState:WITHHELD` is a refusal, not an
absence.

**B3 — a single child read, to separate "no places" from "world not visible"**
```graphql
query GuideChild($id: ID!) { child(id: $id) { id person { id displayName } } }
```
Variables: `{"id":"<id from B1>"}`

**B4 — negative control: no token**
Repeat B2 with no `authorization` header. Expect a refusal (`UNAUTHENTICATED`), recorded separately.
This proves the endpoint is not simply open to the guide's success.

## Backend probes — REST (`SUPABASE_URL`, guide token)

**B5 — recorded places as the guide sees them**
```
GET /rest/v1/recorded_places?select=id,label,latitude,longitude,child_id
```

**B6 — geometry helper as the guide**
```
POST /rest/v1/rpc/place_geometry_for_child
{"p_child":"<id from B1>","p_place":"<place id from B2>"}
```
Expected: a row for a place in that child's own household, and **no row** otherwise — the same empty
answer for "not yours" and "does not exist".

**B7 — status functions already probed for `shared_statuses` (context, not map)**
```
POST /rest/v1/rpc/can_view_shared_status {"p_person":"p_dad"}
```
Record only; do not re-litigate here.

## Reporting table to fill in the window

| Probe | Caller | HTTP | Result | Interpretation |
| --- | --- | --- | --- | --- |
| B1 | guide | | | |
| B2 | guide | | | per-child place list + coordinateState |
| B3 | guide | | | |
| B4 | anonymous | | | negative control |
| B5 | guide | | | |
| B6 | guide | | | |
| B7 | guide | | | |

**Then, and only then**, state separately: "the UI refuses the guide on the map; the backend returns
<X> for the same caller." Those are two facts, not one.
