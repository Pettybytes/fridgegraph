# Evidence 45 — Cast v2 seed

_Branch `feat/cast-v2`. Additive to baseline; no existing row modified; no existing grant revoked._

## Networks

| Network | People | Children | Notes |
|---|---|---|---|
| Ellison | existing (Kendra, Andre, …) | Nora, Leo, Max | unchanged |
| Coleman | existing (Dana, Ray, Evelyn) | Jax | unchanged; **Dana has zero generated records** |
| Castellano | Rosa, Tomás | Emma | guardians of record |
| Vance–Reyes | Felicia, Marcus (resident adult) | Taylor, Skye | Marcus is a step-parent, never an approver (see Piece 3) |
| Lee | Simone, Denise | Micah, Avery | both parents |
| Ferris | Dwayne, Cassandra (aunt), Oscar (neighbour) | Malik | Priya (nanny) holds `careplan.read` |

Villages 6 (`v_nora`, `v_jax`, `v_emma`, `v_taylor`, `v_micah`, `v_malik`); 14 new people; 4 new
households; sandbox rows throughout.

## Volume

| Item | Target | Actual |
|---|---|---|
| Routines | ~24 | **34** (32 cast + 2 existing simulated) |
| Historical events (Sep 1 – Oct 29) | 60–80 | **73** |
| Upcoming (to Nov 30) | 15–20 | **18** |

Three connected stories rotate across eight children (school day, soccer practice, piano lesson,
library club), plus parent–teacher conferences in November.

## Malik's care facts

`snack`: "No peanut butter — peanut-free snacks only, no shared utensils" · `tv`: 20 minutes after
homework, no screens after 7:30pm · `bedtime`: lights out 8:00pm. All `PARENT_CONVERSATION`,
source "Dwayne, care conversation 2026-10-20", **verified by `p_dwayne`**, CONFIRMED. So
"Can Malik have a PB snack?" answers **no**, from the recorded rule.

## Permissions — current data verified

| Grant | State |
|---|---|
| Priya → Nora `careplan.read` | **1 — baseline, preserved untouched** |
| Priya → Malik `careplan.read` + `schedule.read` | **1 — added** |

No contradiction found: the Nora grant is legitimate (Priya is Nora's sitter) and the brief's Malik
grant is additive. Nothing was revoked or rewritten.

## Identities

`scripts/seed-auth-users.ts` extended with the four personas; run is idempotent.
`/api/demo/health` now reports **all eleven personas READY** (rosa, felicia, simone, dwayne included);
identity map 18 rows, synced to the `identity_map` table. No password, token or user id printed.

## Restoration reads after seeding

`jobTimeline` 5 · `effectiveScheduleFor(2026-11-26)` → `ARRANGEMENT` · `orbitVocabulary` 55 ·
`checkInStatus` "check-in not recorded" · `careFacts` Nora 3, Malik 3.
