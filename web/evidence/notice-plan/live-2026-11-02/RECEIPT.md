# Notice → Plan browser proof · 2026-11-02

This is a live proof, separate from the mock captures in the parent evidence
folder. It ran inside the AGENT PROOF SLOT on PR #78. The deadline was extended
to `2026-11-02T02:00:00Z` after Rosina's restart.

| Process | Served revision |
| --- | --- |
| #90 UI preview, port 5209 | `5e92da704433c1cf6956b61f777ba27db1144515`; `VITE_NOTICE_PLAN_LIVE=true` only here |
| Graph and demo API, 4001–4008 | `c231ba8` |
| Routers, 4010/4012 | `c806f46` supergraph |
| MCP, 5051 | `cfbbb6a` config, forwarding on |
| Rosina, 4200 | `7fda69d`, pid 39469 after router-target restart |

The failed run is preserved: before that restart, the same real picker-issued
Kendra session loaded the published sample-(a) PNG, but Review returned HTTP
502 `NOTICE_ERROR`. The UI showed “Couldn’t review this notice just now.”
No proposal or Confirm button appeared, and zero confirm requests were sent.
Bentley found that Rosina's schedule reader was directed to the MCP listener
instead of the GraphQL router. The earlier 502 from the preceding proof window
is recorded separately in HANDOFF and on PR #89.

After Bentley posted “agents resume,” Kendra used the published sample-(a) PNG
through the actual browser sample tray. Review returned HTTP 200, proposal
`np_mvyjacmx_3`, one `requestPickup` action and no clarification. The UI
rendered the source passage, conflict, affected people, unknowns and the exact
effect of confirmation. The parent clicked Confirm once. Exactly one
`/api/rosina/notice-plan/confirm` request returned HTTP 200 with job
`job_2f32d2a49d204d75ba39810e2fbaa66d`, status `discovering`. The UI said
“Pickup request created” and explicitly said pickup was not arranged yet.
There was no automatic replay or second job request.

A fresh Kendra picker session opened live Mission Control. The same job was
selectable among nine stored records and displayed “Checking with caregivers.”
The screen did not claim pickup was arranged. This was a read-only check.

Priya used a separate real picker session at 390×844. Review of the same
published PNG returned HTTP 200 with a proposal, but the UI showed the
parent/guardian boundary and no Confirm button. No confirm request or job was
created from Priya's session.

Screenshots: `sample-a-review-desktop.png`, `sample-a-result-desktop.png`,
`priya-review-mobile.png`. They show no bearer, request headers, URL tokens or
storage. No trace, HAR, video or browser storage state was recorded.

Mock verification at the merged #90 head remained separate: 395/395 web tests
across 66 files, root typecheck, web build with `tsc -b`, and secret scan passed.
Live sample (a) and Priya's no-confirm boundary passed. Samples (b)/(c) and
briefing are owned by feat/rosina-service in this slot; they are not claimed
here. Bentley owns the canonical reset after the slot.

## Same-job backend observation and remaining samples

feat/rosina-service's independent live receipt on #78 and
`docs/evidence/65-rosina-notice-briefing-live.md` observed the **same**
sample-(a) job, `job_2f32d2a49d204d75ba39810e2fbaa66d`, for the
documented pickup key. That agent sent no confirm. Its sample (b) date
clarification resumed the same proposal at version 2, sample (c) stayed
review-only and refused confirmation with `422 NO_ACTION_AVAILABLE`, and
its Loretta/Priya briefing checks respected their different grants. Those
are backend service checks; this receipt's browser claims remain limited
to sample (a) and Priya's no-confirm review. The single-job coordination
was confirmed on #78 before this addendum.
