# Contract — Coordination v2 (whole-life foundations)

**Status: DRAFT — ready for Bryan's approval as of Revision 4. Docs only; no code, no schema
change, no data write has happened to produce this file, in any revision.**

Branch `docs/coordination-v2`, worktree `../fridgegraph-coordination-v2`, created from
`origin/main` at **base SHA `72c1cf54cf98a370e43ff39e22bb52d9f513b971`**
(`72c1cf5 Meta Model API: verified values, blocked on the key (evidence 31) (#15)`, 2026-10-30).

**Revision 2 (2026-10-30):** approves the eight Revision-1 open questions as Decided; renumbers
every proposed migration around a numbering collision with `feat/level-b-drafts` (PR #9); replaces
the single "Sunday is the target" line with a three-tier schedule and a concrete Orbit tradeoff;
adds a full Cast v2 (six family networks); separates relationship, residence, caregiving
responsibility and approval authority into distinct facts, with a literal audit of every existing
resolver/function/policy that needs to change; adds adult schedules (parents/guardians, sitters,
teachers, other caregivers); restates the seed budget precisely; and adds the matrices this
revision's own rules require as deliverables.

**Revision 3 (2026-10-30):** restructures §11 into four tiers — Sunday (now including the adult-
schedules *minimum* slice) / **P0 parallel work** (the persona picker, PR #19, and live Ask Rosina
integration, PR #20 + Bentley's backend — correctly not "deferred," since both are already
underway in other workstreams) / Before Nov 4, ranked (unchanged order, plus the adult-schedule
editing UI) / **awaiting Bryan's choice** (only School's live authoring flow and visual polish —
nothing else is left unscheduled); adds a Sunday risk note (trim BACKBONE first, never a family,
a STORIES event, or the adult-schedules minimum); corrects §9.5's Dana row, which had overclaimed
"full access" where the evidence (`11c`, `11c2`, `11d`) shows only one bounded `pickup.request`
grant, and re-checks every other persona row against the same standard; corrects "60–80 connected
STORIES events" to "60–80 historical events total, grouped into connected stories" everywhere it
appeared; and updates Area G now that `docs/contracts/ask-rosina.md` exists (PR #20) and already
correctly reserves this contract's future entries rather than guessing at them.

**Revision 4 (2026-10-30) — final before approval:** moves visual polish (§7) out of "awaiting
Bryan's choice" into the scheduled plan as weekend work (Sunday afternoon + Monday morning; Claude
Code leads, Codex owns shell changes), leaving only School's live authoring flow as the one
genuine open item; and adds the Family Calendar as its own P0 parallel-work deliverable — owner
Codex, built against Area A's event model and the adult-schedules minimum slice, target Sunday,
starting once the events migration lands — activating the deferral `ask-rosina.md` itself already
named, now that there's an event model to build against.

## 0. Goal and how to read this

FridgeGraph should cover the child's whole life — not just pickups — without reworking what
already works. This contract designs the shared foundations as a sequence of small, additive
migrations. **Pickup is the only implemented workflow today and must keep working, unchanged,
throughout.**

Every fact below carries one status tag, and — per this revision's instruction — **status and
implementation are two separate columns, never conflated**: a row can be **Decided** (Bryan has
approved the design) while still **NEW-PROPOSED** (nothing has been built yet).

| Tag | Meaning |
| --- | --- |
| **EXISTING** | present in `schema/*.graphql` today, cited to file:line |
| **IMPLEMENTED + EVIDENCED** | built, running, and proven in `docs/evidence/<file>` |
| **IN SCHEMA** | declared in SDL but has no resolver/evidence (e.g. an unused enum value) |
| **NEW-PROPOSED** | this contract's request; nothing in this status exists yet |
| **OUT OF SCOPE** | explicitly not building this round |
| **DECIDED (2026-10-30)** | Bryan has approved the design — orthogonal to the five tags above, which still describe whether code exists |

Timezone for every scenario date below: **America/Detroit** (`data-model.md` §7). Seed history
dates are fictional calendar dates inside the seed, never read from `DEMO_CLOCK`, never driving
RLS's `current_date` — the same separation already documented for the real auth clock vs.
`x-demo-date`.

---

## 1. Decided (2026-10-30)

Bryan approved all eight Revision-1 recommendations as written. Each stays **NEW-PROPOSED** for
implementation status — a decision is not a build.

| # | Decision | Implementation status |
| --- | --- | --- |
| 1 | One narrow cross-subgraph helper, `createProposedEventFromReport`, called only from `fileSchoolReport` (Area E), never generalized into a third caller without coming back to `data-model.md` §2. | NEW-PROPOSED |
| 2 | Add a fourth `CoordinationType: SUPERVISION`, reusing pickup's exact state machine and the existing `supervisionCandidates` ranking, for Scenario 6's school-closure coverage need. | NEW-PROPOSED |
| 3 | `events.propose` stays a separate, narrower grant scope from `schedule.read` — reading a calendar never implies the right to add to it. | NEW-PROPOSED |
| 4 | `school.write` is a new grant scope, distinct from the existing `school.report` capability — a capability still means "offers to," never "may." | NEW-PROPOSED |
| 5 | **No location of any kind — no coordinates, no place names, no "last confirmed at" — is ever shared with the Orbit audience.** Only the activating/parent view sees the last check-in. This is the one decision Bryan was asked to personally confirm or override; he confirmed it. | NEW-PROPOSED |
| 6 | `orbit_notify_eligible` is a per-child policy for v1, not per-child-per-household. | NEW-PROPOSED |
| 7 | New v2 seed/story data gets its **own**, separate checksum baseline. The existing 28-table/157-row baseline is never touched, extended, or re-shaped. | NEW-PROPOSED |
| 8 | `HolidayArrangement` stays a plain named date range per instance; no shared "same holiday, every year" calendar lookup table. | NEW-PROPOSED |

---

## 2. Migration numbering — the collision and the fix

