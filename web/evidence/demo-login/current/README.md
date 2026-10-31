**Latest runtime: all eleven picker sessions READY and verified.** See picker-ready.json.
Earlier Coming-soon observations below are historical; live scripts no longer require them.
#38 wording matcher is corrected with Bryan's approval; latest affected acceptance PASS below.

# W4b replacement brief — current evidence

Base: fetched origin/main **0d80f003c722e009897b1790c461952cd0de6f66** (#31), including #27/#28/#29.
Final local rebase: **27fb5a44d575bf7683063516ddbe08ecf321bdea**, adding the concurrently merged
Task R and Task O work; the initial fetched base above is preserved.
PR #32 is reconciled through authorized merge commit 17259ec from current main 593e794.
Post-merge acceptance and review status are recorded below. Previous evidence in the parent
folder is historical; it does not prove this replacement run complete.

UI: live-capable for delivered fields · backend: sessions/Group 3 reads delivered, field gaps remain ·
integrated + tested: **delivered-read acceptance PASS; full W4 still NOT DONE**.

## Restored run — current results

The actual picker path passed for all seven READY personas after Bentley restored the login
process on port 4008 from `/Users/user/Desktop/bentley/fridgegraph`. The earlier 503 came from
missing runtime configuration in the old serving process, before an upstream mint call. Bentley
reproduced it and corrected process startup; his sanitized confirmation is in the shared HANDOFF.
The single-picker diagnosis is retained in `picker-diagnosis.json`; no ops login was substituted.

`results.json`: **PASS**, no assertion errors; two simultaneous browser contexts **PASS**.
`verify-demo-login-results.mjs`: **PASS** for every recorded private operation and its grant-specific
outcome; a forged successful private read is rejected as a negative control. Directory identity
reads follow evidence 37. Private household, candidate, schedule, care and goal reads retain their
own refusals; authorized empty jobs/availability remain empty successes. Hidden, nonexistent and
malformed calendar IDs are indistinguishable within each operation.

| Persona | Picker | Live reads | Rosina |
| --- | --- | --- | --- |
| Kendra | READY | PASS — stored job, five timeline facts, arrangement Nov 25–27; WEEKLY Nov 28; private-record refusals | Live answer grounded in actual candidates; availability unknown |
| Andre | READY | PASS — same family, job, timeline and calendar; private-record refusals | Live answer grounded in actual candidates; availability unknown |
| Loretta | READY | PASS — schedule/goals allowed; care, household and pickup-candidate reads correctly refused; no stored jobs | Correct refusal: “I can't confirm that yet.” |
| Priya | READY | PASS — schedule/care allowed; goals, household and pickup-candidate reads correctly refused; no stored jobs | Correct refusal: “I can't confirm that yet.” |
| Dana | READY | PASS — bounded Jax reads; Nora private records refused, including after Kendra | Live answer: Evelyn authorized for Jax, availability unknown |
| Jax's family | READY | PASS — Jax records; Nora private records refused | Live answer: Evelyn authorized for Jax, availability unknown |
| Demo guide | READY | PASS — sandbox calendar/job; non-sandbox calendar refused; confirmed forced write refused read-only | Live answer grounded in sandbox candidates |
| Rosa Castellano | READY | Pending expanded Cast v2 read acceptance | Pending expanded Cast v2 Rosina acceptance |
| Felicia Reyes | READY | Pending expanded Cast v2 read acceptance | Pending expanded Cast v2 Rosina acceptance |
| Simone Lee | READY | Pending expanded Cast v2 read acceptance | Pending expanded Cast v2 Rosina acceptance |
| Dwayne Ferris | READY | Pending expanded Cast v2 read acceptance | Pending expanded Cast v2 Rosina acceptance |

All seven live replies from the acceptance run are preserved verbatim in `results.json`.
No unsupported availability claim or foreign private identity was observed in these replies.
The supplemental desktop/mobile refresh is recorded separately in `rosina-captures.json`;
mobile captures explicitly open the Rosina sheet. Each authenticated run uses the actual picker,
no traces/HAR/video/storage state/header logging, real auth time and fixed Detroit data dates.
Each receipt's in-process token-leak scan **PASS**: zero current-token/prefix hits and zero new
generic matches. Generic baseline files are recorded as filenames plus pass/fail only; their
previously reviewed redacted/pattern/integrity/binary matches remain unchanged.

The normal app proxy still targets 4010; these live proofs explicitly target delivered schema
on **4012**. No silent endpoint fallback. Normal-stack schema reconciliation remains pending.
Family Calendar's missing school-closure day-kind/category/confirmer/links fields, Cast v2 personas
and Guide breadth, Village v2 live reads, Orbit screens and Task H remain queued below/in HANDOFF.
This passes the delivered-read slice; it does not prove undelivered functionality. Review readiness
is determined by the post-merge verification below. No PR merge or mutation approval was performed.

## Earlier interrupted runs (historical)

The first run reached real Kendra and Andre sessions, the stored sample pickup timeline, a grounded
Kendra Rosina answer, Andre's interrupted-tool response, and both live Thanksgiving calendars through router **4012**. Desktop/mobile
captures show Andre on Nov 25–27 through an approved arrangement; Nov 28 returns to WEEKLY (Andre
in the actual stored weekly answer). The Nov 26–27 overlap is surfaced rather than resolved.
The cancelled recital is hidden by default and shown after the explicit cancelled toggle. A
recorded Busy window is shown with no reason. These captures use actual GraphQL records, not
frontend fixtures. Data dates are fixed in America/Detroit; auth stays on the real clock.

That run stopped during Loretta's calendar check. Its final receipt is incomplete; do not infer a
passing per-persona boundary battery from the screenshots. A later run could no longer enter
Kendra's session. An independent sanitized endpoint check observed HTTP **503 DEMO_LOGIN_UNAVAILABLE**
(no session/body/credential values printed). The latest complete attempt, `results.json`, records
failed picker entries for all seven seeded personas, with live reads and Rosina pending. The
failure UI says “Busy, try again in a moment”, keeps cards selectable and substitutes no identity.
Rosa stays disabled as Coming soon after a terminal unavailable response. Per-persona HTTP metadata
was not captured in that retry receipt; the harness was subsequently corrected to retain only
whitelisted status metadata. Do not assign Kendra's observed code to an unobserved persona response.

| Persona | Earlier picker attempt | Earlier interrupted reads | Earlier Rosina result |
| --- | --- | --- | --- |
| Kendra | failed; earlier READY | Calendar/timeline observed; full matrix pending | Earlier live answer; repeat pending |
| Andre | failed; earlier READY | Same family/job/calendar observed; full matrix pending | Tool-error response; pending rerun |
| Loretta | failed; earlier READY | Calendar check incomplete; pending | Pending |
| Priya | failed | Pending | Pending |
| Dana | failed | Pending | Pending |
| Jax's family | failed | Pending | Pending |
| Demo guide | failed | Pending | Pending |
| Rosa Castellano | Coming soon, not chosen | Pending seed | Pending |

Bryan instructed: **finish with remaining live checks pending**. No credential file, alternate
mint helper or replacement identity was used to work around the unavailable service. The shared
backend was not restarted, reconfigured, reset or seeded by this task.

## Response contracts and directory clarification

Bryan confirmed: **follow documented directory access; still test private-record refusals**.
The prior draft's identity-hiding assertions were wrong for evidence 37's documented authenticated
directory posture. Their old failed receipts remain untouched. The replacement harness permits
those directory identities and retains private household/candidate/calendar boundaries, including
the guide's non-sandbox event refusal. This is not a backend privacy fix or a claim that the old
checks passed.

Each Group 3 operation keeps its own contract: childEvents/effectiveScheduleFor/scheduleConflicts
refusals are distinct from authorized empties; adultAvailability hidden/nonexistent/malformed
lookups stay empty reads. The calendar uses these exact outcome messages:

- Authorized empty: “No records are available to this view”
- Refusal: “This isn't shared with you”
- Upstream failure: “Couldn't load this just now”

No array emptiness is reclassified as an authorization error. The old Mission Control empty state
was also corrected to preserve the empty read while offering role guidance. The stored simulated
job is labeled **Sample activity**. Its destination badge is not proof that a call or text was sent.
No live mutation or automatic message/mutation replay was introduced.

## Missing fields, not substituted facts

The delivered CalendarEvent has id/title/start/end/location/status. It has no category, participant
list, confirmer, confirmation time or linked records. EffectiveSchedule has parent/source/
arrangementId, not full holiday metadata or proposed arrangements. School-closure day kind exists
in a server helper but is not exposed by these GraphQL reads. Those fields remain visibly
unavailable; event titles are not parsed to guess a category or school closure. No mock weekly
rule or HolidayArrangement object is built from daily effective answers.

The current fixture has a Busy window and a cancelled event. Live FREE/proposed-event examples are
not claimed: those renderings are unit-tested against explicit contract-shaped test fixtures.
No Busy reason is queried, stored in the calendar projection or rendered. FREE means “free time
recorded”, never willingness or permission to provide care.

The normal W1 proxy remains 4010. Introspection proved that router does not yet expose Group 3;
4012 does, matching evidence 41. This local harness explicitly overrides its own GraphQL proxy to
4012, without automatic endpoint probing/fallback. The normal backend needs a schema reload before
its default endpoint can serve the new reads. Start-based event/availability range reads also need
an overlap/civil-date contract before arbitrary carry-in events can be claimed live-tested.

## Verification, screenshots and reproduction

Offline checks: **206 web tests PASS**, root typecheck PASS, web typecheck/build PASS, shared
Rosina catalog drift PASS (7 ids). Final staged secret-scan result is recorded in HANDOFF. Tests cover the real nested login contract, renewal/
backoff/generation guards, no replay, read-only guide, live calendar source/status/toggle behavior,
Busy/Free privacy, cancellation and all three outcome wordings. Mock sign-in remains explicitly
dev/test only. Village v2 and care remain Sample data; live calendar failures never become fixtures.

Screenshots here include picker, actual Kendra/Andre landings/calendars/Rosina, the stored Mission
Control timeline, cancelled toggle, and the later retryable failure states. Remaining refreshed
persona/guide screenshots are pending the login service; historical parent-folder images are not
presented as new results. No trace, HAR, video, storage-state capture or header logging was enabled.

In-process leak scans PASS on completed/incomplete runs; only filenames + pass/fail are reported.
The initial authenticated run scanned the issued credentials in memory; the later failed-login run
issued none. Protected credential/data paths, dependencies, symlinks and .git are excluded. Generic
matches are inspected patterns/redactions/integrity text/binary occurrences; no matching content or
credential fragment is printed. This is not a full-filesystem/history audit.

With login restored and the documented local stack running:

```sh
node web/scripts/demo-login-smoke.mjs
```

Pending: restore demo login and rerun the full persona matrix; expose school-closure/day-kind and
missing event metadata/holiday reads; live child enumeration; Cast v2 seed for four personas and
six-family guide breadth; Village v2 live reads; Orbit screens after Bentley's Task O; public judge
access and the Try FridgeGraph landing button in Task H. Group 5 reset/create-family services remain
queued in W4. This task does not merge.

Standing reservation rule: the default live harness now reads the current shared main checkout's
HANDOFF operations table before any browser/login/API request. An active/unknown restoration state
defers the run. On 503 or unexpected empty fixture data, check that HANDOFF first and retry only
once Bentley marks restoration complete. The last check found Group 4's 21:40 window in progress;
no further live run was started. These interruptions are not classified as product bugs.

Andre's interrupted-tool response is NOT counted as a correct permission refusal or a grounded
answer. The screenshot records, verbatim:

> I can't confirm who is authorized to pick up Nora today.
> The pickup records came back empty with an error — that's the graph protecting the family, not a bug. Authorization is who may be allowed, which is separate from availability for today, and I can't confirm either from that empty result.

The family-protection explanation was not established by the interrupted tool result. Rerun after
the shared stack is restored before drawing a product or authorization conclusion. Kendra's saved
response did name the actual four candidates and preserve UNKNOWN availability. No frontend text
rewrite concealed either response.

## Supplemental perspective switch

`isolation.json`: **PASS — 120 observed frames, zero private-content leaks**, actual Kendra → Dana
picker path; Calendar and Rosina cleared, Mission Control empty for Dana, bounded sample Village.
Independent token scan PASS. The first harness attempt timed out waiting for Calendar after Dana's
landing; it omitted the explicit Calendar navigation. The navigation was corrected, privacy
assertions unchanged, and the actual browser run passed. Guide read-only captures show the product
UI; the forced-write refusal remains proven separately by the full acceptance run's explicit click.

## Current-main reconciliation

Authorized merge commit **17259ec** has parents `e8dd04a` and `593e794` (current main #36/#37).
Only HANDOFF conflicted; both workstreams are retained. Session/cache protections were unchanged.
Offline post-merge checks: 206 web tests, 33 Rosina tests, root typecheck, web typecheck/build,
catalog and reservation guard PASS. GitHub CI passed both checks on the merge commit.

`merge-interrupted-results.json` preserves the first post-reload failure: the backend serving
worktree lacked its runtime identity-map path. Bentley fixed process startup by path, no copy,
then marked restoration verified before the retry. No web workaround or alternate login used.
`merge-binary-review-results.json` preserves passing browser assertions with one generic marker
flag in a refreshed PNG. Visual/binary inspection found no visible token or JWT-shaped content.
The scanner and acceptance assertions are unchanged for the final rerun. Final results follow.

Final post-merge full run: **PASS** — seven READY personas, no assertion errors, two contexts PASS,
all private-operation outcomes PASS, and in-process token-leak scan PASS. The operation receipt
audit and forbidden-read negative control PASS. Current full receipt remains `results.json`.
#37-specific live checks also PASS: Kendra's Thanksgiving answer names Andre via an approved
arrangement, matching the screen; Dana gets exactly “I can only help with children shared with you.”
These replies are retained verbatim under `calendarRosina`.

The prior single 45-second visible-reply timeout remains unexplained and preserved, not called
fixed: server logs showed completion in ~5 seconds, an isolated actual-picker diagnosis returned
HTTP 200 and rendered the correct refusal, and the instrumented unchanged full flow then passed.
No production behavior, 45-second limit or acceptance assertion was changed.

W4b's stated slice: UI complete · backend documented session/delivered reads complete ·
integrated + tested PASS. Broader W4 read-contract/seed/hosting dependencies remain separately
PENDING and do not block this slice's review, per Bryan. No PR merge.

## All-eleven picker update and pending wording matcher

`picker-ready.json`: PASS, all eleven actual picker sessions; desktop/mobile picker and eleven
landings refreshed, token scan PASS. UNAVAILABLE behavior stays in controlled unit responses.
Rosa/Felicia/Simone/Dwayne's expanded private-read and Rosina integration is separately pending.

`main38-matcher-failure.json` captures a matcher defect: Jax's reply correctly says “no availability
recorded — authorization is permission, not a promise she is free,” matching the tool's UNKNOWN
value. The new matcher does not recognize that equivalent phrase. AGENTS §1.4 stop applies;
authorization to correct the matcher with a rejecting negative control is pending. No assertion
was weakened or failing receipt relabeled. W-ORBIT is queued after #32 is merged by Bryan.

## Authorized matcher correction

Bryan approved accepting “no availability recorded” as absent records. The original failed receipt
is unchanged. A regression reads that actual receipt; negative controls reject “nobody is available”,
UNKNOWN → confirmed availability, and FREE → confirmed willingness (even alongside a correct
uncertainty disclaimer). Old logic failed 5/6 groups; corrected helper passes 6/6. No production
behavior or response was rewritten. Current live rerun results will be appended separately.

## Corrected acceptance — final current-main result

Bryan approved the matcher correction. Final helper tests **7/7 PASS**, including the exact original
failed receipt, nobody-available conclusions with and without candidate rows, unsupported positive
availability claims, and FREE-to-willingness conclusions (also “so”, “therefore”, “because”, “can
help”, “available to help”). Explicit limits on FREE and actual recorded availability still pass.
The helper is a bounded acceptance-language check; source records remain authoritative. The original
failed receipt remains unchanged and false. Corrections/results are appended here and in HANDOFF.

Affected live rerun **PASS** (`rosina-captures.json`): seven scoped Rosina flows, actual current
candidate grounding, calendar consistency, exact Dana boundary refusal, disabled unimplemented Orbit
card, and all eleven picker sessions. Final token scan PASS; desktop/mobile captures refreshed.
The final helper was also audited against all five current grounded candidate replies: PASS.
All eleven READY and landing checks also have the independent `picker-ready.json` receipt.
UNAVAILABLE behavior remains covered only by controlled unit responses, not stale live expectations.

Offline checks: 206/206 web tests, 53/53 Rosina tests, root typecheck, web typecheck/build, 8-entry
catalog consistency and 3/3 reservation guards PASS. Existing full graph/context/frame-isolation
proofs remain valid; #38 changed no schema/session/cache code. W4b slice: UI complete · backend
documented reads complete · integrated + tested PASS. Expanded Cast v2 breadth and other broader
W4 dependencies remain separately PENDING. Read-only window explicitly released to Bentley after
completion. No reset, seed, restart or checkout switch by this task. Final CI/readiness publication
is recorded in the PR; no merge. W-ORBIT starts only after Bryan merges #32.
