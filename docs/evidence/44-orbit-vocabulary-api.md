# Evidence 44 — Orbit vocabulary through the API

_Follow-up to Task O. Branch `feat/orbit-vocabulary-api` off `main` `27fb5a4` (includes #33).
Adds a GraphQL read and a read-only MCP tool so Rosina can map what a parent says onto allowed values._

## What was added

| Surface | Shape |
|---|---|
| GraphQL `orbitVocabulary(version: Int)` | `[OrbitVocabularyEntry!]!` — `{ kind, value, version }` |
| MCP `OrbitVocabulary` | `{ version? }` → the same list, read-only |

Kinds: `WEAR_COLOR`, `WEAR_GARMENT`, `HAIR`, `CARRY_COLOR`, `CARRY_ITEM` — 55 values, all version 1.
The list is public to authenticated callers by design (it is the closed set of words Orbit may use),
so there is no oracle concern; an unauthenticated caller is refused.

## Two defects found while proving it

1. **The vocabulary was reference data seeded only by migration.** `db:reset` deletes non-baseline
   rows, so after the pickup diagnosis the table was empty and the read returned nothing. It is now
   part of the baseline seed in `scripts/db.ts` (`orbit_vocabulary`, conflict `kind,value`) — 55 rows
   survive a reset.
2. **RLS was enabled on `orbit_vocabulary` with zero policies**, so `authenticated` got zero rows even
   with SELECT granted. Migration **0038** adds a plain SELECT policy for `authenticated`; there is no
   write policy, because values change only by migration.

## Proof — `node ops/orbit-vocabulary-proof.mjs` — 12/12 PASS

Against router **4012** and MCP **5051** (both from this checkout), after `db:reset` + `seed` +
`seed:simulated`:

| # | Check |
|---|---|
| 1 | 55 values returned; five kinds; every entry versioned |
| 2 | the template values exist (`WEAR_GARMENT:raincoat`, `CARRY_ITEM:backpack`) |
| 3 | `version: 1` returns the same list; `version: 999` returns an **empty list**, not an error |
| 4 | no token → `UNAUTHENTICATED` |
| 5 | MCP `OrbitVocabulary` returns the same 55 values as GraphQL |
| 6 | `OrbitVocabulary` is in `tools/list`; **no mutation tool** is exposed |

## Process note

The alt-stack checkout switch and `db:reset` during the #33 diagnosis broke Codex's live runs because
they were not announced. HANDOFF now carries a rule: announce any `db:reset`, seed, alt-stack restart
or checkout switch **before** running it, naming the checkout, ports and duration, then say it is
restored. Both operations in this task were announced first.
