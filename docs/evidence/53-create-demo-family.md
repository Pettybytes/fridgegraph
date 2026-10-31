# 53 — Group 5 Piece 2: createDemoFamily, and reset removes every trace

- endpoints: `http://127.0.0.1:4316` (demo-login app, spare port) + `http://127.0.0.1:4317/` (school subgraph, spare port)
- identity: verified Supabase JWTs per caller; tokens in memory only, never written
- reset: `resetDemo()` — the same function the 4008 route calls, not `db:reset`
- schema: `demo_families` (0049), RLS forced with no policies (server-only registry)

| # | Assertion | Result | Detail |
|---|---|---|---|
| 1 | no token refused | PASS | 401 UNAUTHENTICATED |
| 2 | Demo guide refused | PASS | 403 DEMO_GUIDE_READ_ONLY |
| 3 | empty parent name refused | PASS | 400 INVALID_NAME |
| 4 | over-long name refused | PASS | 400 INVALID_NAME |
| 5 | refused creates wrote no registry row | PASS |  |
| 6 | demo parent creates a family | PASS | 201 {"id":"family-a2d6927f","childId":"p_family_child_a2d6927f","parentName":"Proof Parent","childName":"Proof Child"} |
| 7 | registry has exactly one row | PASS |  |
| 8 | DB identity mapping written (RLS current_person) | PASS |  |
| 9 | sandbox household created | PASS |  |
| 10 | parent person + child person + memberships created | PASS |  |
| 11 | picker entry present and ready | PASS | {"personaId":"family-a2d6927f","ready":true} |
| 12 | created persona signs in | PASS | 200 READY  |
| 13 | created persona is marked demo, not guide | PASS |  |
| 14 | session was minted and cached by the owning process | PASS |  |
| 15 | created persona reads its own child | PASS | {"permissionSlips":[]} |
| 16 | an existing persona cannot read the created child | PASS | UNAUTHORIZED |
| 17 | reset reports the created family removed | PASS | {"createdFamiliesRemoved":1} |
| 18 | reset dropped the persona session cache | PASS |  |
| 19 | registry is empty | PASS |  |
| 20 | its rows are gone | PASS |  |
| 21 | file identity mapping removed | PASS |  |
| 22 | DB identity mapping removed | PASS |  |
| 23 | cached session for the persona is gone | PASS |  |
| 24 | old token exposes nothing (UNAUTHENTICATED, not a denial) | PASS | UNAUTHENTICATED |
| 25 | picker entry no longer resolves | PASS | {"status":"UNAVAILABLE","personaId":"family-a2d6927f","reason":"UNKNOWN_PERSONA"} |

**25/25 PASS**