**0021 and 0022 are already used on `feat/level-b-drafts`** (PR #9, draft):
`0021_one_open_attempt.sql`, `0022_real_consented_attempts.sql`. That branch is queued to merge
before this work starts. Checked against **every** open branch/worktree as of this revision
(`chore/alt-stack`, `docs/mock-person-ids`, `feat/meta-model-api`, `feat/muse-first-call`,
`feat/station-06`, `feat/web-graphql-adapter`, `feat/web-mission-control*`, `feat/web-parent-chat-
ui`, `feat/web-persona-picker`, `feat/web-village*`, `feat/web-ask-rosina`, `fix/shadcn-alias`,
`fix/transport-policy`, `setup/*`), **the highest migration number anywhere is `0022`.**

Every migration proposed below is therefore numbered starting at **`0023`**. **These numbers are
re-checked at implementation time** — by then, more open branches may have claimed numbers in
between, exactly as `feat/level-b-drafts` did to this contract's first draft. Treat every number
below as a placeholder for sequencing and dependency order, not a reservation.

---

## 3. Authority model — relationship, residence, caregiving, and approval are four separate facts

This section exists because Emma's grandparents (§Cast v2) must be able to do **every** guardian
action — consent, pickup approval, Orbit activation and closure — **with no parent account at
all**, and seeding them as guardians is not sufficient by itself: the authorization layer has to
actually recognize "guardian" wherever it currently recognizes "parent." This section is the
literal audit the task asked for: every resolver, SQL function, and RLS policy that checks a
parent-shaped role, and exactly what changes.

### 3.1 The four facts, today vs. proposed

| Fact | Where it lives today | Status |
| --- | --- | --- |
| **Relationship** — what this person *is* to the child (descriptive, free text) | `relationships.type` (`src/fixtures.ts`, e.g. `'grandmother'`, `'stepfather'`) | **EXISTING**, unchanged |
| **Residence** — which household(s) a person belongs to | `household_members` (`0001_schema.sql:25-30`) | **EXISTING**, widened below |
| **Caregiving responsibility** — who has day-to-day duty, and when | `parenting_schedules` + (Area B) `holiday_arrangements` | **EXISTING** + **NEW-PROPOSED** |
| **Approval authority** — who may consent, approve, activate/close Orbit | **today, conflated with residence**: `is_parent_of()`/`isParentOf()` check `household_members.role = 'parent'` directly | **this is the gap** |

The fix is not a fifth table for authority — it is **removing the conflation** by widening the one
existing residence-role check so a second role value (`'guardian'`) carries the same authority as
`'parent'`, while a third, new role value (`'resident_adult'`) exists for people like Taylor's
stepdad who live in the household but hold **no** default authority at all. Relationship stays
exactly as descriptive and separate as it is today — Emma's grandparents are still `relationships.
type = 'grandmother'`, and that string never grants anything; only their `household_members.role`
does.

### 3.2 Exact changes — every literal check, found by grepping the real files

**Direct edits (four, total — everything else below inherits them for free):**

| # | File:line | Today | Change |
| --- | --- | --- | --- |
| 1 | `supabase/migrations/0001_schema.sql:28` | `role text not null check (role in ('parent', 'child'))` | widen to `check (role in ('parent', 'guardian', 'resident_adult', 'child'))` — additive, existing rows already satisfy the narrower set |
| 2 | `supabase/migrations/0003_rls.sql:18`, inside `is_parent_of(child)` | `and caller_m.person_id = current_person() and caller_m.role = 'parent'` | `and caller_m.person_id = current_person() and caller_m.role in ('parent', 'guardian')` |
| 3 | `supabase/migrations/0010_derived_query_helpers.sql:59`, inside `parent_ids_of(child)` | `where m.role = 'parent'` | `where m.role in ('parent', 'guardian')` |
| 4 | `src/authz.ts:100` (`isParentOf`) and `src/authz.ts:114` (`parentIdsOfChild`) | `.eq('role', 'parent')` (both sites) | `.in('role', ['parent', 'guardian'])` (both sites) |

**Inherits the fix automatically — zero direct edits, confirmed by reading each site, listed so
nobody "fixes" them redundantly:**

- Every RLS policy in `0003_rls.sql` that calls `is_parent_of(...)` rather than checking a role
  literal itself: `relationships_read`, `relationships_parent_update`, `goals_read`, `goals_parent_
  write`, `care_plans_read`, `grants_read`, `grants_parent_write`, `approvals_read`, `household_
  policies_read`, `parenting_schedules_read`, `events_read`, `school_reports_read`, `permission_
  slips_read`, `bus_rosters_read`, `practices_read`, `coordination_jobs_read`, `attempts_read`,
  `info_requests_read`, `confirmations_read`, `conversation_state_read` — 20 policies, zero edits.
- `village_event_read` (`0007_village_event.sql:26`), `pickup_candidates_for` (`0008_pickup_
  candidates_for.sql:22`), `candidate_evaluations_read`/`locations_read`/`request_pickup`/`consume_
  real_call_authorization` (`0013_station06_coordination.sql:162,167,366,520`) — all call the
  function, zero edits.
- Every TypeScript call site that calls `isParentOf(ctx, childId)` as a function rather than
  checking a role string itself: `src/subgraphs/village.ts:205,213,227,302,334`,
  `src/subgraphs/access.ts:157,169,177,197,228,320,347`, `src/subgraphs/activities.ts:79`,
  `src/subgraphs/transport.ts:70` — 13 call sites, zero edits.
- Every NEW-PROPOSED permission rule in Areas A–F below (`confirmEvent`, holiday-arrangement
  approval, `CareFact` household-scoped write, `ConsentRequirement`'s frozen approver-list
  computation, Orbit's `activated_by`/`closed_by` check) is specified from the start to call
  `is_parent_of`/`isParentOf` — never a second hardcoded `'parent'` literal.

**What stays untouched, by design:** `src/fixtures.ts` and `0002_seed.sql` keep every existing
`role: 'parent'` literal exactly as-is for the Ellisons and Colemans — this is a widening, not a
rename, and no existing fixture, id, or evidence file changes.

### 3.3 `resident_adult` — residence without default authority

The third new role value exists for exactly one purpose: a household member who is honestly
recorded as living there, but who holds **no** authority by virtue of that residence alone —
Taylor's stepdad (§Cast v2) is the concrete case. He is `household_members.role = 'resident_adult'`
in `h_f1`; `is_parent_of`/`isParentOf` **do not** include `'resident_adult'` in their widened `IN`
list (only `'parent'` and `'guardian'`), so residence alone grants him nothing. Whatever he can
actually do (drive, see the calendar) comes from ordinary `grants` rows, exactly like any other
non-resident caregiver today — the same mechanism Loretta or Priya already use, just also, in his
case, honestly listed as living there.

### 3.4 Migration

`0023_authority_model.sql` — widen the `household_members.role` check constraint; widen `is_parent_
of()` and `parent_ids_of()`. Acceptance check: the full 32-case pickup evidence suite is byte-
identical before and after (no existing row's `role` value changes), and a new fixture-only probe
(Emma's guardian reading Emma's `carePlan`/writing a `goal`) is provable independently.

---

## 4. Areas A–G

### A. Events + calendar

**What exists.** `Event` (`schema/schedule.graphql:11-18`: `id`, `child`, `title`, `start`, `end`,
`location`) and `Query.events(childId, date)` (`schedule.graphql:4`) — **EXISTING**. Table `events`
(`0001_schema.sql:123-130`) and RLS `events_read` (`0003_rls.sql:132-133`: parent/guardian or
`schedule.read`) — **EXISTING**. **`village_event`** (`0007_village_event.sql:9-19`) is the
occurrence/history table — `occurred_at` vs. `recorded_at`, `actor_id`, `subject_id`, `kind`,
`source` (`LIVE`|`SYNTHETIC_SCENARIO`), `scenario_id`, `payload jsonb` — **EXISTING table, IN
SCHEMA for GraphQL** (no type exposes it yet), "created EMPTY on purpose" — exactly the seed plan's
provenance shape, already built.

**Additions — NEW-PROPOSED.** Extend `Event` with `category: EventCategory!` (`PRACTICE`, `GAME`,
`RECITAL`, `PARTY`, `FIELD_TRIP`, `SLEEPOVER`, `SCHOOL_CLOSURE`, `HOLIDAY`, `PARENTING_HANDOFF`,
`HOLIDAY_CAMP`), `status: EventStatus!` (`PROPOSED`/`CONFIRMED`/`CANCELLED`), `participants:
[Person!]!`, `proposedBy`/`confirmedBy: Person`, `confirmedAt: String`. New mutations
`proposeEvent(...)` (parent/guardian, or a new `events.propose` grant — Decided #3) and
`confirmEvent(eventId, decision)` (default authority: any parent/guardian, per `household_
policies.event_confirmation`, default `ANY_PARENT`, mirroring the existing `caregiver_approval`
value already seeded for `h_a`). New query `villageHistory(childId, from, to): [VillageEvent!]!`
exposing `village_event`.

**Permissions.** Read: unchanged (parent/guardian, or `schedule.read`). `proposeEvent`: parent/
guardian, or `events.propose` grant holder. `confirmEvent`: parent/guardian by default, or whoever
`household_policies.event_confirmation` names for that category.

**Migration.** `0024_events_status_participants.sql`.

### B. Parenting schedule + holidays

**What exists.** `ParentingSchedule` (`schema/access.graphql:55-59`), table `parenting_schedules`
(`0001_schema.sql:115-120`), RLS `parenting_schedules_read` (`0003_rls.sql:128-129`) — **EXISTING**.
`_is_approver_for` (`0013_station06_coordination.sql:216-224`) and `approverFor`
(`access.graphql:10`, resolved by `approverForChild` in `src/derive.ts`, called from
`src/subgraphs/access.ts:291-298`) — **IMPLEMENTED + EVIDENCED** (`docs/evidence/02-approver-
thursday.md`).

**Additions — NEW-PROPOSED.** `HolidayArrangement` (new type/table, justified in Revision 1: a
weekly rule has no start/end/status/second-approver, and folding a bounded, conditional override
into it would make "whose day is it" ambiguous — the opposite of the precedence rule's purpose):
`id`, `child`, `holidayName`, `dateStart`, `dateEnd`, `assignedParent: Person!` (**parent or
guardian**, per §3), `pickupDutyParent`, `dropoffDutyParent`, `status` (`PROPOSED`/`APPROVED`/
`DECLINED`), `proposedBy`, `approvalId`. `effectiveScheduleFor(childId, date): EffectiveSchedule!`
— checks an `APPROVED` arrangement first, falls back to the weekly schedule, and `approverFor`/
`_is_approver_for` are updated to call it, so **pickup's behavior is unchanged everywhere no
arrangement exists** (every date in the current seed). `scheduleConflicts(childId, from, to):
[ScheduleConflict!]!` — surfaces overlaps/gaps, never resolves them silently. A one-off swap
(Scenario 3) reuses the same shape with `holidayName: null`.

**Permissions.** Read: parent/guardian, or `schedule.read` — unchanged. Propose: either parent/
guardian, or a grant holder suggesting on one's behalf (stays `PROPOSED` either way). Approve/
decline: **the other parent/guardian specifically** — `household_policies.schedule_swap_approval`,
default `BOTH_PARENTS` (deliberately different from `event_confirmation`'s `ANY_PARENT` — moving
custody time is the one case the task names as "co-parent never overrides a grant or restriction by
itself").

**Migration.** `0026_holiday_arrangements.sql`.

### C. Consent — staged: a Sunday-minimal path, then full generality

**What exists.** `Approval` (`schema/access.graphql:40-47`; table `approvals`,
`0001_schema.sql:99-106`) — already a polymorphic, append-only decision ledger, **IMPLEMENTED +
EVIDENCED** (`docs/evidence/11c-kendra-approves.md`, `11c3-approvals-exist.md`). `PermissionSlip`
(`schema/school.graphql:20-25`; table `permission_slips`, `0001_schema.sql:140-145`) — **EXISTING**,
**IN SCHEMA** (no mutation, no fixture row yet).

**Why extend `Approval`, not invent `ConsentRequest`** (Revision 1's argument, unchanged):
`PermissionSlip.signed` is one boolean on one row — it cannot hold multiple required approvers, a
deadline, or a history, and it is owned by `school` (port 4005), which is the wrong owner for a
non-school consent subject (a parenting swap, an Orbit activation). `Approval` already has the
polymorphism and the audit trail; the actual gap is narrower than "no consent model" — it's "no
table records an **open** request, still pending."

**Stage 1 — Sunday-minimal, PermissionSlip-based.** Extend `PermissionSlip` directly (not a new
table) with `approver: Person`, `deadline: String`, `decision: ConsentDecision` (`PENDING`/
`APPROVED`/`DECLINED`), `decidedAt: String`. `approver` is resolved once, at creation, from
`household_policies.caregiver_approval` (reusing the existing `ANY_PARENT` value exactly as seeded
for `h_a`) — a **single** named approver, no frozen list, no multi-approver generality. This is
enough to run Scenario 4 honestly (open and resolved cases both) without building `ConsentRequirement`.

**Stage 2 — ranked candidate, before Nov 4 — full generality.** `ConsentRequirement`: `id`,
`subjectType` (`'Event'`|`'HolidayArrangement'`|`'PermissionSlip'`|`'OrbitAlert'`), `subjectId`,
`householdId`, `requiredApproverIds: [ID!]!` (**frozen at creation** from `household_policies` +
`grants` — and, per §3, this list is computed via the now-widened `parent_ids_of`/`parentIdsOfChild`,
so guardians are included automatically, not as a second special case), `deadline`, `status`
(`PENDING`/`SATISFIED`/`EXPIRED`/`DECLINED`), `createdBy`, `createdAt`, `linkedEventId`. Deciding
against one writes an `Approval` row (`subjectType: 'ConsentRequirement'`), adding `DECLINED` to
the existing decision check constraint (additive). `PermissionSlip.signed` keeps meaning exactly
"a literal document was signed" — never conflated with the in-app decision, per the task's own
rule.

**Permissions.** Stage 1: read — parent/guardian or `school.read`; decide — the one named approver
only. Stage 2: read — parent/guardian, or a frozen `requiredApproverIds` member; decide — only a
frozen-list member, **never** "whoever is today's scheduled parent."

**Migrations.** `0028_consent_minimal.sql` (Stage 1, Sunday). `0032_consent_requirement_full.sql`
(Stage 2, ranked candidate).

### D. Care information

**What exists.** `CarePlan` (`schema/village.graphql:121-124`; table `care_plans`,
`0001_schema.sql:83-86`), RLS `care_plans_read` (`0003_rls.sql:96-97`) — **EXISTING**,
**IMPLEMENTED + EVIDENCED** (`docs/evidence/04-loretta-goals-careplan-contact.md`, `06a`/`06b`/
`06c`). Today, one free-text sentence per child, no severity, no verification — exactly as the
task describes.

**Additions — NEW-PROPOSED.** `CareFact` (new, structured sibling to `CarePlan`, same `village`
ownership; `CarePlan.text` stays as the freeform fallback): `id`, `child`, `household` (nullable —
null means every household, set means that house's own rule — "rules may differ by household"),
`category` (`ALLERGY`/`FOOD_RESTRICTION`/`BEDTIME`/`SCREEN_TIME`/`APPROVED_SHOW`/`APPROVED_
ACTIVITY`/`OTHER`), `text`, `sourceLabel`, `verificationStatus` (`UNVERIFIED`/`PARENT_VERIFIED`/
`PROFESSIONAL_VERIFIED`), `verifiedBy`, `verifiedAt`. **Never** infers verification or severity
from `text` — named explicitly in the task, honored explicitly here.

**Permissions.** Read any `CareFact` regardless of household scoping: unchanged from `CarePlan` —
parent/guardian, or `careplan.read` (everyone who sees the plan sees every household's rules, so a
sitter is never told half the picture). Write/verify a household-scoped fact: a parent/guardian
**in that household** (new helper `is_parent_of_household`, narrower than `is_parent_of`). Write a
household-null (shared) fact: any parent/guardian of the child.

**Migration.** `0025_care_facts.sql`.

### E. School information

**What exists.** `SchoolReport` (`schema/school.graphql:12-18`; table `school_reports`,
`0001_schema.sql:132-138`) — **EXISTING**, **IN SCHEMA** (no `Mutation` type exists at all yet).
`capabilities.school.report`, held by Angela and Carol (`src/fixtures.ts:243-244`) — already
"offers to," never "may" (`village.graphql:93-96`).

**Additions — NEW-PROPOSED.** `fileSchoolReport(childId, kind, text, createsEventInput,
createsTaskInput)` — gated by the **new** `school.write` grant (Decided #4), distinct from the
existing `school.report` capability. Extend `SchoolReport` with `createdBy`, `status`
(`OPEN`/`ACKED`/`RESOLVED`), `linkedEventId`, `linkedTaskId`. New, deliberately minimal `Task`:
`id`, `child`, `title`, `createdFromReportId`, `owner`, `dueDate`, `status`. Optionally creates a
`PROPOSED` `Event` via the one narrow helper Decided #1 approved.

**Permissions.** Read: unchanged (parent/guardian, or `school.read`). `fileSchoolReport`: `school.
write` grant holder (capability alone is not enough). Resolve a `Task`: parent/guardian, or the
task's owner acting on a parent's/guardian's behalf.

**Migration.** `0027_school_reports_and_tasks.sql` — schema and tables ship with the Sunday
seed-generation work (STORIES needs the rows); the live `fileSchoolReport` mutation being a
**polished, demoable authoring flow** is listed under "awaiting Bryan's choice" (§11), not
scheduled either way by this contract.

### F. Coordination types — the shared job engine

**What exists.** `CoordinationType` (`schema/coordination.graphql:24-28`): `PICKUP` —
**IMPLEMENTED + EVIDENCED**; `INVITATION`/`ONBOARDING` — **IN SCHEMA, not built, zero resolvers**.
`CoordinationJob`/`Attempt`/`InformationRequest`/`Confirmation`/`candidate_evaluations`/`locations`/
`real_call_authorizations`/`webhook_events`, and every `SECURITY DEFINER` transition function —
**IMPLEMENTED + EVIDENCED**, all owned by `coordination` (port 4003). **Non-negotiable posture,
carried into every addition below:** `authenticated` gets `SELECT` only on every coordination
table; every write is a `SECURITY DEFINER` function (`0013_station06_coordination.sql`'s own
stated security model).

**Additions — NEW-PROPOSED, all three Decided (2026-10-30).** Widen `CoordinationType` and the
`coordination_jobs.type` check constraint with `CONSENT`, `ORBIT_ALERT`, and `SUPERVISION` — one
cheap, additive migration, since it's a pure enum/constraint widening with zero behavioral change
until the tables behind each exist.

- **CONSENT** wraps one `ConsentRequirement` per job (`ConsentRequirement.jobId` FK) once Stage 2
  exists — reuses the version/status/audit scaffolding instead of a second state machine.
- **SUPERVISION** (Decided #2) reuses pickup's exact `pending → discovering → awaiting_approval →
  confirmed/failed` machine and the existing `supervisionCandidates` ranking, via a new
  `request_supervision` function paralleling `request_pickup` but checking `supervise.request`
  instead of `pickup.request`.
- **ORBIT_ALERT** — deliberately **not** `pickupCandidates`'s ranking:

  | | Pickup's ranking | Orbit's audience |
  | --- | --- | --- |
  | Eligibility | derived fresh from relationship + grant, every call | a **frozen allowlist**, `household_policies.orbit_notify_eligible`, per-child (Decided #6) |
  | Ordering | deterministic, picks **exactly one** | flat `notify_order`, **everyone at once, no waiting period** |
  | Outcome | one recommendation, one approval | **many** independent responses, no winner |
  | Co-parent | irrelevant to authorization | included **only** where policy explicitly says so |

  `orbit_alerts(id, job_id, child_id, activated_by, activated_at, status, closed_by, closed_at,
  minimal_message)` — `activated_by`/`closed_by` **must** resolve true against `is_parent_of`/
  `isParentOf` (parent **or guardian**, §3) — never inferred from a response. `orbit_audience_
  members(orbit_alert_id, person_id, notify_order, notified_at, eligible, eligibility_source)` —
  frozen at activation. `orbit_responses(orbit_alert_id, person_id, responded_at, response, note)`
  (`WITH_ME`/`ON_WAY`/`CANNOT_HELP`). **No location field exists anywhere in the minimal slice
  (§8)** — Decided #5 is satisfied trivially in the minimal build because there is nothing to leak
  yet; the parent-only last-check-in view is explicitly **not** part of the minimal slice and is
  listed as unproven in §8. Closure only via `closeOrbitAlert`, by a parent/guardian — no response,
  including `WITH_ME`, closes it. The 911 banner is a `web/` rendering rule, owned by
  `frontend.md`, not a schema concern.

**Permissions.** `CONSENT` jobs: parent/guardian, or a frozen approver — definer functions only.
`ORBIT_ALERT` tables: parent/guardian full access; an audience member reads only their own `orbit_
audience_members`/`orbit_responses` row (same shape as `candidate_evaluations_read`'s `candidate_
id = current_person()`); **zero** INSERT/UPDATE/DELETE grant to `authenticated`, matching `0013`'s
stated posture exactly.

**Migrations.** `0030_coordination_types_extended.sql`; `0031_orbit_alert_minimal.sql`;
`0033_supervision_coordination.sql`.

### G. Ask Rosina's action catalog

**Updated this revision:** `docs/contracts/ask-rosina.md` now exists, on `feat/web-ask-rosina`
(PR #20, open — Codex Task W3). It is a frontend/service contract Bentley and Codex own; this
section does not restate it, only states how the two contracts meet. `ask-rosina.md`'s own
catalog (`web/src/features/rosina/catalog.ts`) already ships five entries, each independently
marked implemented or mock-only in that document: `open-screen`, `open-person`, and
`explain-screen` (implemented); `start-pickup` and `explain-recommendation` (mock only — live
execution unavailable). That document **explicitly reserves** this contract's future action
entries rather than guessing at them ("Reserved for coordination-v2 — owned by Claude/Bryan, NOT
defined here") and **explicitly defers** the Family Calendar until this contract's event model
lands — both already correct, nothing to change on this side.

This contract's own rule is unchanged from Revision 1 and now has a live catalog to apply it to:
**an entry is a usable UI action only once its own backing query/mutation is built — never once a
doc describes it, and never once a different workstream's catalog has a slot reserved for it.**

| Action (from the original brief) | Primitive | Status |
| --- | --- | --- |
| Read schedule | `events`, `practices`, `parentingSchedule` | primitives exist; this contract's own action wrapper **NEW-PROPOSED** — distinct from `ask-rosina.md`'s own `open-screen`/`explain-screen`, which already cover *reading* a screen, not yet this contract's schedule semantics |
| Explain a rule | `householdPolicy` | primitive exists; action wrapper **NEW-PROPOSED** |
| Propose an event | Area A | blocked on A — **not implemented** in the live catalog until A ships |
| Request consent | Area C | blocked on C (Stage 1 unblocks a minimal version) — **not implemented** until then |
| Propose a parenting swap | Area B | blocked on B — **not implemented** until then |
| Suggest Orbit | Area F, **suggest only** — Rosina may never call `activateOrbitAlert` itself | blocked on F — **not implemented** until then, and permanently restricted to "suggest" even once built |

Every row above stays "not implemented" in `web/src/features/rosina/catalog.ts` until its backing
Area ships — the catalog's own `implemented: false` convention (already established by `start-
pickup`/`explain-recommendation`) is the correct mechanism; nothing new is needed to express it.

---

## 5. Cast v2 — six family networks

The Ellisons (Nora) and Colemans (Jax) are **unchanged** — every existing fixture, id, grant, and
evidence file stays valid; nothing below renames or re-scopes anything in `src/fixtures.ts` for
either family. Four new, fictional family networks are added, written to be recognizable,
ordinary households — none played as a joke or a problem to be fixed.

### 5.1 The six networks

| Network | Child(ren) | Structure |
| --- | --- | --- |
| **Ellison** (unchanged) | Nora (`p_nora`) | two-household split custody, extended village |
| **Coleman** (unchanged) | Jax (`p_jax`) | two-household split custody |
| **Castellano** (new) | Emma (`p_emma`) | grandparents are the **legal guardians**; no parents participate at all |
| **Vance–Reyes** (new) | Taylor (`p_taylor`), half-sibling Skye (`p_skye`) | blended: bio-mom + stepdad (household 1), bio-dad (household 2), half-sibling living with her own mother in a **third** household, on her own schedule |
| **Lee** (new) | Micah (`p_micah`), Avery (`p_avery`) | two mothers, one household, two children, different schools, competing activities |
| **Ferris** (new) | Malik (`p_malik`) | single father, night shifts; an aunt, a neighbor, and a sitter each provide a different kind of support |

Ten children total across the ecosystem (Nora, Jax, Leo, Max, Emma, Taylor, Skye, Micah, Avery,
Malik) — inside the task's "about 10–12" target.

### 5.2 Castellano — Emma, no parents at all

- `p_emma` (child, household `h_e`, village `v_emma`).
- `p_rosa`, `p_tomas` — grandparents, `relationships.type: 'grandmother'/'grandfather'` (the
  **descriptive** fact, unchanged by anything below), `household_members.role: 'guardian'` in
  `h_e` (the **authority** fact, per §3) — this pairing is the concrete proof that the two facts
  are independent: the relationship string never changed, and it was never what granted them
  anything.
- Angela Price teaches Emma too (Room 12) — granted `school.read` **only** (no `careplan.read`):
  the guardians chose narrower sharing than Jax's or Nora's households did, demonstrating that a
  shared teacher never implies a shared scope.
- `household_policies` for `h_e`: `caregiver_approval: ANY_GUARDIAN` (the household-policy value
  itself is free text, same as `ANY_PARENT` — no schema change needed, just a new value, read by
  the same policy-lookup code).

### 5.3 Vance–Reyes — blended, delegated authority, a half-sibling in a third household

- `p_taylor` (child, households `h_f1` and `h_f2`).
- `p_felicia` (bio-mom, `role: 'parent'`, `h_f1`), `p_marcusv` (stepdad, **`role: 'resident_
  adult'`**, `h_f1` — lives there, holds no default authority, §3.3).
- `p_darnell` (bio-dad, `role: 'parent'`, `h_f2`).
- `p_skye` — Taylor's half-sibling (shares bio-dad Darnell), lives primarily with her own mother
  `p_imani` in a **third** household `h_f3`, sees Darnell on her own schedule in `h_f2` — different
  days from Taylor's own time there, modeling "siblings with different schedules" without implying
  Taylor and Skye are co-parented identically. Kept structurally minimal (household membership +
  relationships only) — she does not need her own `CarePlan`/consent story for this contract's
  scenarios, a deliberate scope decision, not an oversight.
- **Delegated authority, the concrete case:** Marcus Vance holds `transport.child` (capability)
  and a `pickup.request`/`schedule.read` grant for Taylor, granted by Felicia — he can drive Taylor
  and see her calendar. He holds **no** consent authority: `household_policies` for `h_f1` carries
  `delegated_consent_authority` with an empty value by default. If Felicia later wants to delegate
  it, she adds his id explicitly — never automatic from residence, transport capability, or being
  a stepparent.

### 5.4 Lee — two mothers, either approves alone

- `p_simone`, `p_denise` — both `role: 'parent'` in `h_g` (no new role value needed: two legally
  equal co-parents in one household is exactly today's Ellison/Coleman shape, just not split
  across two households).
- `p_micah` (Room 12, Tigers), `p_avery` (swim team) — different schools, competing activity
  times.
- `household_policies` for `h_g`: `caregiver_approval: ANY_PARENT` — the **existing** value,
  reused verbatim. **"Either mother may approve alone" is simply what `ANY_PARENT` already means**
  — nothing new had to be invented to avoid "both have authority" collapsing into "both signatures
  required."

### 5.5 Ferris — single father, night shifts, three kinds of support

- `p_dwayne` (father, `role: 'parent'`, `h_h`), `p_malik` (child).
- `p_cassandra` — Dwayne's sister, `relationship.type: 'aunt'`, grants `supervise.request`,
  `pickup.request`, `schedule.read`, capability `transport.child`. Full support.
- `p_oscar` — neighbor, `relationship.type: 'neighbor'`, grants `supervise.request`, `schedule.
  read` **only** — no transport capability, no pickup/consent grant. The clean "may supervise, can
  neither drive nor consent" case, both a family-support example and a cross-family-connection
  example (§5.6).
- `p_priya` — the **existing** sitter, given a **second, independent** grant `g_priya_malik`
  (`supervise.request`, `schedule.read` — no `careplan.read` this time, Dwayne's own choice) —
  Priya now sits for two households under two separate grants, neither implying anything about the
  other.

### 5.6 Cross-family connections — exactly what each side can and cannot see

| Connection | Mechanism | Each side's visibility |
| --- | --- | --- |
| Tigers soccer (`g_tigers`): Nora, Jax, Micah, Zion added as players; Marcus Reyes coaches all | `memberships` (today's RLS: any signed-in user may read membership rows — `0003_rls.sql:63-64`, already-existing directory-style openness) | Any parent/guardian on the team can see the **roster and who coaches** — never each other's care plan, schedule, or contact info, which stay grant-gated exactly as today |
| Ms. Price teaches Nora, Jax, Emma, Micah (Room 12) | separate `school.read`/`careplan.read` grants per child, per household | A shared teacher **never** creates a shared scope — Emma's household granted `school.read` only; Jax's and Nora's households granted more; each household decides independently |
| Loretta (Nora's grandmother) occasionally helps the Lee household too | a new, independent grant `g_loretta_avery` (`pickup.request`), granted by Simone/Denise | Loretta can be a pickup candidate for Avery; she cannot see Avery's care plan or schedule beyond what `pickup.request` itself exposes — her Nora-side grants give her nothing extra here |
| Priya sits for Nora and for Malik | two independent grants, `g_priya` and `g_priya_malik` | Each household sees only its own grant to Priya; neither can see the other's arrangement with her |
| Nora invited to Micah's birthday (Area A `Event`, category `PARTY`) | `proposeEvent` by Denise, `participants` includes Nora | Denise's proposal never grants her anything over Nora's record — Kendra must independently `confirmEvent` on Nora's side; an invitation is not a confirmed event, the Area A rule, demonstrated across a household boundary |
| Bus Route 14 (`g_route14`) carries Nora, Jax, and Micah | separate `transport.read` grants per child for Gary Holt (`g_gary_micah`, alongside the existing `g_gary`) | Gary sees each child's roster row only where separately granted — the shared bus never bundles permission across children |
| Oscar (Ferris household neighbor) may supervise Malik but cannot drive or consent | `supervise.request`/`schedule.read` only, no `transport.child`, no consent-bearing role | Oscar's grant is visibly narrower than Cassandra's or Priya's — the same grant mechanism, just fewer scopes, with nothing implicit about "being trusted enough to supervise" extending further |

---

## 6. Adult schedules

A calendar gap is **not** confirmed availability — this generalizes a rule the pickup contract
already proved (`pickup-job.md` §5a: "availability stays `UNKNOWN` for every candidate until a
human responds") to every adult-schedule use below, rather than inventing a second rule. Free time
grants no authority: pickup, supervision, and consent stay separate permissions no matter what a
calendar shows. Visibility defaults to **busy/free only** — an employer name, an appointment
reason, or another family's child is never exposed to anyone beyond the person themself (or, for a
booked sitting session, the booking household).

**NEW-PROPOSED.** `BusySlot` (owned by `village`, person-level data): `id`, `person`, `kind`
(`WORK_SHIFT`/`SITTING_SESSION`/`CLASS`/`APPOINTMENT`/`OTHER`), `start`, `end`, `visibility`
(`BUSY_ONLY`/`DETAIL_TO_OWNER`/`DETAIL_TO_BOOKING_HOUSEHOLD`), `detail` (gated by `visibility`),
`linkedChild`, `linkedHousehold` (for a sitting session: which child/household this responsibility
is for). Two reads: `busyStatus(personId, from, to): [BusyWindow!]!` — strips `detail`/
`linkedChild` server-side (per-resolver, the established pattern) unless the caller is the owner or
the booking household; `myScheduleDetail(from, to): [BusySlot!]!` — full detail, self (or booking-
household) only.

**Scenarios 9–11 — tying the rules to concrete stories:**

**9. A parent's shift overlaps gymnastics.** Dwayne Ferris has a `WORK_SHIFT` `BusySlot` (night
shift, Thu 2026-10-22 overlapping Malik's gym class). Rosina, asked who can take Malik, sees
Dwayne is busy and uses that **only to order who to ask first** (Cassandra, then Oscar, then
Priya) — it never substitutes for actually asking, and never marks anyone `CONFIRMED` from the gap
alone.

**10. Priya is already booked with another family.** Kendra asks Rosina whether Priya can pick up
Nora Wed 2026-10-21. Priya has a `SITTING_SESSION` `BusySlot` for Malik that evening. Rosina
reports the conflict honestly rather than dispatching an outreach that would double-book her — and
still asks Priya rather than assuming unavailability outright, the same honesty rule in its mirror
form.

**11. A teacher conference forces a parenting-time adjustment.** Angela Price has a `CLASS`/
`CONFERENCE` `BusySlot` on a day that also needs a parent conversation about Nora's reading goal;
the early pickup this requires creates a one-off Area B exception (a handoff-time shift), tying
Area E (school), Area B (schedule), and this section together in one connected story.

**Migrations.** Split across two tiers (§11), numbered in application order: `0029_adult_
schedules_minimum.sql` — **Sunday ships the minimum**: seeded `BusySlot` rows for the people
Scenarios 9–11 actually name, plus the `busyStatus` (busy/free-only) read those scenarios need.
`0034_adult_schedules_editing.sql` — **Before Nov 4** ships the rest: `myScheduleDetail`, the
`visibility`/`DETAIL_TO_*` gating logic in full, and any UI for creating or editing a `BusySlot`
rather than reading a seeded one.

---

## 7. Visual intent

Selecting a child shows that child's authorized village — no new mechanism: the existing per-
resolver scoping on `village`/`householdMembers`/`relationships`/`grants` already produces this
correctly for all six networks, because each is gated by the same grant/authority checks
regardless of which family is selected. Selecting a shared coach, teacher, or activity (§5.6)
reveals only the connections the viewer may see — the same resolvers, called from a different
starting node, not a new permission model. Each child has a deliberately distinct mix of open
items by seed design, not by new schema: Emma has no open consent request but may have a pending
`Task`; Taylor's story is the cross-household birthday invite; Micah and Avery's is competing
activity timing; Malik's is the night-shift coverage chain — so switching families in the UI
changes the experience substantively without any surface needing child-specific code.

---

## 8. Seed plan — precise budget

Built on the v2 event/job model, generated only after it exists. Three counted layers, kept
strictly separate, per this revision's instruction.

| Layer | Window | What it is | Expected row count |
| --- | --- | --- | --- |
| **Recurring routine definitions** | n/a — templates, not occurrences | ~4 per family × 6 families (school-day pattern, one activity, bedtime, parenting handoff/weekly-split) | **~24 definitions** |
| **BACKBONE** (generated occurrences) | Sep 1 – Oct 29 (~59 days) | mechanical expansion of the definitions above across all 6 families' ~10 children — school days, activities, bedtime, handoffs; deliberately light filler, not meant to be read individually | **~600–900 generated rows** (estimate — exact count depends on each family's actual weekly pattern once written, not a promise) |
| **STORIES** (the connected, meaningful layer) | Oct 19 – 25 | **60–80 historical events total, grouped into connected stories** — once, across the whole ecosystem, not per family. Nora's stories stay central (completed pickup, unavailable caregiver, `NO_TRANSPORT` reply + approval, early-dismissal → coordination → outreach → confirmation chain, past consent decision, verified allergy, cancelled practice, moved recital, approved swap); the other five families contribute **selected** stories inside the same total, not an additional budget — e.g. Emma's teacher-shares-narrower-scope moment, Taylor's cross-household birthday invite, Micah/Avery's competing-activity conflict, Malik's night-shift coverage chain, Scenario 7's homework follow-up | **60–80 events total** |
| **UPCOMING** | Oct 30 – Nov 30 | open field-trip consent, partially-confirmed school closure, Thanksgiving arrangement, one still-unapproved swap request, one genuinely unconfirmed coverage need, plus ordinary upcoming calendar entries per family | **~15–20 records** |

Dana (`p_dana`) is absent from **all** history before 2026-10-24, exactly as already implemented
(`src/fixtures.ts:200`, `DISCOVERED` status, evidenced in `docs/evidence/11a`/`11d`/`11f2`) — no
new v2 history record, in any family, may predate that cutoff with her as actor, subject, or
participant. (This rule only concerns Dana; it says nothing about any other cast member.)

Provenance reuses `village_event`'s existing columns exactly — `occurred_at` vs. `recorded_at`,
`actor_id`, `subject_id`, `scenario_id`, `source` (`LIVE`/`SYNTHETIC_SCENARIO`) — no new mechanism.
New v2 seed data gets its **own** checksum baseline (Decided #7); the existing 28-table/157-row
baseline is untouched.

---

## 9. Deliverables

### 9.1 Family / relationship matrix (new families; Ellison/Coleman unchanged, see `src/fixtures.ts`)

| Family | Person | Relationship to child | Residence role |
| --- | --- | --- | --- |
| Castellano | Rosa Castellano | grandmother | guardian |
| Castellano | Tomás Castellano | grandfather | guardian |
| Vance–Reyes | Felicia Reyes | bio-mother | parent (`h_f1`) |
| Vance–Reyes | Marcus Vance | stepfather | resident_adult (`h_f1`) |
| Vance–Reyes | Darnell Reyes | bio-father | parent (`h_f2`) |
| Vance–Reyes | Imani Brandt | Skye's mother (not Taylor's relation) | parent (`h_f3`, for Skye only) |
| Lee | Simone Lee | mother | parent (`h_g`) |
| Lee | Denise Lee | mother | parent (`h_g`) |
| Ferris | Dwayne Ferris | father | parent (`h_h`) |
| Ferris | Cassandra Ferris | aunt | — (not a household member) |
| Ferris | Oscar Lindqvist | neighbor | — (not a household member) |

### 9.2 Authority matrix (per child — who may approve/consent, approve pickup, drive, supervise, close Orbit)

| Child | Consent/approval authority | Pickup approval | May drive | May supervise | May close Orbit |
| --- | --- | --- | --- | --- | --- |
| Nora | Kendra, Andre | Kendra, Andre (per `approverFor`) | Loretta, Bryan, Tasha, Monique, Chris, Walter (grant-dependent) | Priya, Leo | Kendra, Andre |
| Jax | Dana, Ray | Dana, Ray | Evelyn | — (no supervise grant seeded) | Dana, Ray |
| Emma | Rosa, Tomás (guardians, §3) | Rosa, Tomás | both guardians | — | Rosa, Tomás |
| Taylor | Felicia, Darnell | Felicia, Darnell | Felicia, Darnell, **and Marcus (delegated transport only, not consent)** | — | Felicia, Darnell |
| Skye | Darnell, Imani | Darnell, Imani | Darnell, Imani | — | Darnell, Imani |
| Micah / Avery | Simone **or** Denise (either alone — Decided via `ANY_PARENT`) | Simone or Denise | Simone, Denise | — | Simone or Denise |
| Malik | Dwayne | Dwayne | Dwayne, Cassandra | Cassandra, Oscar, Priya | Dwayne |

### 9.3 Schedules per person — one worked example per adult category

| Category | Example | Shape |
| --- | --- | --- |
| Parent/guardian | Dwayne Ferris | `WORK_SHIFT` `BusySlot`s, night cadence, visible as busy/free only outside his own view |
| Sitter | Priya Nair | booked `SITTING_SESSION` slots, each tagged with a specific child + household + start/end, visible in full detail to the booking household only |
| Teacher | Angela Price | `CLASS`/`CONFERENCE` slots, class hours plus one conference block (Scenario 11), visible as busy/free to parents, in full to the school |
| Other caregiver | Cassandra Ferris | her own job's hours as `OTHER`/`WORK_SHIFT`, used only to order outreach, never to confirm availability |

The full per-person table ships with the seed generator's code, not enumerated row-by-row here —
this table exists to fix the **shape**, not to be the data source.

### 9.4 Cross-family connection list

See §5.6 — the table there **is** this deliverable; not duplicated here.

### 9.5 Expected visibility per persona

**Rule for reading this table, stated once so no row implies more than it means:** "everything"
appears only where the person holds unbounded **parent/guardian authority** for that child (§3 —
not a grant, so there is no narrower scope to list). Every grant-holder's row instead names the
**specific** grant and what it does and does not reach — "everything" is never shorthand for a
grant-holder's access, including a grant-holder who happens to be a relative.

| Persona | Can see | Cannot see |
| --- | --- | --- |
| Kendra (`p_mom`) | everything for Nora (full parent authority, not grant-bounded); Tigers roster/coach for any team Nora's on | Jax's/Emma's/Taylor's/Micah's/Malik's care plans, schedules, or consent records — no grant exists |
| Andre (`p_dad`) | everything for Nora (full parent authority) | same as Kendra |
| Loretta (`p_gma`) | **only** what her own grants name for Nora (`pickup.request`, `schedule.read`, `goals.read` — `src/fixtures.ts:305`); after §5.6, a separate, equally bounded `pickup.request` grant for Avery | Nora's care plan (no `careplan.read` grant); Avery's care plan or schedule beyond `pickup.request`; anything about Jax, Emma, Taylor, Malik |
| Priya (`p_priya`) | for Nora: `supervise.request`, `schedule.read`, `careplan.read` (`g_priya`); for Malik: `supervise.request`, `schedule.read` **only** — a separate, narrower grant (`g_priya_malik`, §5.5) | Malik's care plan (not granted in `g_priya_malik`); anything about Nora's household from the Malik side or vice versa |
| **Dana (`p_dana`)** | everything for **Jax** (full parent authority, unrelated to the point below); for **Nora**: nothing before her relationship is even `DISCOVERED` (2026-10-24, `src/fixtures.ts:200`); from Kendra's approval onward (`docs/evidence/11c`, `11c2`), **only** what that one bounded grant allows — `pickup.request` alone (`docs/evidence/11d`: she appears as a pickup candidate, nothing more) | Nora's schedule, care plan, goals, or anything else outside `pickup.request` — the grant was never widened, so neither is her visibility; no pre-2026-10-24 record in Nora's village names her (none exist) |
| Rosa Castellano (new, Castellano) | everything for Emma (full **guardian** authority, §3 — structurally identical to parent authority, not a grant, so there is no narrower scope to list) | any other family's data; nothing of Emma's was ever withheld from her specifically, since her authority isn't grant-shaped in the first place |
| Felicia Reyes (new, Vance–Reyes) | everything for Taylor (full parent authority); Skye's existence via the shared-sibling relationship only, not Skye's data | Skye's care plan/consent (Darnell's/Imani's side); Marcus's own schedule beyond what his own `BusySlot` visibility discloses |
| Simone Lee (new, Lee) | everything for Micah **and** Avery — each a full parent authority, co-equal with Denise, not a grant | anything about the other five families |
| Dwayne Ferris (new, Ferris) | everything for Malik (full parent authority) | Cassandra's or Oscar's own personal schedules beyond busy/free (§6); anything about the other five families |

### 9.6 Persona picker

One new persona per new household — **NEW-PROPOSED** additions to
`web/src/features/personas/personaData.ts` (the file `feat/web-persona-picker`, PR #19, already
establishes): Rosa Castellano, Felicia Reyes, Simone Lee, Dwayne Ferris. Not implemented by this
docs-only task; listed here so whoever picks up persona-picker work next has the exact four names
and which household each represents.

All new-family data (§5–§9) lands in the **separate v2 checksum baseline** (Decided #7) — the
existing 28-table baseline is untouched.

---

## 10. Migration list, renumbered

| # | File | Area | Tier |
| --- | --- | --- | --- |
| 1 | `0023_authority_model.sql` | §3 | Sunday (prerequisite for Cast v2) |
| 2 | `0024_events_status_participants.sql` | A | Sunday |
| 3 | `0025_care_facts.sql` | D | Sunday |
| 4 | `0026_holiday_arrangements.sql` | B | Sunday |
| 5 | `0027_school_reports_and_tasks.sql` | E | Sunday (schema/seed only — live mutation awaiting Bryan's choice) |
| 6 | `0028_consent_minimal.sql` | C, Stage 1 | Sunday |
| 7 | `0029_adult_schedules_minimum.sql` | §6, minimum slice | Sunday |
| 8 | `0030_coordination_types_extended.sql` | F (enum/constraint only) | Before Nov 4, rank 1 (cheap, could move earlier) |
| 9 | `0031_orbit_alert_minimal.sql` | F, Orbit | Before Nov 4, rank 1 |
| 10 | `0032_consent_requirement_full.sql` | C, Stage 2 | Before Nov 4, rank 2 |
| 11 | `0033_supervision_coordination.sql` | F, Supervision | Before Nov 4, rank 3 |
| 12 | `0034_adult_schedules_editing.sql` | §6, full editing UI | Before Nov 4, rank 4 |

No migration in this contract is unscheduled — the one genuinely open item left (§11's "awaiting
Bryan's choice") is a documentation/authoring-flow question, not schema. Numbers re-checked at
implementation time (§2).

---

## 11. Schedule — four tiers

### SUNDAY TARGET (committed)

Authority model (§3, prerequisite — Cast v2 cannot work without it, since Emma's household would
otherwise be locked out of everything) + Events (A) + **Adult schedules, minimum slice** (§6:
seeded `BusySlot` rows for the people Scenarios 9–11 actually name, plus the `busyStatus`
busy/free-only read those scenarios need — the full editing UI is a Before-Nov-4 item, ranked
below) + Care information (D) + the seed generator **with Cast v2** (all six family networks, §5,
§8) + Holiday precedence (B) + single-approver, `PermissionSlip`-based Consent (C, Stage 1).
School's tables (E) ship alongside these for the seed generator's sake; its live authoring
mutation is a separate, not-yet-promised piece of work (see "awaiting Bryan's choice" below).

**Risk note.** If Sunday's time runs short, **trim BACKBONE generated-occurrence rows first** —
fewer weeks of mechanical routine filler, which the task itself calls "light... not meant to be
read individually" (§8). **Never**, as a way to save time, drop a family, drop a STORIES event, or
drop the adult-schedules minimum slice — those are the connected, meaningful, and scenario-blocking
pieces; BACKBONE is the one layer built to be cut first without anyone noticing.

### P0 — PARALLEL WORK (other workstreams, already underway — not deferred)

A capability being actively built in another workstream is never "deferred"; it is simply not this
contract's own critical path. Two such workstreams run alongside the Sunday/Before-Nov-4 work
above:

- **The persona picker** — Codex Task W2, PR #19 (`feat/web-persona-picker`, open). Adds the
  six-persona demo entry point and private-session cleanup. §9.6's four new personas (Rosa
  Castellano, Felicia Reyes, Simone Lee, Dwayne Ferris) are additions to the file this PR
  establishes (`web/src/features/personas/personaData.ts`), landing once this contract's families
  exist to add them for.
- **Live Ask Rosina integration** — Codex Tasks W3 (`feat/web-ask-rosina`, PR #20, open:
  `docs/contracts/ask-rosina.md` now exists on that branch) and W4 (unscripted/cross-persona
  testing, per that contract's own "Bentley delivery needed" section), **plus** Bentley's matching
  backend — demo login, the Rosina service itself, reset, and create-demo-family. `ask-rosina.md`
  already reserves this contract's future action entries explicitly ("Reserved for
  coordination-v2 — owned by Claude/Bryan, NOT defined here") rather than guessing at them, and
  already defers the Family Calendar until this contract's event model lands — both exactly
  correct from that side. **Area G below covers only the catalog-wiring question once both
  contracts exist: an entry is a usable UI action only once its *backing* query/mutation is
  itself built — v2's own action entries stay marked "not implemented" in that catalog until
  Areas A–F ship behind them, which is a statement about sequencing, not about this being
  deferred work.**
- **Family Calendar** — owner **Codex**. Built against Area A's event model
  (`category`/`status`/`participants`, migration `0024_events_status_participants.sql`) and the
  adult-schedules minimum slice (§6, migration `0029_adult_schedules_minimum.sql`) — it starts
  only **after the events migration lands**, not in parallel with it. **Target: Sunday.** This is
  the exact surface `ask-rosina.md` itself names as deferred ("The Family Calendar is deferred
  until the final coordination-v2 event model... W3 does not build it") — this bullet is that
  deferral's activation now that Area A exists to build against, not a new ask.

### BEFORE NOV 4 (remaining build time, Mon–Tue) — ranked candidates, in priority order

**1. Orbit, minimal slice.** This is a requested capability, not something to classify as
deferred — the concrete tradeoff, as asked:

- **Exact migrations:** `0030_coordination_types_extended.sql` (enum widening, all three new
  types at once) + `0031_orbit_alert_minimal.sql` (`orbit_alerts`, `orbit_audience_members`,
  `orbit_responses` — **no location field anywhere in this slice**).
- **States:** `PENDING_ACTIVATION → ACTIVE → CLOSED` only — no richer sub-states.
- **Actions:** `activateOrbitAlert`, `respondToOrbitAlert` (three response values), `closeOrbit
  Alert`. **Not** included: `recordOrbitCheckIn` or any location plumbing at all.
- **UI:** the 911 banner, plus a flat audience-response list reusing Mission Control's existing
  job-card rendering — no map, no route, no check-in view.
- **Tests:** activation is parent/guardian-only; broadcast reaches the frozen eligible audience
  with no ranking; at least one response per value is recorded; closure-only-by-parent/guardian is
  proven by a **negative** test (a lone `WITH_ME` response does not close the alert); and a
  negative test proving no query path returns a coordinate or place name to a non-parent audience
  member — the one test that must exist even at this minimal size, because it's the named risk.
- **Estimate:** roughly 1.5–2 days for migration + resolvers + the one Mission Control card + the
  tests above. **This is an estimate, not a promise** — it depends on how much of Mission
  Control's existing rendering is reusable versus needing new chrome.
- **What it pushes aside:** `ConsentRequirement`'s full generality, `SUPERVISION`, and the
  adult-schedule editing UI all stay unbuilt through this window, per the priority order below.
- **What remains unproven even after this slice ships:** the parent-only last-check-in view (no
  location plumbing exists yet in the minimal slice, so "parents still see the last check-in in
  their own view," from the original task, is **not yet satisfied** — stated honestly, not
  glossed over); live dispatch through the existing n8n/GHL webhook path for a flat, simultaneous
  audience (pickup's dispatch is already parallel, but always to a ranked/evaluated list — Orbit's
  broadcast-to-a-frozen-list shape is a new call pattern into that same pipe, unproven); and any
  UI for editing `orbit_notify_eligible` itself (seeded directly, not editable yet).

**2. `ConsentRequirement` generality** (`0032_consent_requirement_full.sql`) — upgrading Stage 1's
single named approver to the frozen multi-approver list with a deadline and `EXPIRED` handling.

**3. `SUPERVISION`** (`0033_supervision_coordination.sql`) — `request_supervision`, reusing
pickup's machine and the existing `supervisionCandidates` ranking.

**4. Adult-schedule editing UI** (`0034_adult_schedules_editing.sql`) — `myScheduleDetail`, full
`visibility`/`DETAIL_TO_*` gating, and the UI to create/edit a `BusySlot` rather than only read a
seeded one (the Sunday minimum slice is read-only, seeded data).

### VISUAL POLISH (Sunday afternoon + Monday morning)

Scheduled, not awaiting a choice — moved out of "awaiting Bryan's choice" into the plan. Area 7's
visual intent beyond what the existing per-resolver scoping already produces for free: selecting a
child shows that child's authorized village cleanly; selecting a shared coach/teacher/activity
(§5.6) reveals only the viewer's own permitted connections; each child's distinct mix of
commitments and open items (§7) reads clearly when switching families, not just correctly.
**Claude Code leads; Codex owns shell changes** — Claude Code drives the feature-surface
rendering (village, calendar, Mission Control), Codex makes any change the app shell/routing
layer itself needs to support it, per the existing `frontend-data.md` §7 ownership split.

### AWAITING BRYAN'S CHOICE

Not deferred by this contract's own authority — one genuine candidate for deferral remains, named
so Bryan can decide, not assumed either way:

- **School's live `fileSchoolReport` authoring flow** — the schema/seed half ships Sunday (item 5,
  §10); turning it into a polished, demoable mutation is separate, unscheduled work.

---

## 12. Scenarios

Unchanged from Revision 1 (Scenarios 1–8), plus three new ones from §6. Every date is explicit, in
America/Detroit.

1. **Priya asks whether Nora can have a peanut-butter snack.** Mon 2026-10-21, 3:45 PM. Her
   `careplan.read` grant authorizes the read; Rosina answers from the `ALLERGY` `CareFact`,
   `PARENT_VERIFIED`. Nothing changes.
2. **Priya asks about bedtime and approved shows.** Same visit, 3:50 PM. Same grant; seeded
   `BEDTIME`/`APPROVED_SHOW` facts scoped to Kendra's household. Nothing changes.
3. **Andre proposes a parenting-time swap.** Fri 2026-10-23. Creates a `PROPOSED` `Holiday
   Arrangement` (one-off, `holidayName: null`); requires Kendra's explicit approval
   (`schedule_swap_approval: BOTH_PARENTS`) before it overrides the weekly schedule. Seeded
   **approved** in STORIES, with a **second, unapproved** swap request seeded in UPCOMING.
4. **Kendra reviews a field-trip consent request.** Sent Fri 2026-10-30; trip Thu 2026-11-05;
   deadline Mon 2026-11-03. Runs on Stage 1 (single named approver, resolved from `ANY_PARENT`).
   Seeded **still pending** in UPCOMING.
5. **"Who has Nora for Thanksgiving this year?"** Asked Sat 2026-10-31; holiday Thu 2026-11-26. An
   `APPROVED` `HolidayArrangement` overrides Andre's usual Thursday; `effectiveScheduleFor` states
   which rule produced the answer.
6. **"School is closed Monday. Who has confirmed they can help?"** Closure Mon 2026-11-09; asked
   Fri 2026-11-06. Runs on the new `SUPERVISION` coordination type once built (Before-Nov-4 tier);
   seeded **partially confirmed** to show "who has confirmed" honestly mid-discovery.
7. **A teacher reports missed homework.** Tue 2026-10-20. Angela's `school.write`-gated report
   creates a `Task`, resolved by Kendra on 2026-10-22.
8. **A parent authorizes an Orbit Alert.** Fri 2026-10-30, 4:10 PM. Kendra activates (Rosina only
   suggested); audience includes Andre by this household's explicit `orbit_notify_eligible`
   policy; no location ever reaches the audience; only Kendra/Andre can close it.
9. **A parent's shift overlaps gymnastics.** Thu 2026-10-22 (§6) — Dwayne's night shift orders, but
   never decides, who Rosina asks for Malik's gym pickup.
10. **Priya is already booked with another family.** Wed 2026-10-21 (§6) — Rosina surfaces the
    conflict with Malik's sitting session rather than silently double-booking her.
11. **A teacher conference forces a parenting-time adjustment.** (§6, tied to Scenario 5's own
    window) — Angela's conference block creates a one-off Area B handoff-time exception.

---

## 13. Summary for Bryan (one screen)

**This revision addresses your feedback and, pending your sign-off below, this contract is ready
for approval.**

- All eight Revision-1 recommendations are now **Decided (2026-10-30)** — including the fourth
  `SUPERVISION` coordination type and "no location of any kind to the Orbit audience, ever."
- **Migration numbers restarted at `0023`** — `feat/level-b-drafts` (PR #9) already claimed
  0021/0022 and merges first; every number here is a placeholder, re-checked at implementation
  time.
- **Four tiers, not three, and not one deadline:** **Sunday** commits the Authority model, Events,
  the adult-schedules *minimum* slice, Care info, the seed generator with all six Cast v2
  families, Holiday precedence, and minimal single-approver Consent — with an explicit risk note
  to trim BACKBONE filler first if time is short, never a family, a STORIES event, or the
  adult-schedules minimum. **P0 parallel work** — the persona picker (PR #19), live Ask Rosina
  integration (PR #20 + Bentley's backend), and now the **Family Calendar** (owner Codex, built
  against Area A's event model and adult schedules, target Sunday, starting once the events
  migration lands) — all run alongside, correctly not labeled deferred just because none is this
  contract's own critical path. **Before Nov 4**, ranked: Orbit's minimal slice (concrete
  migrations/states/UI/tests/estimate inside), then Consent's full generality, then Supervision,
  then the adult-schedule editing UI. **Visual polish** (§7) is now scheduled, not awaiting a
  choice — Sunday afternoon + Monday morning, Claude Code leading, Codex owning shell changes.
  **Awaiting your choice**, not assumed either way: only School's live authoring mutation remains.
- **Authority is now explicitly four separate facts**, not three role labels — the fix is four
  literal line-level edits (`0001_schema.sql:28`, `0003_rls.sql:18`, `0010_derived_query_helpers.
  sql:59`, `src/authz.ts:100`/`114`); every other RLS policy and resolver call site (30+ of them,
  listed in §3.2) inherits it for free by calling the one function each layer already has.
- **Cast v2** adds four new, respectfully-written family networks (a grandparent-guardian
  household, a blended family with delegated authority, a two-mother household, a night-shift
  single-father household) and seven concrete cross-family connections, each stating exactly what
  each side can and cannot see — none of it touches the Ellisons or Colemans.
- **Corrected this revision:** §9.5's Dana row overclaimed "full access to Nora's data" — fixed to
  match the actual evidence (`11c`, `11c2`, `11d`): her relationship is `DISCOVERED`, and her only
  access is the one bounded `pickup.request` grant Kendra approved, nothing wider. Every other
  persona row was re-checked against the same standard: "everything" now appears only where the
  person holds unbounded parent/guardian authority, never as shorthand for a grant.
- **Seed budget restated precisely:** ~24 recurring routine definitions, ~600–900 generated
  backbone rows (estimate), **60–80 historical events total, grouped into connected stories**,
  across the **whole** ecosystem (not per-family), ~15–20 UPCOMING records — all in a separate
  checksum baseline from the existing 28-table one.
