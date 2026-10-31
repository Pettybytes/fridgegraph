# W4b local browser evidence

UI complete · backend sessions and recorded pickup reads delivered, v2 reads partial · integrated +
tested partial. **NOT DONE: full live isolation smoke FAILS six directory-name checks.**

The full local smoke (`results.json`) ran seven READY perspectives and Rosa's terminal unavailable
state. This uses only `/api/demo/login`; no credential file or ops/auth helper. Default public UI
requires one click and never substitutes another identity. Traces, HAR, video, storage-state dumps
and request-header logging were never enabled. Sessions and scanner needles stayed in process
memory. No mutation was replayed. The only write probe was a visible, explicit confirm click with
the guide's own bearer; the server refused it before record lookup.

| Persona | Picker | Live reads | Rosina |
| --- | --- | --- | --- |
| Kendra | READY | Private reads pass; same stored job and 5 timeline entries as Andre. Directory isolation pending (failed) | Live answer, candidate names + unknown availability match actual read |
| Andre | READY | Private reads pass; same stored job and 5 timeline entries as Kendra. Directory isolation pending (failed) | Live answer |
| Loretta | READY | Schedule + approved goals pass; care/household/candidates correctly refused. Directory isolation pending (failed) | Correct refusal; care tool pending |
| Priya | READY | Schedule + care-plan scope pass; goals/household/candidates correctly refused. Directory isolation pending (failed) | Correct refusal; care tool pending |
| Dana | READY | Jax reads pass; Nora private records correctly refused, including after switching. Directory isolation pending (failed) | Live answer; date caveat below |
| Jax's family | READY | Jax reads pass; Nora private records correctly refused. Directory isolation pending (failed) | Live answer |
| Demo guide | READY | Sandbox child/candidate/care/schedule/job reads pass; forced write refused. Household/goals refused; broader live topology pending | Live answer |
| Rosa Castellano | Coming soon | Pending: no seeded identity; disabled and not chosen | Pending; no substitute |

All six family personas correctly refused the other family's household, pickup candidates,
care plan, schedule and goals. Schedule permission probes return empty lists on the explicit
2026-10-30 date; permission success does not prove a v2 calendar or an event exists that day.
Care permission probes select the child reference only, not care-plan contents. Village v2,
Calendar and care screens remain explicitly **Sample data**. The v1 care-plan permission probe
is not a claim that v2 CareFacts or Rosina's care read are integrated.

## Failed boundary gate, preserved

`child(id: otherChild) { person { id displayName } }` returns Jax's directory identity for Kendra,
Andre, Loretta and Priya, and Nora's identity for Dana and Jax's family. The full harness exits
nonzero and retains these six failed assertions. These probe results were not rendered into
product views and were not used to populate cards. No assertion was weakened to call this green.

This matches the pre-existing directory posture documented in evidence 37's E2c honest gaps
(`children_read` / `people_read` allow identified users). Bentley must reconcile that posture with
the stricter persona isolation requested here; no web filter can prove server enforcement.
Guide `householdMembers` and `goals` refusals are also recorded, not filled with fixtures. E2e
explicitly keeps village topology parent-only. The six-family guide view remains labeled sample.

The generic Rosina boundary response in this run was, verbatim:

> I can't share another family's child details — that directory isn't connected yet.
> For the care plan part: I can't confirm that yet.
> Which child did you mean?

No foreign child's name was introduced. This one successful rerun does not erase W4a's historical
service regression or prove all future requests safe. All seven exact questions and replies are
preserved in `results.json`.

Date grounding follow-up, verbatim Dana reply:

> Evelyn Carter is authorized to pick up Jax today, but her availability is unknown.
>
> Per the pickup records, she's listed as grandmother with a grant valid 2026-10-31.

The run occurred on October 30 in Detroit; the quoted October 31 date needs Task R/Bentley review
of the service/tool's meaning of "today". Candidate identity and UNKNOWN availability matched the
actual read. No frontend rewrite hid the wording.

## Isolation and leak checks

Two concurrent browser contexts: A stayed Kendra while B chose Dana and switched to Andre; A's
identity and in-memory session did not change. Additional visual run (`visual-results.json`):
Kendra → Dana sampled 32 animation frames with zero surviving Nora pickup records. Unit tests
also check synchronous DOM/cache clearing, aborts, generation guards, late logins/renewals, and
late GraphQL/Rosina responses. No sign-out/revoke endpoint is called.

Both in-process token-leak scans PASS: no held token or its first twelve characters on disk;
no new generic JWT-prefix matches. Existing generic matches were inspected without printing
matching content: redacted historic evidence, a scanner/example pattern, package integrity text,
and a binary PNG occurrence; no full JWT-shaped string was found. Filenames are recorded in the
receipts. Coverage includes this worktree, web/evidence, test-results if present and Playwright
output; protected credential paths, data, dependencies, symlinks and .git are excluded. No
full-filesystem or history audit is claimed.

After rebasing onto #29 (558796a), the seed source identified the stored job as SIMULATED.
The live view therefore says “Stored pickup record”, explains that sending is unverified, and
never claims execution from persistence. Destination-mode badges describe the recorded mode,
not proof of dispatch. Bentley must expose execution provenance/delivery evidence before the
UI can call a job an executed run. No field or delivery fact was invented.

The earlier `attempt-*-*.json` receipts remain as failed/incomplete runs. Initial transport failures
revealed that the router accepts `/` and required the web proxy rewrite; the local Rosina service
also had to remain running. One later run was interrupted during development; the final full
receipt is `results.json` (the earlier Dana date quote above remains in attempt 6), not any earlier screenshot or result.

## Screenshots and reproduction

Desktop/mobile picker, each READY persona's landing and live Rosina conversation, guide read-only
state, generic boundary, and recorded Mission Control are in this directory. Dedicated
`mission-control-timeline-{desktop,mobile}.png` scroll to actual recorded activity. The read-only
refusal screenshots include a temporary harness confirm button and mapped real server refusal;
that button is not shipped product UI. Guide village landing is labeled Sample data.

Run with the existing graph/router on 4010, demo session server on 4008 and Rosina on 4200:

```sh
node web/scripts/demo-login-smoke.mjs
DEMO_SMOKE_VISUAL_ONLY=1 node web/scripts/demo-login-smoke.mjs
```

The first command intentionally remains nonzero while the six directory isolation failures remain.
The second tests screenshots/frame isolation only and does not override the full gate. Do not enable
network captures or save session state. The harness starts/stops only its own Vite/browser/bridge.

Local automated verification: **197 web tests PASS**; root typecheck PASS; web typecheck/build PASS
(existing chunk-size advisory); shared Rosina catalog drift check PASS (7 ids). Root staged secret
scan is recorded in HANDOFF after the final staged check.

Remaining: Cast v2 seed for Rosa/Felicia/Simone/Dwayne and six-family guide breadth; guide topology
contract; Village v2 events/relationships/directory visibility and Calendar event/holiday/busy-free
reads; v2 care read/tool; real reset/create-family endpoints; Task H public judge access and the
Try FridgeGraph landing button. No live approval, reset or family-creation mutation was enabled.
