# Village pulse demo data contract (proposed seed input)

This is input for a later backend seed PR. It authorizes no schema, resolver, migration, reset, outreach, or database change in the Village pulse web PR. All people and records are fictional. Seed work must keep caller-scoped RLS and test-responder transport boundaries.

## Display window and units

- Provide roughly 30 America/Detroit calendar dates of fictional pickup coordination history for a parent such as Kendra viewing Nora. Store actual instants with offsets or UTC; the UI converts them to Detroit dates. Include a few records on both sides of a Detroit midnight and an older record outside the window to exercise the boundary.
- Each request is one `PICKUP` coordination job with a stable ID, child, recorded `JOB_CREATED.at`, current status, and any recorded parent confirmation. Include a small mix of pending, discovering, awaiting approval, confirmed parent approval, and ended coordination; do not seed a pickup completion unless a separate recorded outcome supports it.
- Contact attempts must attach to a job and retain their own ID, channel, recorded attempt instant, destination mode, and optional closure reason/time. A recorded attempt is not proof of delivery, contact, response, or pickup. Several attempts on one job must still count as one job in the pulse bar.
- To support a future response-time measure, each actual caregiver response needs its own recorded response ID, matching attempt/job, responder identity visible under RLS, response kind, and **responseAt** instant. A timeout or no-answer closure must have no responseAt. The future UI should match dispatch/contact to that response, disclose the observation window and sample size, and avoid caregiver rankings.
- If coverage is desired later, explicitly record each care requirement's child, required date/time window, and outcome evidence linked to a job. A calendar gap, free-time record, parent approval, or missing confirmation cannot by itself mean uncovered or covered.
- Include a few parent approvals and non-approvals as explicit decisions. Do not translate approval into confirmed pickup. Preserve status history and event timestamps so the story can be audited.
- For Open items, provide one current pending parent approval and optionally one active Orbit alert in a controlled fictional run. Orbit's caller-scoped status must remain separate from its sensitive payload. A latest-alert read does not prove there are no other active alerts.

Suggested **fictional seed plan**, relative to a documented Detroit demo anchor date `D` (not records claimed to exist now):

| Created on | Pickup job history to record | Honest current display |
| --- | --- | --- |
| D−29 | Request, no contact attempt yet | Request recorded |
| D−25 | Request, two contact attempts, both closed with recorded no-answer/timeouts | Coordination ended; no response duration |
| D−21 | Request, contact attempt, actual caregiver response with `responseAt`, parent decision still pending | Waiting for parent approval |
| D−17 | Request, contact attempt, actual caregiver response, explicit parent approval | Parent approval recorded; pickup completion unknown |
| D−12 | Request, contact attempt, explicit caregiver decline with `responseAt`, further coordination | Recorded response; no inferred pickup |
| D−7 | Request, contact attempt still open, no response | Coordination in progress; no reply yet |
| D−3 | Request with a recorded parent refusal or cancellation decision and its event time | Explicit decision only |
| D−1 | Request, response, current `awaiting_approval` state | Pending parent approval tile |

The seed PR should choose supported state/event names, document the actual anchor and instants, and omit any pattern that its reviewed schema cannot represent. The table defines useful proof coverage; it is not a claim that these records or fields are live.

## Fields available to this web PR

`coordinationJobs(childId)` exposes job ID, type, current status, version, evaluations, and confirmation. `jobTimeline(jobId)` exposes `JOB_CREATED.at` and other recorded moments. `attempts(jobId)` exposes attempt `at`, `closedAt`, and `closedReason`. Orbit's existing controller exposes the latest visible alert status. All reads run as the signed-in caller.

The following are **not** currently exposed as a supported pulse read: a caregiver response timestamp paired with an attempt; a linked care-requirement/outcome denominator; an explicit request-for-pickup date suitable for “upcoming” classification; a list of all active Orbit alerts; and a deep link to a selected Mission Control job. The web UI therefore omits response time and coverage percentages, labels its bars as recorded job counts, and links to the existing surfaces without claiming per-record navigation.

## Seed acceptance for a separate PR

A seed PR should document fictional provenance, exact inserted records and time zone, per-person read probes for parent and limited perspectives, and proof that test-responder transport remains the only outreach path. It should not change the pulse UI's present-tense claims until the new read contract and its authorization have been reviewed. No seed or reset is part of this contract-only addition.
