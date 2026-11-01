# Orbit climax polish — offline review

Base: `9d73892464fa7c8709ccfb674b2b98faff842796` (main after #72/#73).
Branch/worktree: `feat/web-orbit-climax` / `fridgegraph-orbit-climax`.
Capture server: own offline Vite on 5196. No live backend contacted; no schema queried; no real
sessions, notifications, alerts or database mutations. The recording uses production UI components
with controlled adapters and an in-memory fixture channel between the two views. It is not live
backend proof. #69 remains mocked. The supplied Nora photo is unchanged; fixture descriptors are
red sweater, with the unsupported backpack removed.

## Review and skills applied

| Before | After | Why / skill |
| --- | --- | --- |
| Broad translucent red wash; small name and gray-looking details | Full shared-danger field, separate 1 Hz edge, display name, place/time chips and descriptor tags | Apple design: size, weight and tracking establish hierarchy without adding a palette |
| Plain response buttons and only history below | 70–84px targets, 140ms press compression, persisted response confirmation | Emil design engineering: immediate physical press feedback; successful state follows the returned record |
| Parent response changes text without a clear arrival | 480ms eased chip arrival from 8px / 0.94 scale, only for a newly observed ledger key | Emil: motion explains a real state change; no replay on polling or remount |
| Pale green card and nearly invisible confetti | Whole recipient screen goes green; red overlay fades, check draws, visible confetti and large exact thank-you | Apple: continuous transition and strong optical hierarchy, with no input lockout |
| Potential motion without an equivalent static outcome | Static edge/ring/check/green under reduced motion; no confetti or vibration | Apple: preserve meaning without travel effects |

Animation ownership: takeover uses CSS, parent rings retain Motion. No second animation engine
was introduced in either component. The photo pulse changes transform only; it does not create a
second luminance flash. Small check SVG stroke drawing is the deliberate exception to
transform/opacity-only animation; it is bounded to 100px and 650ms. Full-screen transition is an
opacity overlay, not animated blur. No siren audio.

## Evidence and corrections

- `take-01`: initial mobile visual review, followed by larger hierarchy and visible green payoff.
- `take-02`: all four size/theme checks PASS; parent response still near-transparent in the capture
  because it was taken at the first animation frame. Later captures wait into the arrival.
- `take-03`: complete controlled sequence, raw recording retained; 19-second MP4 removes idle
  lead/tail only. Review found the parent heading too close to the top of its viewport.
- `take-04`: heading framed fully, 19.133-second recording. Additional green text contrast check
  **FAILED** the unchanged 4.5:1 threshold. Original failed receipt remains in `contrast-results.txt`.
- `take-05`: final code uses 90% shared-safe green + black, retaining shared tokens. Green contrast
  **5.3494:1 light / 5.8951:1 dark**; high/low OKLCH conversion controls PASS. Alert contrast
  **5.1394:1 light / 6.7022:1 dark**. Final screenshots at 390×844 and 1440×900, both themes,
  include visible mid-animation confetti and static reduced-motion outcomes. Final sequence is
  `take-05/orbit-climax.webm`; `sequence-results.txt` records the actual action checks.

Sequence: explicit parent activation → recipient takeover → recipient ON_WAY is recorded → parent
ring chip arrives → explicit parent Found safe confirmation → both green, recipient details absent.
The fixture simulates persistence through its adapter; no delivery or live backend claim. The
recipient carries only her own response, and the controller sanitizer is byte-identical to #73.

Validation: 312 web tests / 52 files PASS; root typecheck and web typecheck/build PASS (existing
bundle-size warning). Browser checks: 1 Hz edge, ≥70px buttons, confirmation from persisted response,
photo/place removal, no replay, static reduced motion, both contrast gates PASS. Secret scan is
recorded in the PR. No evidence was overwritten.

Remaining integration dependencies are unchanged: Bentley's backend post-close gate, #69's real
endpoint, and separately reserved live verification. This PR is visual polish on the existing flow.

Final untrimmed take-05 recording measured by ffprobe: **19.066 seconds**, 1440×900 at 30fps.
UI source remained frozen throughout. Screenshots of the response arrival and payoff were taken
from that same sequence. All six action/privacy checks passed, backend request count zero.

## Final chip contrast correction — take-06

A follow-up alpha-composited check found the light place/time chip at **4.3397:1**; the raw
measurement remains unchanged in `take-05/chip-contrast-review.txt`. This was a real color defect,
not a parser problem. Replaced its translucent foreground tint with the shared danger-ink tint.
Final place/time chips and recorded-response confirmation: **5.9190:1 light / 7.6789:1 dark**.
The same 4.5:1 gate remains; green and alert background contrast remain as measured above.

`take-06` supersedes take-05 as final visual evidence: all four width/theme combinations and
reduced-motion states recaptured, plus the entire explicit activation/response/close sequence.
Earlier takes are retained unchanged. Full suite rerun: **312/312 PASS**, root typecheck and web
build PASS. Client sanitizer remains unchanged. No live requests.

Final take-06 duration: **19.100 seconds**, untrimmed 1440×900 / 30fps. Six sequence gates PASS;
zero backend requests; no source edits or HMR during recording. The associated commit contains
exactly the UI source rendered in this final take.
