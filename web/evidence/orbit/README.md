# Orbit browser evidence

The `ui-fixture-*` screenshots use the real browser components with a clearly labeled, controlled
adapter. They demonstrate layout only. They do not prove backend integration.

Run local live acceptance only after Bentley opens and restores the scenario-clock window in the
shared HANDOFF, with the corrected Rosina preparation handler serving:

```sh
# Supply ORBIT_WINDOW_RUNTIME and ORBIT_WINDOW_UNTIL from Bentley’s current OPEN reservation.
# Supply a unique ORBIT_RECEIPT_NAME to preserve every earlier run.
node web/scripts/orbit-smoke.mjs
```

This uses the actual picker, router 4012, demo/media 4008 and Rosina 4200. It makes only explicitly
confirmed Orbit mutations and simulated notification records. No reset, seed or process restart.
An independent Playwright browser context has no traces, HAR, video, storage-state output or
console/header capture. The CLI-owned page stays anonymous and never receives a photo.

The harness holds session bearers and authenticated photo/object handles in memory. It scans the
working tree (including evidence, test-results and Playwright output), excluding protected
credentials, dependencies, data, symlinks and git internals. Findings report filenames and pass/fail
only. Existing generic encoded-token markers are inspected against their unchanged baseline;
actual held bearer values/prefixes and actual media handles must have zero matches. Raw browser
errors are suppressed so a failed assertion cannot persist a photo source attribute.

Each live receipt records the checks actually reached. An incomplete receipt is a failure, never
relabeled as a pass. New runs can use an explicit `ORBIT_RECEIPT_NAME` to preserve prior receipts.
Live screenshots are recorded only by this harness; actual tokens and photo handles never appear
in the artifact metadata or HTML dumps. Preview text is asserted against the service response.

The live entry `/scripts/orbit-live.html` mounts the real App and live picker without injecting a
session or fixture response. Only Orbit's overdue derivation receives the scenario instant
2026-10-31T20:05:00Z; auth, expiry and renewal keep the real clock. The local Vite proxies send the
same explicit scenario headers to GraphQL/Rosina. The serving backend's scenario support must be
confirmed by Bentley before the run. Persisted response timestamps are displayed exactly as read.

The window guard accepts only this task’s latest explicitly OPEN/REOPENED reservation, the
matching runtime and a future UTC deadline within 45 minutes. It rejects stale, unknown, foreign,
reserved-but-unrestored, superseded and expired windows. Generic callers still defer to every
active reservation. A re-opened continuation keeps the same original deadline.

Live run 08 completed 52/52 checks with 20 real captures and a clean held-token/media-handle scan.
Runs 01–07 and two read-only diagnostic receipts remain unchanged, including failures. The
production fixes were explicit select labels, guidance note semantics, single-flight polling
(the old poll sequence could starve a slow read), photo decode fallback and an assistant dock
clear of Orbit controls. The final live pass requires decoded images and a photo actually present
during the delayed activation; returning as Kendra refetches the committed state exactly once.

Earlier mobile images show the top of the inner scroller. A continued, separately coordinated
run focuses the real preview/history elements before capture; it changes no CSS or service reply
for screenshots. Application changes and all original receipts remain independently reviewable.

Final evidence: **live-10.json**, exit 0, 52/52 checks, clean scan, 21 real captures indexed by
`live-manifest.json`. Preview and response mobile captures are focused on their actual controls.
`live-09.json` remains a failure; no past receipt or screenshot was rewritten. The final driver
focuses the actual browser tab before dialog actions. Both activations retain real confirmation
clicks and exact binding checks; the race case includes a current photo, then checks revocation.
The shared-stack continuation was explicitly released before the original deadline.
