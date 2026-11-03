# Task CAL browser evidence — 2026-10-30

Production build served on 127.0.0.1:5181. Playwright CLI session `cal`:

```sh
browser automation -s=cal run-code --filename=web/evidence/task-cal/browser-proof.js
```

Observed five passing flows: Kendra (status, linked records, unresolved facts, inclusive
Thanksgiving); Priya (separate scoped calendars and restricted metadata); Dana (Jax only,
forged Nora link refused); Rosa (Emma via guardian authority, care bands, Rosina event sheet,
mobile layout); Dwayne (two distinct repeated-hour events, midnight busy privacy, mobile day).

Screenshots: Rosa week desktop/mobile; Detroit DST week desktop/day mobile; Thanksgiving desktop.
Inspected the Rosa and DST images. Mobile page width stays within 390px; navigation scrolls
within its own row. Initial browser assertion incorrectly searched authorized selector option
names as well as calendar content; corrected to check the actual board. A real mobile grid/nav
overflow was found and fixed. Final proof runs against bundled font assets in production preview.

Automated verification: 117 web tests (29 calendar-related additions), root typecheck, production
build. The Detroit adapter/time suite additionally passed 13 tests under TZ=UTC and
TZ=Pacific/Auckland. Secret guard is recorded in HANDOFF after staging all new source files.
No live authorization, data-service or model-performance proof is claimed.
