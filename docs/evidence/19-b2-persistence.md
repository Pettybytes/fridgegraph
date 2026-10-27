# 19 — B2: seed idempotency, reset scope, sentinel, village_event RLS

## Seed idempotency

Ran `db:seed` twice. Per-table row counts and SHA-256 content hashes identical both times:
**28 tables, 157 rows**, checksums byte-identical (diff clean).

## Reset scope

Created two non-baseline demo records (`g_temp_test` grant, `r_temp_test` relationship for Dana),
mutated Nora's care plan to `MUTATED BY TEST`, then ran `db:reset`:

| Check | Before | After | Result |
| --- | --- | --- | --- |
| temp grant rows | 1 | 0 | PASS |
| temp relationship rows | 1 | 0 | PASS |
| Nora care plan | MUTATED BY TEST | Peanut allergy. Epi-pen in right backpack pocket. | PASS |
| Dana grants for Nora | — | 0 | PASS |
| Dana relationships for Nora | — | 1 (DISCOVERED) | PASS |

**Sentinel outside the boundary:** `ops_sentinel` row survived reset unchanged (PASS).

**Double reset:** second reset produced identical checksums to the first — a provable no-op (PASS).

No TRUNCATE, no cascade to unrelated data, `identity_map` and auth users untouched by design.

## village_event

Created EMPTY by migration `0007`. Inserted one fictional `SYNTHETIC_SCENARIO` row:

| Caller | HTTP | Rows | Expected | Result |
| --- | --- | --- | --- | --- |
| Kendra (parent) | 200 | 1 | 1 | PASS |
| Chris (expired grant) | 200 | 0 | 0 | PASS |
| rows before insert | — | 0 | 0 | PASS |
| rows after cleanup | — | 0 | 0 | PASS |

`village_event` is history (what happened); `events` remains the schedule (what is planned).
Seed data never writes history and reset never generates it.
Baseline contains `r_dana_friend_parent` (status `DISCOVERED`) because the approve-relationship
demo starts from it. Reset must return it to DISCOVERED and leave **no** grant and no ACTIVE
relationship for Dana against Nora — which is what the two rows above measure.
