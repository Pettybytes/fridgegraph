# Mission Control data coverage

The read-only coverage probe is caller scoped. Its child roster comes from `myChildren`, never
from a hardcoded family roster. Each source independently reports ready, refused or failed;
missing fixture IDs are recorded separately. Source-library counts are not seeded-record counts.

## Checkpoint B: all-family history reads, November 4 UTC / November 3 Detroit

Source fixes merged in #220, #223, #224 and #225. Latest frontend target:
`a32882d864b6c853cee71d74b427e4b54bbb3eb3`. The observed served asset changed from
`index-BrdDul22.js` to `index-ClVmtU1h.js`; its exact served SHA still needs Bentley's receipt.
Claude owns served acceptance. This report does not mark any QA matrix cell PASS.

Fresh reads after the simulated seed succeeded for all eight parent/guardian personas. Every one
of the 216 simulated PICKUP IDs was present across all ten authorized children. The supplement
contributes 204 stable versioned requests spanning October 5 through November 3, 2026, Detroit.
The following counts are returned records, not physical pickups, deliveries or approvals.

| Family / perspectives | Authorized children | PICKUP jobs, all dates | School reports | Calendar/activity records | Consent slips | Current care information | Invitation jobs | Latest Orbit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Ellison / Kendra | Nora, Leo, Max | 27 / 18 / 19 | 3 / 3 / 3 | 57 / 49 / 43 | 2 / 2 / 2 | All three plans; Nora has 3 fact records | 0 | Nora ACTIVE; no alert returned for Leo or Max |
| Ellison / Andre | Nora | 27 | 3 | 57 | 2 | Plan and 3 facts | 0 | Same Nora alert |
| Coleman / Dana, Ray | Jax | 25 | 3 | 56 | 2 | Plan; no fact records returned | 0 | No alert returned |
| Castellano / Rosa | Emma | 23, including one future request | 3 | 50 | 2 | Plan and 3 facts | 0 | No alert returned |
| Reyes / Felicia | Taylor, Skye | 20 / 18 | 3 / 3 | 51 / 41 | 2 / 0 | Both plans; no fact records returned | 0 | No alert returned |
| Lee / Simone | Micah, Avery | 23 / 19 | 3 / 3 | 51 / 41 | 2 / 0 | Both plans; no fact records returned | 0 | No alert returned |
| Ferris / Dwayne | Malik | 24 | 3 | 49 | 2 | Plan and 3 facts | 0 | No alert returned |

Calendar counts use the October 5 through November 17 read window. The additional 32 events from
#224 are not yet in these live results: every child's November 17 pickup is still absent. Bentley
must run the baseline seed from the latest target. That is a missing-record dependency, not a
rendering diagnosis. The information-request fixture array is empty; this probe does not assert
an operational care-request history. Calendar entries do not establish attendance, and a current
care plan is not a history of care-plan revisions. Invitation-job counts do not establish sending
or delivery. A latest Orbit status is not a historical Orbit-event total.

Kendra/Andre Nora payloads and Dana/Ray Jax payloads matched for jobs, school, calendar, consents,
care facts/plans and Orbit. Household membership is caller-specific and is not compared as a
family-wide roster. Andre's authorized child remains Nora only. All unrelated-child job probes
returned empty, RLS-filtered lists; that does not prove records are absent from the other family.

The optional boundary probe checked 33 recorded creation timestamps, including repeated co-parent
reads. Each matched its source UTC instant, covering first/last dates for all children and sampled
November 1 clock-change records. Source/model boundary tests and the isolated database rehearsal
remain separate evidence. The rehearsal preserved all 204 new history rows and all 478 generated
calendar events identically across two real resets, with unrelated data preserved.

An intermediate Kendra login received HTTP 429. A later read after the cooldown succeeded. Some
snapshots straddled the live seed: older Andre reads had two total Nora jobs, while the later
Kendra read had 28 total jobs including the existing Orbit job. Only fresh post-seed reads were
used for the co-parent comparison above. Failed reads and changing data states are not zeros.

Probe commands:

```sh
node --import tsx ops/mc-analytics-coverage.mjs
node --import tsx ops/mc-analytics-coverage.mjs --live
node --import tsx ops/mc-analytics-coverage.mjs --live --history-boundaries
node --import tsx ops/mc-analytics-coverage.mjs --live --persona=kendra
```

Credentials stay in memory. Sanitized report files go under `.runs/mc-analytics/`, never into a
commit. The probe does not seed, reset, mutate, notify, dispatch, or call the model service.

## Checkpoint A: read path, 2026-11-03

Baseline source: `83d6957`, subsequently rebased onto `122f7e7`. Served origin:
`http://127.0.0.1:5189`. The read-only probe is
`node --import tsx ops/mc-analytics-coverage.mjs --live`. It keeps login sessions in memory and
writes sanitized results under `.runs/mc-analytics/`. It performs no reset, seed or mutation.

