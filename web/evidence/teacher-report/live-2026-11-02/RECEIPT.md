# Teacher report card browser proof · 2026-11-02

This live proof is separate from the earlier mock captures and the mixed
transport isolation. It ran inside the AGENT PROOF SLOT on PR #78, whose
deadline was extended to `2026-11-02T02:00:00Z`.

| Process | Served revision |
| --- | --- |
| #99 UI preview, port 5211 | `668258bded6c1d6d96bccad250ffa2f50d59aa20` |
| Graph and demo API, 4001–4008 | `c231ba8` |
| Routers, 4010/4012 | `c806f46` supergraph |
| MCP, 5051 | `cfbbb6a` config, forwarding on |
| Rosina, 4200 | `7fda69d`, pid 39469 after router-target restart |

The original failed browser result remains in HANDOFF and PR #96: before the
MCP forwarding repair, Rosina returned no structured school report proposal.
It is not relabeled as a pass.

In this run, Ms. Whitfield entered through the real picker, then asked Rosina
to prepare a school-day fever report for Nora and explicitly not file it yet.
`POST /api/rosina` returned HTTP 200 with structured proposal
`srp_ea00e5a34c0b`, `kind=fever`, `childId=p_nora`. The UI rendered the exact
proposal in its review card and stated that nothing was filed before the
teacher's confirmation. One click on **Confirm report** sent exactly one
authenticated `confirmSchoolDayReport` mutation. It returned HTTP 200 with no
GraphQL errors and report `sr_1621815c7531`; the UI showed “Report filed.”
No automatic filing, retry or model-driven confirmation occurred.

This is a separate fictional report from feat/teacher-persona's backend chat
proof on PR #103. Its ID was posted on #78 for feat/web-activity-timeline to
verify in Activity and for Bentley's canonical reset. The parent read and
idempotent repeat-confirm for the backend contract are covered by #103; this
receipt claims the actual browser card path.

Screenshots: `review-desktop.png`, `filed-desktop.png`. They show no bearer,
request headers, URL tokens or storage. No trace, HAR, video or browser
storage state was recorded.

At the merged #99 head, mock verification remained separate: 372/372 web
tests across 65 files, root typecheck, web build with `tsc -b`, and secret
scan passed. The browser review-to-confirm flow passed live. Bentley owns the
canonical reset after the slot.
