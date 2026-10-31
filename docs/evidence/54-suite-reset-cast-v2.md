# 54 — the evidence suite no longer deletes the demo cast

## Defect

`resetDatabase()` is the **v1 baseline** reset. Its "keep" set is derived from `baseline()` — the v1
fixture ids only — while `seedDatabase()` merges **Cast v2** into that same seed. So for every table in
`RESET_SCOPED` the sequence was: seed the cast → delete every cast row as "non-baseline". Observed after
one suite run: `relationships` 14 and `grants` 4 deleted, taking `g_priya_malik` (Priya's care-plan
grant on Malik) and `r_priya_malik` (her nanny relationship) with them.

## Fix

`resetDatabase()` is **unchanged** on purpose: its baseline reset and checksum semantics are published
and stay exactly as they are. The repair is additive and separate:

- `scripts/db.ts` → `restoreDemoCast()`: `seedDatabase()` (v1 baseline **+ all of Cast v2**, one merged
  source — the same one `db:seed` uses) then `seedSimulated()` (simulated coordination, calendar, Orbit
  notification policy, expected check-ins, simulated care facts).
- `ops/run-suite.mjs`: runs `ops/run-evidence.mjs` as a child and calls `restoreDemoCast()` in a
  **`finally`**, so a passing, failing, crashing or interrupted suite all end demo-ready. `npm run suite`
  and `npm run db:restore-demo` are the entry points.

Restoration covers the **whole** cast, not the five rows found by hand earlier: every Cast v2 table
(villages, people, children, households, memberships, relationships incl. Rosa's guardian access,
grants incl. Priya's, approval policies, routines, events, care facts) plus the simulated set. Because it
is the seed's own source, anything the seed adds in future is restored automatically.

## Proof — `ops/suite-reset-proof.mjs`: **18/18 PASS**

| # | Assertion | Result |
|---|---|---|
| 1 | precondition: demo-ready baseline established (`restoreDemoCast()`) | PASS |
| 2 | suite passes — **114 checks / 32 cases**, router **4012** | PASS |
| 3 | restore trap ran on success | PASS |
| 4 | full-table checksum **byte-identical** after a passing suite | PASS |
| 5 | named cast present (Priya's grant + relationship, Malik's facts, Rosa's guardian row, 9 policies, 55 vocabulary rows) | PASS |
| 6 | all six consumer reads answer after a passing suite | PASS |
| 7 | authenticated MCP call succeeds | PASS |
| 8 | `my-children-proof` PASS — 0 failures | PASS |
| 9 | forced-failure suite really fails (dead router, exit 1) | PASS |
| 10 | **restore trap ran on FAILURE** | PASS |
| 11 | full-table checksum byte-identical after a failed suite | PASS |
| 12 | named cast present after a failed suite | PASS |
| 13 | all six consumer reads answer after a failed suite | PASS |
| 14 | `my-children-proof` PASS after a failed suite | PASS |
| 15 | `resetDemo` still runs and drops the session cache (unaffected by this change) | PASS |
| 16 | `resetDemo` still restores its own simulated fixture set | PASS |
| 17 | restoring again returns the exact baseline checksum (repeatable) | PASS |
| 18 | demo cast present at the end | PASS |

Checksums are compared, never printed as content.

## Observed, NOT fixed here — separate defect

`resetDemo()` (the sandbox demo reset) clears **every** `sandbox = true` care fact and restores only its
own simulated set, so **Cast v2 care facts disappear after a demo reset** (`malikFacts` 3 → 0, observed in
case 17's run). That is a different reset with a different job and it is deliberately out of scope for
this PR; recorded here and in HANDOFF for its own fix.
