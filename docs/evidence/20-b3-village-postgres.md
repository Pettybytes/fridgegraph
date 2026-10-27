# 20 — B3: village reads and writes Postgres

Run: `node ops/b3-proof.mjs` at 2026-10-27T04:06:30.695Z (router 127.0.0.1:4010/)

Every GraphQL call below runs through the Apollo Router with a verified Supabase JWT; every
PostgREST call uses the publishable key plus that same caller's token, so the two see the same
row visibility. No key or database URL appears in this file.

**Result: ALL PASS** (21/21)

## graph

| Check | Result | Detail |
| --- | --- | --- |
| Kendra reads Nora | PASS | code=none carePlan=present |
| Loretta only permitted fields | PASS | goals=1/approved-only=true carePlan=UNAUTHORIZED contacts=UNAUTHORIZED |
| Dana denied (cross-village) | PASS | events=UNAUTHORIZED goals=UNAUTHORIZED carePlan=UNAUTHORIZED |
| Walter has no pickup rights | PASS | code=UNAUTHORIZED |
| Chris' expired grant has no effect | PASS | code=UNAUTHORIZED |

## postgrest

| Check | Result | Detail |
| --- | --- | --- |
| care_plans: Kendra 1 row / Dana 0 rows | PASS | kendra=1 (HTTP 200) dana=0 (HTTP 200) |
| events: Walter (schedule.read) 1 / Dana 0 | PASS | walter=1 dana=0 |
| contact_methods(p_bryan): Loretta 0 / Kendra 1 | PASS | loretta=0 kendra=1 |
| care_plans: Chris 0 rows (window closed 2026-09-30) | PASS | chris=0 vs allowed caller on same table=1 |
| relationships: Walter 0 / Kendra >0 (no pickup rights) | PASS | walter=0 kendra=19 |

## reality

| Check | Result | Detail |
| --- | --- | --- |
| named row named value before edit | PASS | care_plans.child_id=p_nora text=matches expected original |
| edit exactly that one row | PASS | HTTP 200 |
| DB edit is visible through the graph | PASS | parent=true grant-holder=true (two different callers, same row) |
| original value restored | PASS | text matches baseline=true |
| reset restores the baseline through the graph | PASS | matches baseline=true |

## restart

| Check | Result | Detail |
| --- | --- | --- |
| baseline before mutation | PASS | r_dana_friend_parent status=DISCOVERED |
| approveRelationship writes Postgres | PASS | graph status=ACTIVE |
| row is ACTIVE in the table | PASS | db status=ACTIVE |
| survives a process restart | PASS | after restart status=ACTIVE history=2 entries |
| audit row survives too | PASS | approvals=[{"decision":"APPROVED"}] |
| reset returns the row to baseline | PASS | reset={"approvals":1} status=DISCOVERED |

## Reality check, stated plainly

The demo row was named before editing: `care_plans.child_id = p_nora`, expected original
text `Peanut allergy. Epi-pen in right backpack pocket.`. Only that row was patched (to `REALITY-CHECK-1793073974213`), the graph then returned the
marker for two different callers (Kendra, a parent; Loretta, a careplan.read grant holder), the
original text was restored, and `npm run db:reset` returned the baseline. No unrelated record
was touched to prove DB-backed reads.

## Mutation ownership at B3

`approveRelationship` is a village field that updates `relationships` (village-owned) and inserts
one `approvals` audit row (access-owned). That is the single documented cross-owner write; the
RLS policy `approver_id = current_person()` permits exactly that row and nothing wider.
