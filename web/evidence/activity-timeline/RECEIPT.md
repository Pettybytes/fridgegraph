# Activity timeline receipt — 2026-11-01

## Authorized read inventory

| Read | Timestamped facts usable in feed | Limit |
| --- | --- | --- |
| `coordinationJobs(childId)` through the existing delivered adapter | current job and attached confirmation | current status has no transition time |
| `attempts(jobId)` and `jobTimeline(jobId)` | job creation, attempt open/close, cost calculation, confirmation | attempt open is a recorded attempt, not verified delivery; cost is not an acceptance; timeline has no approval/decline decision |
| `permissionSlips(childId).history` | explicit APPROVED or DECLINED consent decision at its stored time | slip creation time is not exposed |
| `orbitStatus(childId)` | latest response timestamps and scoped status/outcome | no complete response history, draft history, activation or close time in this summary; recipient post-close detail must remain redacted |
| `checkInStatus(childId)` | no event timestamp | due time is a schedule signal, not an occurrence; display only “Check-in not recorded” |

The screen uses the signed in bearer through the current Apollo client. Parent and guardian perspectives can request this combined view. Priya receives an explicit refusal. On a failed authorized read the screen shows an error or refusal, never a false empty family. A session generation change unmounts the keyed screen and clears its state. The only feed entries are derived from returned timestamps. Orbit outcome and check-in appear outside the dated feed. The UI neither reads an alert photo nor displays a place or descriptor.

## Browser evidence

Local Vite 5193, actual picker-issued Kendra and Priya sessions, graph proxied to the existing local router. Kendra returned a recorded October 16 pickup job and two test-responder attempts; the feed labelled the job PROPOSED, outreach SIMULATED and attempt endings REPORTED. `checkInStatus` returned not recorded. `permissionSlips` and `orbitStatus` returned no dated items in this view. Priya switched from Kendra; the prior feed disappeared and an explicit “This activity is not shared with you” state appeared. No mutations, reset, seed, or service restart were performed.

Captures: `kendra-light-1440.png`, `kendra-light-390.png`, `kendra-dark-1440.png`, `kendra-dark-390.png`, and the corresponding four `priya-*` files. Dark mode was applied by setting the existing `.dark` class in the browser; no new theme was added. Post-close FOUND_SAFE redaction was checked in the formatter test, not against a live closed alert.

## Gaps for Bentley

- A child-scoped historical pickup approval/decline read with decision time and actor is needed to render those decisions. `jobTimeline` does not include them.
- A scoped Orbit history read with activation and close timestamps, plus authorized response history, is needed for a complete chronological Orbit story. `orbitStatus` provides only latest responses and an untimed outcome.
- A timestamped check-in recording/history read is needed before check-ins can become feed entries.
- A timestamped Rosina proposal source is needed to attribute a job proposal to Rosina; the job timeline only proves creation, so the UI says “Creator not recorded.”
