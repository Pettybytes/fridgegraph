# 59 — `/__reset` itself restores the demo cast

> **Current expected value (post-#92/#96, measured 2026-11-02): `f022ccf8311e7561`.**
> The `823cb76928f50c9f` values below are the measurements **at that revision** and stay as recorded.
> The change is explained by #92's additive `grants` row (`g_whitfield_school`), one of the three
> tables the checksum hashes; `care_facts` and `routines` are untouched and the v1 baseline is unchanged.

## The defect

`resetDatabase()` — the handler behind **`POST /__reset`** — seeds the database and then deletes every
id outside the **v1 baseline** keep-set. Cast v2 ids are deliberately *not* baseline ids, so the reset
deleted the cast it had just seeded: Malik's care facts, Priya's grants, the nanny relationship, the
simulated calendar.

The restore lived in **one wrapper**, `ops/run-suite.mjs`'s `finally`. Any caller that reached
`/__reset` another way therefore damaged the demo — the suite run directly, the writer proof's spawn,
or a bare `curl`. That is exactly how Malik ended up with **0** care facts while every port was
"healthy".

## The fix

The restore moved **into the reset**, after the deletion pass, from the same single source `db:seed`
uses:

```ts
await seedDatabase();   // v1 baseline + ALL of Cast v2 (one merged source)
await seedSimulated();  // simulated coordination, calendar, orbit policy, care facts
```

Additive by construction: `baseline()`, the keep-set and `checksumDatabase()` are untouched, so the
published v1 baseline reset/checksum contract keeps its meaning. Upserts by fixed id, so it is
idempotent. `ops/run-suite.mjs` keeps its `finally` restore as a safety net, no longer as the fix.

## Proof — four entry points, each followed by a cast check

The fixed code ran on a **separate** stack (4401–4407); the existing 4001–4107 stack was untouched.

| Entry point | Result | Malik | Cast checksum |
|---|---|---|---|
| baseline (after repair) | — | 3 | `823cb76928f50c9f` |
| **EP1** direct `POST /__reset` | 200 | 3 | `823cb76928f50c9f` |
| **EP2** `ops/run-evidence.mjs` directly | exit 0, 114 checks / 32 cases | 3 | `823cb76928f50c9f` |
| **EP3** `ops/run-suite.mjs` wrapper | exit 0 | 3 | `823cb76928f50c9f` |
| **EP4** `ops/evidence-writer-proof.mjs` spawn | 12/12 PASS | 3 | `823cb76928f50c9f` |

`docs/evidence` drift after all four: **0 files**. Historical evidence untouched.

The repair itself is the same mechanism: the demo was at Malik **0**, and the fixed `/__reset` took it
to **3** with checksum `bfcde1c7` → `823cb769`.

## What this does NOT claim

Restoration is guaranteed for a reset call that **runs to completion**. It is **not** crash-proof: a
process killed mid-reset can still leave a partial state, because the writes are not one transaction.
Failure recovery is documented and detectable rather than claimed:

- **re-run** `POST /__reset`, or
- `npm run db:restore-demo` (the same additive restore, without deleting anything),
- and **preflight now reports the damage**: `ops/stack-health.mjs` fails on the cast checksum, so a
  demo with no cast can no longer pass as healthy.

## Preflight additions

`ops/stack-health.mjs` now reports three separate things that were previously conflated:

| Reported | Why separate |
|---|---|
| **serving code** — git SHA + branch of the checkout behind the running process | the binary and the schema move independently |
| **schema** — 0049, 0050, 0051, 0052 applied | a current binary can run a stale schema, and vice versa |
| **demo cast** — Malik = 3, routines ≥ 32, cast checksum | ports up says nothing about whether the demo has content |

Measured on the shared stack after the window: serving `e56434d`, schema `0049–0052` all true, cast
`823cb76928f50c9f`, **HEALTHY (0 failing checks)**.