All eight parent/guardian personas signed in and read their authorized children successfully.
These are observations before the all-family seed enrichment in PR #220 was deployed. Numbers
below count returned records, not completed workflows. Calendar window: October 5 through
November 17, 2026. Times are displayed in America/Detroit.

| Family and perspectives | Authorized children | Pickup jobs | School updates | Calendar entries | Consent slips | Care information | Invitations | Supported Orbit records |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Ellison: Kendra | Nora, Leo, Max | 1 / 0 / 0 | 0 / 0 / 0 | 6 / 0 / 0 | 0 / 0 / 0 | Nora: 3 facts + plan; Leo/Max: no returned facts or plan | 0 | Nora: 1 job + latest ACTIVE alert; Leo/Max: no returned alert |
| Ellison: Andre | Nora | 1 | 0 | 6 | 0 | 3 facts + plan | 0 | Same Nora job and latest alert |
| Coleman: Dana, Ray | Jax | 0 | 0 | 5 | 0 | Plan, no facts returned | 0 | No returned alert |
| Castellano: Rosa | Emma | 1 | 0 | 5 | 0 | 3 facts, no plan returned | 0 | No returned alert |
| Reyes: Felicia | Taylor, Skye | 0 / 0 | 0 / 0 | 5 / 5 | 0 / 0 | No returned facts or plan | 0 | No returned alert |
| Lee: Simone | Micah, Avery | 0 / 0 | 0 / 0 | 5 / 6 | 0 / 0 | No returned facts or plan | 0 | No returned alert |
| Ferris: Dwayne | Malik | 0 | 0 | 5 | 0 | 3 facts, no plan returned | 0 | No returned alert |

Kendra and Andre returned identical Nora jobs, school records, calendar entries, consents and care
facts. Dana and Ray returned identical Jax records for those sources. Household member reads differ
by caller household, as permissions intend. Andre does not receive Leo or Max in `myChildren`.
Every tested unrelated-child coordination read returned an empty list. An empty RLS answer is
recorded as an authorized read with no visible rows; it does not prove the other family's records
do not exist. Broader isolation and negative-perspective checks remain acceptance work.

### Where the gaps occur

- `createDemoHistory()` contains 20 Nora pickup stories. `resetDemo()` imports it; the ordinary
  `seedDatabase()` and `seedSimulated()` paths do not. Its presence in source does not establish
  that its rows were inserted. No `job_hist_*` rows appeared in the observed live job read.
- The baseline and Cast v2 fixture sources have no school reports or consent slips before #220.
  The empty live reads match those source gaps. All-family histories are absent, rather than
  hidden by a rendering condition.
- The existing delivered adapter carries jobs, attempts and timelines for `scope.childId` only.
  It does not carry the other supported contexts or every authorized sibling. The old pulse's
  fixed 30-date window and generic page links cannot provide exact-record drilldowns.
- Activity reads school reports and consent decisions separately. Care information reads the
  current care plan only. Calendar reads `childEvents`. Sharing these canonical records avoids
  introducing a second analytics-only history.
- The activities subgraph supports team practices by date. `groupEvents` explicitly has no source
  table and returns an empty list. Analytics uses scheduled calendar entries and labels them as
  such; it does not invent operational activity outcomes.
- Invitations support `INVITATION` coordination records. Their existence cannot prove image
  generation, sending or delivery. Provider budget/accounting data is outside this task.
- Orbit supports visible coordination jobs and a latest-alert read. A latest alert cannot establish
  the full historical alert count. Recipient reports and parent closure remain distinct facts.
- A brief login HTTP 502 window and failed pulse read were reproduced. After the shared-stack
  changes, fresh login and the same Mission Control browser read succeeded. This incident is
  separate from the sparse data. An API failure is never converted into an empty dataset.

The design owner released the Mission Control mounts to Codex on issue #78. Codex owns the
retained Mission Control, Calendar, replay, Orbit, map and Rosina fixes; the shared token/card
system remains coordinated with its owner. Today, Care information and Living Village belong
to `fix/pages-today-care-village`.
Codex owns #220's `fx_pr_*`, `fx_sr_*`, `fx_ps_*`, `fx_job_*` and `fx_att_*` records.
Any additional history uses a separate versioned source and prefix. Bentley owns live application,
rehearsal scheduling, restarts and deploys.

## Remaining acceptance and deferred analytics

The current delivered Mission Control adapter reads `scope.childId`. All-child range filtering,
clickable buckets and exact-record drilldowns are deferred behind visible fixes at Bryan's request.
The existing pulse separates attempts from delivery and confirmation records from status-only
approval claims. Any future latency measure requires correctly paired recorded timestamps and
sample sizes; no response, approval or physical completion is inferred from silence.

Bentley owns the deployment, shared baseline/simulated seeds and live-map build flag. Claude must
verify the actual served revision, every family, phone behavior and the supported Orbit flow.
The whole task remains open until that deployed build passes.
