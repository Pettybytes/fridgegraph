# Claude Code — checkpoint (2026-11-01)

## main
`origin/main` @ **10a8c9d** (includes #86, merge commit 10a8c9d). This PR also corrects a comment
in `src/rosina/museVision.test.ts` and `photoDescriptors.ts`: the earlier "dropped-synonym" cause
claim was unsupported (evidence 64 recorded **zero** drops; "jacket"/"ponytail" are allowed
values). It now states only the verified change — the request supplies each kind's allowed values
and asks the model to consider all five kinds; live improvement is still to be measured; unknowns
stay permitted.

## Merged (Claude Code)
- **#69** — photo → vocabulary-constrained descriptor endpoint (PR F)
- **#72** — shared semantic status tokens (`--fg-safe` / `--fg-danger`)
- **#76** — Rosina village-map answers (routes, nearest, ride, day)
- **#79** — photo endpoint real authorization wiring (fixed the refuse-everyone regression; PARENT-only)
- **#80** — tap-to-talk voice (self-contained button + hook)
- **#82** — voice mount in RosinaPanel (Codex)
- **#84** — mounted voice round-trip evidence (Kendra, browser-injected fixture audio)
- **#86** — vision suggestion quality (supply each kind's allowed values; consider all five)

## Open in my lane
- **#68** — Visual identity: fridge logo (new favicon, `<title>` "FridgeGraph"), illustrated
  backdrop, frosted glass. **DRAFT, PARKED** for the reference-driven design pass before hosting —
  no further visual work until then.
- This checkpoint PR.

## Not my lane (collaborators, informational)
Village-map backend (#78) and map frontend (#85, #87) are Bentley / Codex.

## Uncommitted changes
None.
