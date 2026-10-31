# W4b replacement brief — current evidence

Base: fetched origin/main **0d80f003c722e009897b1790c461952cd0de6f66** (#31), including #27/#28/#29.
Existing draft #32 is being reconciled to the replacement brief. Previous evidence in the parent
folder is historical; it does not prove this replacement run complete.

UI: live-capable for delivered fields · backend: sessions/Group 3 reads delivered, field gaps remain ·
integrated + tested: **partial, NOT DONE**.

## Actual live observations

The first run reached real Kendra and Andre sessions, the stored sample pickup timeline, live
Rosina replies, and both live Thanksgiving calendars through router **4012**. Desktop/mobile
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

| Persona | Latest picker attempt | Live reads in replacement run | Rosina in replacement run |
| --- | --- | --- | --- |
| Kendra | failed; earlier READY | Calendar/timeline observed; full matrix pending | Earlier live answer; repeat pending |
| Andre | failed; earlier READY | Same family/job/calendar observed; full matrix pending | Earlier live answer; repeat pending |
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
