# 17 — Supabase backbone: schema, seed, RLS

Migrations applied with `supabase db push --db-url …` (CLI v2.75.0):
`0001_schema.sql`, `0002_seed.sql`, `0003_rls.sql`.

RLS is **enabled and forced on every table** (28 tables), deny-by-default. Policies resolve the
caller as `auth.uid()` → `identity_map` → `person_id`; no header is trusted and `identity_map` has
no policy at all, so only the service role can read it.

Identity sync: HTTP 200, 13 rows upserted.

## Proof (PostgREST, as real signed-in users)

| Case | Table | HTTP | Rows | Expected | Result |
| --- | --- | --- | --- | --- | --- |
| anon: contacts | `contact_methods` | 401 | 0 | 0 | PASS |
| anon: care plans | `care_plans` | 401 | 0 | 0 | PASS |
| Dana (cross-village): Nora relationships | `relationships` | 200 | 0 | 0 | PASS |
| Kendra (parent): Nora care plan | `care_plans` | 200 | 1 | 1 | PASS |
| Kendra (parent): Nora relationships | `relationships` | 200 | 19 | 19 | PASS |
| Walter (schedule.read): Nora events | `events` | 200 | 1 | 1 | PASS |
| Walter (schedule.read): Nora care plan | `care_plans` | 200 | 0 | 0 | PASS |
| Walter (schedule.read): Nora contacts of others | `contact_methods` | 200 | 0 | 0 | PASS |

**All cases behave as required.** Anonymous reads of contacts and care plans return zero rows;
a cross-village parent sees none of another child's relationships; a parent sees their own child's care plan;
a schedule-only grantee sees events but neither the care plan nor another adult's contact details.

## Notes

- Signed-in denials are **200 with zero rows** (RLS filters rows); anonymous requests are
  rejected at **401** before RLS is reached. Both are denials, but they are different mechanisms
  and the table above keeps them distinguishable rather than collapsing them into "PASS".
- The village subgraph still enforces the same rules in resolvers. RLS is the second wall, not a
  replacement for the first.
