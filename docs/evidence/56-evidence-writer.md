# 56 — the suite no longer overwrites the canonical evidence

## Defect

`ops/run-evidence.mjs` wrote every case straight into `docs/evidence/` on **every** run. Evidence is
append-only and those files are the record of what was proven on the **GraphOS router (4010)** — but a
suite run against the alt router (4012) silently replaced 31 of them with 4012 results. (They were
restored on `feat/create-demo-family`; this PR stops the cause.)

## Fix

| Invocation | Writes to |
|---|---|
| `node ops/run-evidence.mjs` | `.runs/evidence/<timestamp>/` (gitignored) and prints the path |
| `node ops/run-evidence.mjs --record` | `docs/evidence/`, only for a deliberate record run |

- **Preflight before the first live call.** `--record` builds the full target list
  (`Object.keys(CHECKS)` + the two directly-written slugs), and if **any** name already exists it
  exits `2` with the list. A refused record run performs no live call and mutates nothing.
- **Exclusive creation.** Every write uses `flag: 'wx'`, so an existing file cannot be overwritten even
  if the preflight were bypassed.
- `.runs/` is gitignored; `AGENTS.md` and HANDOFF document the flag.

## Proof — `ops/evidence-writer-proof.mjs`: **12/12 PASS**

| # | Assertion | Result |
|---|---|---|
| 1 | `--record` exits 2 when target names exist (32 already recorded) | PASS |
| 2 | the refusal names the reason | PASS |
| 3 | refusal happened **before any live call** (no case output) | PASS |
| 4 | no evidence file changed on the refused run (tree hash + `git status`) | PASS |
| 5 | the default suite run passes (exit 0) | PASS |
| 6 | it ran the full case set — **114 checks / 32 cases** via router 4012 | PASS |
| 7 | it printed a `.runs/evidence/<timestamp>/` path, not `docs/evidence` | PASS |
| 8 | `docs/evidence/` byte-identical after a default run — 79 files, same tree SHA-256 | PASS |
| 9 | the run directory received the 32 case files | PASS |
| 10 | exclusive creation refuses to overwrite (`EEXIST`) | PASS |
| 11 | the existing file is untouched | PASS |
| 12 | demo cast restored afterwards | PASS |

The suite's `/__reset` is v1-only, so the proof restores the demo cast afterwards with
`restoreDemoCast()` (`npm run db:restore-demo`) — same trap the `npm run suite` wrapper uses.

One note: the first proof run reported the suite exiting 1 while still running all 114 assertions; a
direct re-run exited 0. The suite mints one Supabase session per persona and can hit the auth
rate limiter, which fails a case in that run only. The writer behaviour was unaffected (cases 4 and 8
passed in both runs).
