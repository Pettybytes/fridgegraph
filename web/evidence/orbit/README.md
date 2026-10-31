# Orbit browser evidence

The `ui-fixture-*` screenshots use the real browser components with a clearly labeled, controlled
adapter. They demonstrate layout only. They do not prove backend integration.

Run local live acceptance only after Bentley opens and restores the scenario-clock window in the
shared HANDOFF, with the corrected Rosina preparation handler serving:

```sh
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
