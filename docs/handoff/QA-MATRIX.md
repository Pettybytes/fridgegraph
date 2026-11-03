# QA matrix, pristine pass (fix owner: Codex; acceptance: Claude)

## Current fix checklist, November 3

Claude marks PASS after checking Bentley's served build. Local implementation checks do not
change the historical results below.

| Slice | Implementation | Served acceptance |
| --- | --- | --- |
| #220 fixture copy | Em dashes removed from generated care plans, reports, achievements and closure labels; regression guard added | Pending Bentley deploy and Claude |
| #220 all-family history | Fixed October 5 through November 3 Detroit window, all ten authorized children; 216 simulated jobs and 200 closed test attempts in the source | Pending Bentley seed and Claude |
| Mission Control copy and evidence | Removed approval-unavailable sentence; status-only confirmed rows do not claim parent approval; chart colors use shared tokens | Pending Bentley deploy and Claude |
| Replay | First-frame cards implemented in #220 | Pending Bentley deploy and Claude |
| Calendar | Light cards and dense calendar fixtures in #220 | Pending Bentley deploy and Claude |
| Orbit | Retained by Codex | Pending fix and Claude |
| Map sample label | Retained by Codex; must follow actual provenance | Pending investigation |
| Rosina live proof | Retained by Codex; requires served runtime | Pending Bentley runtime and Claude |
| Today, Care information, Living Village | Owned by fix/pages-today-care-village | Separate PR and Claude |

The new requests are recorded, ended coordination attempts. They do not assert a physical pickup
outcome, delivery or parent approval. The pre-existing Nora/Jax fixtures retain their separate
recorded statuses. The new history uses stable IDs and no dispatchable state. Bentley must seed
both the baseline cast and simulated layer; `db:seed` alone does not insert simulated jobs.

Served build under test: `http://127.0.0.1:5189` (Bentley deploy `bbe11a4`, web asset `index-BrdDul22.js`, backend branch `fix/orbit-alert-job-type` @ `eda19e3`).

Method: every cell is page x persona x viewport on the SERVED build. A cell is PASS only with a
screenshot from the served build showing rich seeded data, no failure strings, and the design-v2
look. Screenshots are attached to the fix PRs (receipts live in PRs and chat, not in-repo).
The automated form of this matrix is `web/e2e/pristine.spec.ts`
(`PRISTINE_BASE_URL=<origin> npm --prefix web run test:e2e:pristine`): every persona, every
rendered nav page, desktop + 390x844 for kendra/dana.

Legend: FAIL-R = failing read / forbidden string. FAIL-D = data too thin for the demo bar.
FAIL-V = visual (design-v2) failure. PEND = blocked on redeploy, re-verify before marking.

## Sweep of 2026-11-03 22:45 ET (pre-fix baseline, Kendra + Dana, 1440x900 and 390x844)

| Page | Kendra desktop | Kendra 390x844 | Dana desktop | Dana 390x844 |
| --- | --- | --- | --- | --- |
| Today | FAIL-R/V ("unavailable", judge checklist not design-v2) | FAIL-R/V | FAIL-R ("Couldn't load this just now", Rosina "couldn't check") | FAIL-R |
| Village map | FAIL-D ("Sample data · no live locations") | FAIL-D | PASS-ish, re-verify | PASS-ish, re-verify |
| The Fridge | ok, re-verify post-redeploy | ok | ok | ok |
| Mission Control | FAIL-R/V (all 6 pulse tiles "Couldn't load request records"; mountain photo backdrop; empty replay phones) | FAIL-R/V | FAIL-R/V ("Couldn't load Orbit status", "No recorded pickup run") | FAIL-R/V |
| Activity | FAIL-R ("Activity feed unavailable") | FAIL-R | FAIL-D ("No records are available to this view") | FAIL-R (503) |
| Orbit | FAIL-D (flow untested e2e; "No response yet" x3) | FAIL-D | ok-ish, flow untested | ok-ish |
| Family Calendar | FAIL-V/D (dark theme, nearly empty, "No records are available to this view" x2) | FAIL-V/D | FAIL-V/D | FAIL-R (503) |
| Invitations | ok, re-verify | ok | ok | ok |
| Ask Rosina | ok panel; live answer + Orbit prep untested | ok | FAIL-R (fallback "I couldn't check that just now" seen on Today) | same |
| Care information | ok (Nora) | ok | ok desktop | FAIL-R (503) |
| Living Village | ok render, needs n8n-language polish | ok | FAIL-R ("Couldn't load this just now") | FAIL-R |

Ten further personas (andre, loretta, priya, jax-family, rosa, dwayne, felicia, simone,
whitfield, demo-guide) are covered by the automated gate; cells get hand-verified screenshots
as their pages are fixed.

## Root causes found (with evidence)

1. **GraphOS Free-plan router rate limit** on the /graphql edge (4010):
   `ROUTER_FREE_PLAN_RATE_LIMIT_REACHED`, 4/40 parallel reads 503, 21/80 in the stack-health
   repro; self-contained router (4012) took 120/120. Every "Couldn't load / try again later"
   cell above reproduced this way; each page operation succeeds individually as both personas.
   Fix: PR #220 (proxy targets 4012 by default; stack-health 80-parallel check proven red on 4010).
2. **ORBIT_ALERT poisoned coordinationJobs** — "Activity feed unavailable" (Bentley's b89d721,
   landed in PR #220).
3. **Thin seeds**: 0 permission slips, 0 school reports, 0 villager additions, 0 availability,
   0 conflicts, 5-6 calendar events per child in a 44-day window; carePlan exists only for a
   subset. Violates "rich, coherent fictional data" on every page.
4. **Hardcoded read gates in web/**: `features/rosina/adapter.ts` answers "not available in this
   view" for any child except p_nora; `features/personas/careInformation.tsx` mock path gates on
   p_nora. Both hide seeded data from the family that owns it.
5. **Design-v2 failures**: Mission Control mountain-photo backdrop (pulse-backdrop-*.webp) instead
   of the light sky; dark, type-colourless calendar; judge checklist not the horizontal card
   family; three-phone replay shows empty phones on loud gradients.

## Fix slices (merge -> Bentley deploys -> re-verify on served build)

- [x] Slice 1 — stack read-path health: PR #220 (proxy to self-contained router, ORBIT_ALERT,
      stack-health burst check, pristine e2e gate). Deploy flip owed by Bentley.
- [ ] Slice 2 — Mission Control + Family Calendar (Bryan items 1, 2): sky backdrop self-hosted
      app-wide, pulse tiles with type colours, light calendar full of activity.
- [ ] Slice 3 — seeds: calendar/care/slips/reports/availability for every parent family,
      past 30 + next 14 days.
- [ ] Slice 4 — Today: judge checklist as design-v2 horizontal cards (item 4); remove
      "unavailable" copy from happy paths.
- [ ] Slice 5 — Orbit active/found-safe end to end with warp, no old-card flash (item 3).
- [ ] Slice 6 — Care information + Ask Rosina live for every family; remove hardcoded gates
      (items 5, 7).
- [ ] Slice 7 — Living Village render + n8n UI language (items 6, 9); three-phone replay
      re-skin (17:34 addition).
- [ ] Final — pristine gate green for all 12 personas on the served build; matrix all PASS.
