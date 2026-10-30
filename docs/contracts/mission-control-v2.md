# Mission Control v2 — recorded demo replay

UI on mocks; source facts unavailable as live data; timeline and lanes derived. No server,
auth, schema, database, pricing computation, outreach or spending changes. Live integration
remains W4, with separate UI/backend/integrated states in HANDOFF.

## Facts and time

The normal afternoon uses the existing synchronized Mission Control mock events and pickup
job lifecycle. Six recorded events, sorted by timestamp, cover request creation, simultaneous
outreach, Loretta's response evaluation, Monique's timeout observation, Bryan's decline
evaluation, and Tasha's evaluation/recommendation. Source event IDs are local view joins only,
not new graph fields. Full original timestamps remain in time elements; display includes seconds in US 12-hour
Detroit time. No invented timestamps, recipients, arrivals, GPS locations or policy decisions.

Play/Pause/Next/Restart provide a **condensed recorded replay**. Timing is presentation pacing,
not real-time elapsed progress or a claim of current calls. The parent approval event is held
until an app-owned confirmation step replays that recorded approval. Playback stops at the
recommendation and can never automatically approve. Selecting a candidate pauses playback and
opens only facts already reached in that candidate's lane. Scenario/persona changes clear all
private selections, confirmation state and replay timers.

Reply evaluations have timestamps; independent reply receipt times, ringing transitions and
a separate policy-check event do not exist in the source. They are explicitly unavailable,
not assigned invented times or animated stages. No answer is an explicit source timeout
observation, never inferred as a decline from an UNAVAILABLE code alone. Other lanes continue
waiting until their own recorded evidence is reached.

## Contact modes

frontend-data §1.4 now uses the requested distinct labels:
TEST_RESPONDER → Test responder; REAL_CONSENTED → Real call (consented); explicitly simulated
activity → Simulated. The frontend projection supports those three source states, with distinct
styles and an unavailable state for a missing mode. This does not add a new graph enum value.
Every visible normal-job attempt is a Test responder, as recorded by the lifecycle's parallel
dispatch evidence. None is presented as a consented real call. Tests of the real-consented
badge are component/projection tests, not proof that such a call occurred in this scenario.
A confirmation's badge derives from the candidate's attempt mode, not a job-wide demo flag.
Live per-attempt destination mode and candidate join must arrive before any real-call badge can
be attached to live activity. Contact-method reachability never supplies an attempt's channel.

## Recommendation and approval

Tasha's explanation joins the authorized candidate projection, the explicit human response,
recorded transport evidence and 4.50-mile straight-line distance. A parked vehicle or a free
calendar never proves availability. No driver receives a cost or cost basis. Kendra is the
recorded Wednesday approver; Andre may inspect this job but cannot confirm as Kendra. Other
personas receive their role-aware boundary or their own no-job state. Demo guide's pickup
surface remains explicitly unavailable/read-only rather than pretending the village guide
scope already extends to live pickup records.

Normal approval replays the existing confirmation at 2026-10-28T15:14:00Z. It remains distinct
from Tasha's availability and does not establish pickup completion. The old MissionControl
component/adapter tests remain intact as a separate compatibility and future transport seam.

## No-driver night

The distinct no-driver scenario uses only the lifecycle's supplied overLimitPath. Loretta is
willing, lacks transport and has a recorded $12.40 estimate above the recorded $10 paid-ride
limit. Other candidates' individual outcomes, attempt metadata and timestamps are not supplied
for that night: do not reuse normal-afternoon replies or create a timed sequence for it.

The ride label and basis match frontend-data §1.5. Costs render only on this paid-ride path;
explicit null hides cost/basis and a real zero remains visible. Review is not a booking or a
spending action. An app-owned confirmation always requires the separate over-limit acceptance
checkbox. The source supplies the accepted candidate/approver/exception but no confirmation
time; the replay states that missing time, never substitutes Date.now or the normal night's
confirmation. Neither scenario creates a real approval or contacts anyone.

## W4 delivery

Authenticated persona/approver rights; jobTimeline to replace the derived event projection;
Attempt.candidate and per-attempt destinationMode; candidate authorization/availability/
transport/distance evidence; explicit timeout versus decline observations; actual ringing or
policy-check timestamps if such events are recorded; confirmed approval readback including
exception acceptance. Until then, these are mock-tested surfaces, not live DONE milestones.
