# 18 — RLS gap checks, paired with an allowed caller

Every "0 rows" below sits next to an allowed caller reading the **same table** in the same run.
A 401/403/404/privilege error would be recorded as FAIL, because it never reaches a policy.

| Case | Table | Caller | HTTP | Rows | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- |
| Kendra (parent) events | `events` | Kendra | 200 | 1 | 1 | PASS |
| Loretta (schedule.read) events | `events` | Loretta | 200 | 1 | 1 | PASS |
| Chris (schedule? no) events | `events` | Chris | 200 | 0 | 0 | PASS |
| Kendra care plan | `care_plans` | Kendra | 200 | 1 | 1 | PASS |
| Loretta care plan | `care_plans` | Loretta | 200 | 0 | 0 | PASS |
| Daniel care plan (window open today) | `care_plans` | Daniel | 200 | 1 | 1 | PASS |
| Chris care plan (window closed) | `care_plans` | Chris | 200 | 0 | 0 | PASS |
| Kendra relationships | `relationships` | Kendra | 200 | 19 | 19 | PASS |
| Chris relationships | `relationships` | Chris | 200 | 0 | 0 | PASS |
| Kendra grants | `grants` | Kendra | 200 | 13 | 13 | PASS |
| Dana grants (cross-village) | `grants` | Dana | 200 | 0 | 0 | PASS |
| Dana relationships (cross-village) | `relationships` | Dana | 200 | 0 | 0 | PASS |
| Dana events (cross-village) | `events` | Dana | 200 | 0 | 0 | PASS |
| Unmapped signed-in user events | `events` | unmapped | 200 | 0 | 0 | PASS |

**auth.uid() resolution:** `whoami()` returned `p_mom` for Kendra's token.

**Signed-in user with no identity mapping:** whoami=200 person=null (user deleted). They authenticate but resolve to no person, so every policy evaluates false and they read 0 rows.

## Expired-grant isolation

Chris and Daniel both hold `careplan.read` on Nora. Daniel's window covers today; Chris's closed
2026-09-30. Daniel reads the row, Chris reads 0 — so the 0 is caused by the **date window**, not by
a missing scope.

## village event table

There is no table literally named `village_event`. The village event data lives in `events`
(child_id, title, start_at, end_at, location); `practices` is a separate activities table.

Rows currently present (read as Kendra): 1 — e_school_1026 (p_nora, "School", 2026-10-26T08:15:00).

Source: seeded by `0002_seed.sql` from the original fixtures (`e_school_1026`). No synthetic
history was generated, and nothing was left behind that does not mirror a fixture.

## Naming

The identity map table is `identity_map` (not `access_identity`); access-domain tables are
`grants`, `approvals`, `household_policies`, `parenting_schedules`. Recorded in
`docs/schema-plan.md`.

## Dana

Dana has an auth identity and a `identity_map` row, but **no** pre-seeded relationship, grant or
event against Nora — all three read 0 above. Her onboarding remains a live demo event, not seed data.
