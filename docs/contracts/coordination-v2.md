# Contract — Coordination v2 (whole-life foundations)

**Status: DRAFT — needs Bryan's approval. Docs only; no code, no schema change, no data write
happened to produce this file.**

Branch `docs/coordination-v2`, worktree `../fridgegraph-coordination-v2`, created from
`origin/main` at **base SHA `72c1cf54cf98a370e43ff39e22bb52d9f513b971`**
(`72c1cf5 Meta Model API: verified values, blocked on the key (evidence 31) (#15)`, 2026-10-30).

## 0. Goal and how to read this

FridgeGraph should cover the child's whole life — not just pickups — without reworking what
already works. This contract designs the shared foundations (events, schedule/holidays, consent,
care info, school info, the coordination job engine, Ask Rosina's catalog) as a sequence of small,
additive migrations. **Pickup is the only implemented workflow today and must keep working,
unchanged, throughout.**

Every fact below carries one status tag:

| Tag | Meaning |
| --- | --- |
| **EXISTING** | present in `schema/*.graphql` today, cited to file:line |
| **IMPLEMENTED + EVIDENCED** | built, running, and proven in `docs/evidence/<file>` |
| **IN SCHEMA** | declared in SDL but has no resolver/evidence (e.g. an unused enum value) |
| **NEW-PROPOSED** | this contract's request; nothing in this status exists yet |
| **OUT OF SCOPE** | explicitly not building this round |

Rule followed throughout: **extend first.** Every area starts with what exists (file + line),
then states the smallest addition that gets the behavior, and only proposes a new type/table when
the existing one is shown, concretely, not to fit.

Timezone for every scenario date below: **America/Detroit**, per `data-model.md` §7 ("today" is
computed in `APP_TIME_ZONE`, never from `toISOString()`). Seed history dates (backbone/stories/
upcoming, §SEED) are fictional calendar dates inside the seed; they are never read from
`DEMO_CLOCK` and never drive RLS's `current_date` — same separation `data-model.md` §7 already
documents for the real auth clock vs. `x-demo-date`.

---

## A. Events + calendar

### What exists

- `Event` type — `schema/schedule.graphql:11-18`: `id`, `child`, `title`, `start`, `end`,
  `location`. **EXISTING.**
- `Query.events(childId, date)` — `schema/schedule.graphql:4`. **EXISTING.**
- Table `events` — `supabase/migrations/0001_schema.sql:123-130`: `id`, `child_id`, `title`,
  `start_at`, `end_at`, `location`. **EXISTING.**
- RLS `events_read` — `0003_rls.sql:132-133`: `is_parent_of(child_id) or has_scope(child_id,
  'schedule.read')`. **EXISTING.**
- `Practice`/`GroupEvent` (`schema/activities.graphql`) and `BusRoster`
  (`schema/transport.graphql`) are adjacent, narrower calendar-shaped facts, each already scoped by
  their own `*.read` grant. **EXISTING**, left untouched — they are not folded into `Event`.
- **`village_event` table — `supabase/migrations/0007_village_event.sql:9-19`.** This is the single
  most important existing piece for this whole area and is not yet wired to GraphQL at all:
  `id`, `occurred_at`, `recorded_at` (distinct — occurrence vs. recording time, exactly what the
  SEED PLAN's provenance rule asks for), `actor_id`, `subject_id` (child), `kind` (free string),
  `source` (`LIVE`|`SYNTHETIC_SCENARIO`), `scenario_id`, `payload jsonb`. RLS: parent or
  `schedule.read` (same rule as `events`). **EXISTING table, IN SCHEMA for GraphQL purposes** (no
  type exposes it yet). It was built "created EMPTY on purpose" for history, not the plan — exactly
  the shape §SEED needs, and exactly why this contract does not invent a second history table.

**Why this matters for "extend, don't replace":** FridgeGraph already has the planned/calendar
table (`events`) and the occurred/history table (`village_event`) as two separate, already-correct
concepts. The only gap is that `Event` has no status and no participants, and `village_event` has
no GraphQL surface.

### Additions — NEW-PROPOSED

1. **Extend `Event`** (not a new type) with:
   ```graphql
   enum EventCategory {
     PRACTICE GAME RECITAL PARTY FIELD_TRIP SLEEPOVER
     SCHOOL_CLOSURE HOLIDAY PARENTING_HANDOFF HOLIDAY_CAMP
   }
   enum EventStatus { PROPOSED CONFIRMED CANCELLED }

   extend type Event {
     category: EventCategory!
     status: EventStatus!
     participants: [Person!]!
     proposedBy: Person
     confirmedBy: Person
     confirmedAt: String
   }
   ```
   Migration: `alter table events add column category/status/proposed_by_id/confirmed_by_id/
   confirmed_at`, all nullable or `not null default` so existing rows (the one seeded `e_school_1026`
   row) stay valid without backfill guesswork — it gets `category = 'PRACTICE'`-shaped defaults
   explicitly in the migration, not a silent NULL. New join table `event_participants(event_id,
   person_id, role)`.
2. **`proposeEvent(childId, title, category, start, end, location, participantIds)`** — **NEW
   mutation.** Caller must be a parent, or hold a **NEW** grant scope `events.propose` (narrower
   than `schedule.read` on purpose: reading the calendar never implies the right to add to it).
   Writes `status: PROPOSED`.
3. **`confirmEvent(eventId, decision: EventConfirmDecision!)`** (`CONFIRMED`/`CANCELLED`) — **NEW
   mutation.** Default confirmation authority is **any parent** (`household_policies` rule
   `event_confirmation`, default `ANY_PARENT`, mirroring the existing `caregiver_approval` value
   already seeded for `h_a` — `src/fixtures.ts:331`). A household may instead set a category-scoped
   rule (e.g. `PARENTING_HANDOFF` requiring both parents) — read as a policy row, never hardcoded.
   An invitation or a proposed change is explicitly **not** a confirmed event until this runs — the
   exact rule the task asked for.
4. **Expose `village_event` in GraphQL** as `villageHistory(childId: ID!, from: String, to:
   String): [VillageEvent!]!` (**NEW** query, `schedule` subgraph — the table already lives next to
   `events` conceptually). `VillageEvent { occurredAt, recordedAt, actor: Person, kind: String,
   source: VillageEventSource!, scenarioId: String, payload: String }`. This is the read surface
   the SEED PLAN's "every calendar item opens to real detail" requirement needs: a confirmed
   practice on the calendar links to the `VillageEvent` row(s) that recorded what actually happened
   with it (cancelled, moved, etc.), not a decorative dot.

### Permissions

| Action | Who |
| --- | --- |
| Read `Event`/`villageHistory` | unchanged: parent, or `schedule.read` grant holder |
| `proposeEvent` | parent, or a **NEW** `events.propose` grant holder |
| `confirmEvent` | parent (default), or whoever `household_policies.event_confirmation` names for that category |

### Migration

`0021_events_status_participants.sql` — additive columns + `event_participants` table + grant
scope `events.propose`. Acceptance check: the existing seeded event (`e_school_1026`) still reads
identically through `events(childId, date)`; a new `proposeEvent`/`confirmEvent` round-trip is
provable without touching `coordination_jobs` or any pickup table.

---

## B. Parenting schedule + holidays

### What exists

- `ParentingSchedule` type — `schema/access.graphql:55-59`: `child`, `parent`, `weekdays: [String!]`.
  **EXISTING.**
- Table `parenting_schedules` — `0001_schema.sql:115-120`, PK `(child_id, parent_id)`. **EXISTING.**
- RLS `parenting_schedules_read` — `0003_rls.sql:128-129`. **EXISTING.**
- `_is_approver_for(child, as_of)` — `0013_station06_coordination.sql:216-224`: the pickup job's
  **approver** rule, matching `parenting_schedules.weekdays` against the day of week. **IMPLEMENTED
  + EVIDENCED** (`docs/evidence/02-approver-thursday.md`).
- `approverFor(childId, date)` — `schema/access.graphql:10`, resolved by
  `approverForChild` in `src/derive.ts`, called from `src/subgraphs/access.ts:291-298`.
  **IMPLEMENTED + EVIDENCED** (`docs/evidence/02-approver-thursday.md`). Returns `approver: null`
  + all parents in `fyiParents` when no schedule row matches (`docs/questions.md` item 5) — the
  honest "nobody's day" case, already a precedent for "surface, don't guess."
- Real seed today: Kendra `MON,TUE,WED`, Andre `THU,FRI,SAT,SUN` (`src/fixtures.ts:353-354`) — a
  pure weekly split, no holiday carve-outs.

### Additions — NEW-PROPOSED

1. **`HolidayArrangement`** (new type/table — justified below): `id`, `child`, `holidayName`
   (free string, village data not graph vocabulary, same reasoning `schema-plan.md` gives for
   relationship types), `dateStart`, `dateEnd`, `assignedParent: Person!`, `pickupDutyParent:
   Person`, `dropoffDutyParent: Person`, `status: HolidayArrangementStatus!` (`PROPOSED`/
   `APPROVED`/`DECLINED`), `proposedBy: Person!`, `approvalId: ID` (the `Approval` row that
   resolved it — see Area C; reused, not duplicated).

   *Why a new type instead of extending `ParentingSchedule`:* `ParentingSchedule` is a standing,
   unconditional weekly rule with no start/end, no status, and no second approver. Holiday
   arrangements are the opposite on every axis — bounded, conditional on explicit approval, and
   the exact thing that is supposed to **override** the weekly rule rather than be another row of
   it. Folding them into `ParentingSchedule` would make "is this parent's day" a query over mixed
   permanent and temporary rows with no way to say which wins; that ambiguity is precisely what
   the precedence rule below exists to prevent.
2. **Precedence rule, explicit and queryable, never silent:**
   `effectiveScheduleFor(childId: ID!, date: String!): EffectiveSchedule!` (**NEW**, `access`
   subgraph, same derived-query pattern as `approverFor`): checks for an **APPROVED**
   `HolidayArrangement` covering `date` first; if one exists, it wins outright over
   `parenting_schedules` for that date, full stop. If none exists, falls back to the weekly
   schedule exactly as today. `EffectiveSchedule { parent: Person, source: ScheduleSource!
   # WEEKLY | HOLIDAY_ARRANGEMENT, arrangement: HolidayArrangement }`. `approverFor` and
   `_is_approver_for` (pickup's approver check) are updated to call this instead of
   `parenting_schedules` directly — **pickup's existing behavior is unchanged** wherever no
   `HolidayArrangement` exists, which is every date in the current seed.
3. **Conflicts surfaced, never resolved silently:** `scheduleConflicts(childId: ID!, from: String!,
   to: String!): [ScheduleConflict!]!` (**NEW**, `access`). A conflict is either (a) two `APPROVED`
   `HolidayArrangement`s with overlapping date ranges for the same child, or (b) a `PROPOSED`
   arrangement overlapping an already-`APPROVED` one. Returned, not auto-resolved — the task's
   explicit instruction. `ScheduleConflict { kind, arrangements: [HolidayArrangement!]!, dateStart,
   dateEnd }`.
4. **Approved exceptions** (a one-off pickup/drop-off swap that isn't a holiday) reuse the same
   `HolidayArrangement` shape with `holidayName: null` and a single-day range — one mechanism for
   both "Thanksgiving" and "Andre's one-off Friday swap" (Scenario 3), not two.

### Permissions

| Action | Who |
| --- | --- |
| Read `HolidayArrangement`/`effectiveScheduleFor`/`scheduleConflicts` | parent, or `schedule.read` grant holder — identical to `parenting_schedules_read` today |
| Propose | either parent (or a `schedule.read`+`events.propose` grant holder suggesting on a parent's behalf — e.g. a grandparent floating an idea — but it stays `PROPOSED` until a parent acts) |
| Approve/decline | **the other parent**, specifically — `household_policies` rule `schedule_swap_approval`, default `BOTH_PARENTS` (deliberately different from `event_confirmation`'s `ANY_PARENT` default: one parent unilaterally moving custody time is the "co-parent never overrides a grant or restriction by itself" case the task calls out by name) |

### Migration

`0022_holiday_arrangements.sql` — new `holiday_arrangements` table, RLS mirroring
`parenting_schedules_read`, grant `household_policies` the new `schedule_swap_approval` rule name
(no schema change needed there — `rule`/`value` are already free-text columns). Acceptance check:
`approverFor`/`_is_approver_for` return byte-identical results to today for every date with no
`HolidayArrangement` row — i.e. the existing 32-case evidence suite is unaffected.

---

## C. Consent

### What exists

- `Approval` type — `schema/access.graphql:40-47`: `id`, `approver`, `subjectType`, `subjectId`,
  `decision`, `at`. Table `approvals` — `0001_schema.sql:99-106`, `subject_type` constrained to
  `('Relationship','Grant')`, `decision` to `('APPROVED','GRANTED','REVOKED')`. **EXISTING**,
  **IMPLEMENTED + EVIDENCED** (`docs/evidence/11c-kendra-approves.md`,
  `docs/evidence/11c3-approvals-exist.md`) — it is already an append-only, polymorphic decision
  ledger: `data-model.md` §2 calls `approveRelationship`'s write into it "the single intentional
  cross-table write."
- `PermissionSlip` type — `schema/school.graphql:20-25`: `id`, `child`, `title`, `signed: Boolean!`.
  Table `permission_slips` — `0001_schema.sql:140-145`. RLS: parent or `school.read`. **EXISTING**,
  **IN SCHEMA** (no mutation exists to sign one, no fixture seeds a row yet).

### Why extend `Approval`, not invent `ConsentRequest`

The task's rule points at `PermissionSlip` by name, so the case against it has to be made
explicitly. `PermissionSlip.signed` is a single boolean on a single row: it cannot represent "this
needs two named approvers, one has acted, one hasn't," a deadline, or a decision history — adding
those fields to `PermissionSlip` would not be extension, it would be rebuilding `Approval` a
second time under a different name, and it would still be owned by `school` (port 4005), which is
wrong for consent subjects that have nothing to do with school (a parenting swap, an Orbit
activation) — `data-model.md` §2's "every subgraph writes only its own tables" rule would be
violated the moment a non-school consent tried to live there.

`Approval` already has the one piece every other option is missing: polymorphic `subjectType`/
`subjectId`, and it is already the ledger `approveRelationship` writes to. The actual gap is
narrower than "no consent model exists" — it is "no table records an **open request**: who must
decide, by when, still pending." `Approval` only ever records a decision that already happened.

### Additions — NEW-PROPOSED

1. **`ConsentRequirement`** (the one genuinely new table): `id`, `subjectType` (`'Event'`|
   `'HolidayArrangement'`|`'PermissionSlip'`|`'OrbitAlert'` — reuses `Approval`'s polymorphism
   scheme), `subjectId`, `householdId`, `requiredApproverIds: [ID!]!` (**frozen at creation time**
   from `household_policies` + `grants` — never recomputed live; this is the literal mechanism for
   "required approvers from explicit household policy and grants, NOT from whose day it is"),
   `deadline`, `status` (`PENDING`/`SATISFIED`/`EXPIRED`/`DECLINED`), `createdBy: Person!`,
   `createdAt`, `linkedEventId: ID`.
2. Deciding against one writes an `Approval` row with `subjectType: 'ConsentRequirement'`,
   `subjectId` = the requirement's id, `decision` in `('APPROVED','DECLINED')` (**adds `DECLINED`**
   to the existing check constraint — additive, `NOT VALID`, same pattern `0013` used throughout).
   History is simply "every `Approval` row for this `subjectId`, ordered by `at`" — no new history
   mechanism needed, because `Approval` is already append-only.
3. `PermissionSlip.signed` stays exactly as it is for the narrow "a literal school document was
   signed" fact. A `ConsentRequirement`/`Approval` pair can **link** to a `PermissionSlip`
   (`subjectType: 'PermissionSlip'`) to record FridgeGraph's own in-app decision about it, but the
   two are never conflated — the contract's own rule: a recorded demo approval is not a legally
   binding signature and implies no school integration. The GraphQL field exposing this fact reads
   `inAppDecision: Approval` on `PermissionSlip`, never renamed `signed`.

### Permissions

| Action | Who |
| --- | --- |
| Read `ConsentRequirement` | parent of the child, or one of its own `requiredApproverIds` — **not** a general `schedule.read`/`careplan.read` holder, because being read-authorized for the child's calendar never implies a say in consent |
| Decide (write an `Approval` against it) | only a person in the **frozen** `requiredApproverIds` list — explicitly not "whoever is today's scheduled parent" |

### Migration

`0023_consent_requirements.sql` — new `consent_requirements` table + RLS; widen
`approvals_subject_type_check`/`decision` constraints (additive). Acceptance check: existing
`Relationship`/`Grant` approval flows (`docs/evidence/11c*`) produce identical results; a new
`ConsentRequirement` round-trip for, say, a `PermissionSlip` subject is provable independently.

---

## D. Care information

### What exists

- `CarePlan` type — `schema/village.graphql:121-124`: `child`, `text`. Table `care_plans` —
  `0001_schema.sql:83-86`, one free-text row per child. RLS `care_plans_read` — `0003_rls.sql:
  96-97`: parent or `careplan.read`. **EXISTING**, **IMPLEMENTED + EVIDENCED**
  (`docs/evidence/04-loretta-goals-careplan-contact.md`, `06a`/`06b`/`06c`). Today Nora's plan is
  exactly one sentence: "Peanut allergy. Epi-pen in right backpack pocket."
  (`src/fixtures.ts:290`) — free text, as the task says, with no structured severity anywhere.
- `Goal` type (`schema/village.graphql:111-119`) already shows the shape for a **structured,
  owned, status-bearing** child fact (`PROPOSED`/`APPROVED`, `owner`, `proposedBy`) — a useful
  precedent, but it models aspirations, not care facts, and is not reused directly.

### Additions — NEW-PROPOSED

**`CareFact`** — a new, structured sibling to `CarePlan`, same ownership (`village` subgraph),
same table family (not a replacement — `CarePlan.text` stays as the freeform narrative fallback
for anything not yet broken into facts):

```graphql
enum CareFactCategory {
  ALLERGY FOOD_RESTRICTION BEDTIME SCREEN_TIME APPROVED_SHOW APPROVED_ACTIVITY OTHER
}
enum VerificationStatus { UNVERIFIED PARENT_VERIFIED PROFESSIONAL_VERIFIED }

type CareFact {
  id: ID!
  child: Child!
  household: Household        # null = applies in every household; set = this house's own rule
  category: CareFactCategory!
  text: String!
  sourceLabel: String!         # "Kendra", "Dr. Patel's note" — free text, never inferred
  verificationStatus: VerificationStatus!
  verifiedBy: Person
  verifiedAt: String
}
```

**Explicitly never done:** inferring `VerificationStatus` or a severity level from `text` — the
task's instruction by name. `UNVERIFIED` is the default for anything entered without a parent or
professional attached; nothing promotes itself.

**"Rules may differ by household"** is the reason `household` is nullable rather than the fact
being purely child-scoped: Kendra's house and Andre's house can each carry their own `SCREEN_TIME`
rule for Nora, visible to both (see permissions below), while `ALLERGY` stays household-null
(applies everywhere, because an allergy doesn't change by address).

### Permissions

| Action | Who |
| --- | --- |
| Read any `CareFact` for a child, regardless of which household it's scoped to | unchanged from `CarePlan` today: parent, or `careplan.read` grant holder — **everyone who can see the care plan sees every household's rules**, so a sitter or grandparent is never told half the picture |
| Write/verify a household-scoped fact | a parent **in that specific household** (**NEW** helper `is_parent_of_household(callerId, householdId)`, narrower than `is_parent_of(child)`, which already spans a multi-household child like Nora — `0003_rls.sql:11-19`) |
| Write/verify a household-null (shared) fact | any parent of the child |

### Migration

`0024_care_facts.sql` — new `care_facts` table, RLS reusing `has_scope(child, 'careplan.read')` for
read and the new household-scoped helper for write. Acceptance check: `CarePlan.text` for Nora and
Jax read identically to today; a new `CareFact` row for Nora is independently readable by Priya
(who holds `careplan.read`, `src/fixtures.ts:311`) without touching `care_plans`.

---

## E. School information

### What exists

- `SchoolReport` type — `schema/school.graphql:12-18`: `id`, `child`, `kind` (free string, per
  `schema-plan.md`'s "village data, not graph vocabulary" rule), `text`, `at`. Table
  `school_reports` — `0001_schema.sql:132-138`. RLS: parent or `school.read`. **EXISTING**, **IN
  SCHEMA** (no fixture seeds a row; no mutation exists at all — `schema/school.graphql` has no
  `Mutation` type today, same gap `coordination.graphql` had before Station 06).
- `capabilities` table (`0001_schema.sql:53-58`) already records who **offers** to file reports:
  `p_price` (Angela) and `p_jennings` (Carol) both hold `school.report`
  (`src/fixtures.ts:243-244`) — explicitly "what someone offers, never permission"
  (`village.graphql:93-96` comment). This is the exact distinction the new write path below has to
  respect: a capability is not a grant.

### Additions — NEW-PROPOSED

1. **`fileSchoolReport(childId, kind, text, createsEventInput, createsTaskInput)`** — **NEW**
   mutation, `school` subgraph. Authorization is a **NEW** grant scope `school.write`, deliberately
   separate from the existing `school.read` (seeded additionally for Angela and Carol, who already
   hold `school.read` — the capability row says they *can* write reports; the new grant is what
   actually lets them). A `capabilities` row alone still grants nothing, unchanged.
2. **`extend type SchoolReport { createdBy: Person, status: SchoolReportStatus!, linkedEventId:
   ID, linkedTaskId: ID }`** (`SchoolReportStatus`: `OPEN`/`ACKED`/`RESOLVED`) — today's type has no
   author at all.
3. **`Task`** (**NEW**, minimal, owned by `school`): `{ id, child, title, createdFromReportId,
   owner: Person, dueDate, status: TaskStatus! }` (`OPEN`/`DONE`). Deliberately small — this is "a
   message can create a task," not a project-management system.
4. A report may optionally create a **`PROPOSED`** `Event` (Area A) in the same call — "it doesn't
   go straight onto the calendar," per the task. This is a **second** intentional cross-subgraph
   write (`school` → `schedule`), alongside `approveRelationship`'s existing one into `approvals`.
   `data-model.md` §2 is explicit that a second one needs its own recorded decision before it's
   built — flagged as Open Question 1 below rather than decided here.

### Permissions

| Action | Who |
| --- | --- |
| Read `SchoolReport`/`Task` | unchanged: parent, or `school.read` |
| `fileSchoolReport` | a **NEW** `school.write` grant holder (not just a `capabilities` row) |
| Resolve a `Task` | parent of the child, or the `Task.owner` if that owner is a grant holder acting on the parent's behalf |

### Migration

`0025_school_reports_and_tasks.sql` — additive columns on `school_reports`, new `tasks` table, new
grant scope `school.write`. Acceptance check: `schoolReports`/`permissionSlips` queries are
unaffected (both still return `[]` against the current empty fixture); a new `fileSchoolReport` →
`Task` round-trip is independently provable.

---

## F. Coordination types — the shared job engine

### What exists (PICKUP, today's only built workflow)

- `CoordinationType` enum — `schema/coordination.graphql:24-28`: `PICKUP` **IMPLEMENTED +
  EVIDENCED** (Station 06, `docs/evidence/21-b4-coordination.md` and the pickup-job proof suite);
  `INVITATION`/`ONBOARDING` — declared in the SDL (`coordination.graphql:26-27`) and in the DB
  check constraint (`0001_schema.sql:176`), with **zero** resolvers or mutations anywhere in
  `src/subgraphs/coordination.ts`. **IN SCHEMA, not built.**
- `CoordinationJob` — id, idempotencyKey, type, child, status, version
  (`coordination.graphql:46-56`), plus **NEW fields already shipped** by the pickup contract:
  `requestVersion`, `discoveryTimeoutSeconds`, `approvalTimeoutSeconds`, `failureReason`, `asOf`,
  `createdAt`, `overLimitCandidateId` (`0013_station06_coordination.sql`, `0017_over_limit_
  fallback.sql`). **IMPLEMENTED + EVIDENCED.**
- `Attempt`, `InformationRequest`, `Confirmation`, `candidate_evaluations`, `real_call_
  authorizations`, `locations`, `webhook_events` — all **IMPLEMENTED + EVIDENCED**, all owned by
  `coordination` (port 4003, `data-model.md` §2).
- Functions: `request_pickup`, `accept_pickup`, `accept_pickup_webhook`, `approve_pickup`,
  `close_discovery`, `consume_real_call_authorization`, `_rank_and_advance`,
  `_evaluate_candidates`, `_is_approver_for` — all `SECURITY DEFINER`, all with **EXECUTE revoked
  from PUBLIC/anon**, `authenticated` getting **SELECT only** on every coordination table
  (`0013_station06_coordination.sql`'s own security-model comment, lines 5-16). **This posture —
  no direct write grant to `authenticated`, every transition behind a definer function — is the
  one rule this contract treats as non-negotiable for every new coordination type below.**
- `pickupCandidates`/`supervisionCandidates` (`schema/access.graphql:8-9`) — derived, ranked
  candidate lists, **IMPLEMENTED + EVIDENCED**. `supervisionCandidates` already exists as a sibling
  to `pickupCandidates` and is the precedent that this engine generalizes past one workflow.

### Additions — NEW-PROPOSED: CONSENT and ORBIT_ALERT on the same engine

1. **Extend `CoordinationType`** with `CONSENT` and `ORBIT_ALERT` (additive enum values) and widen
   `coordination_jobs.type`'s check constraint to match (additive, `NOT VALID`, same pattern as
   every other constraint widening in this contract).
2. **CONSENT** reuses Area C almost entirely: a `CONSENT`-type `CoordinationJob` wraps exactly one
   `ConsentRequirement` (`ConsentRequirement.jobId` FK), which is what gives consent requests the
   same version/status/audit scaffolding pickup already has, instead of building a second state
   machine. Status vocabulary for this type: `pending → awaiting_approvers → approved|declined|
   expired` — distinct strings from pickup's, coexisting in the same `status` text column (already
   unconstrained to a single workflow's vocabulary; the check constraint lists the union, same as
   `reason_code` already lists every pickup outcome in one place).
3. **ORBIT_ALERT** — new tables, new rules, deliberately **not** reusing `pickupCandidates`:

   | | Pickup's `pickupCandidates`/ranking | Orbit's audience |
   | --- | --- | --- |
   | Who's eligible | derived from ACTIVE relationship + a `pickup.*` grant, computed fresh every call | a **frozen, explicit allowlist** per household (`household_policies` rule `orbit_notify_eligible`, listing person ids) — never derived from relationship type or any other grant |
   | Ordering | a deterministic ranking (authorization → availability → transport → distance → resolver order) that picks **exactly one** | a flat `notify_order`, broadcast to **everyone eligible at once**, **no waiting period** before the approved village is told |
   | Outcome | one recommendation, one approval | **many** independent responses; no single "winner" is ever selected |
   | Co-parent's presence | irrelevant to pickup's authorization model | **included only where policy explicitly says so** — being a co-parent never grants Orbit eligibility by itself |

   - `orbit_alerts(id, job_id, child_id, activated_by, activated_at, status, closed_by, closed_at,
     last_checkin_location_id, minimal_message)`. `activated_by`/`closed_by` **must** be a parent —
     enforced in the definer function, never inferred from "with me."
   - `orbit_audience_members(orbit_alert_id, person_id, notify_order, notified_at, eligible,
     eligibility_source)` — `eligible`/`eligibility_source` are written once at activation from the
     frozen `orbit_notify_eligible` policy list, same "freeze at creation" principle as Area C's
     `requiredApproverIds`.
   - `orbit_responses(orbit_alert_id, person_id, responded_at, response, note)` —
     `response ∈ {WITH_ME, ON_WAY, CANNOT_HELP}` — the **response timeline** the task asks for.
   - **Minimal information shared, by construction**: `orbit_audience_members`/`orbit_responses`
     reads never join `locations`. `last_checkin_location_id` exists only on `orbit_alerts` and is
     readable **only** by a parent of the child (own-view only) — audience members never receive a
     coordinate, place name, or "last confirmed at," matching the task's recommendation. **This is
     flagged as Open Question 5 below so Bryan can overrule it**, per the task's own instruction.
   - **Closure only by a parent, never automatic**: `closeOrbitAlert` is the only transition into
     `CLOSED`; no response, including `WITH_ME`, ever closes the alert by itself.
   - **The 911 banner is a `web/` rendering rule**, not a schema concern: any UI surfacing
     `OrbitAlert.status: ACTIVE` renders the banner from first paint — noted here so it's not lost,
     owned by `frontend.md`.
   - New mutations: `activateOrbitAlert(childId, message)`, `closeOrbitAlert(alertId, version)`,
     `respondToOrbitAlert(alertId, response, note)`, `recordOrbitCheckIn(alertId, locationId)`.
   - New derived query (parallel to `pickupCandidates`, deliberately differently named so nobody
     confuses the two): `orbitEligibleAudience(childId: ID!): [OrbitAudienceCandidate!]!`, owned by
     `access` (eligibility is policy data, same home as `pickupCandidates`).

### Permissions

| Table | Read | Write |
| --- | --- | --- |
| `consent_requirements`-backed `CONSENT` jobs | parent, or a frozen `requiredApproverIds` member (Area C) | definer functions only |
| `orbit_alerts`/`orbit_audience_members`/`orbit_responses` | parent (full); an audience member reads only their **own** `orbit_audience_members`/`orbit_responses` row — same shape as `candidate_evaluations_read`'s `candidate_id = current_person()` clause (`0013:158-163`) | definer functions only; **zero** INSERT/UPDATE/DELETE grant to `authenticated`, matching `0013`'s own stated non-negotiable |

### Migration

`0026_consent_coordination_type.sql`, `0027_orbit_alert.sql` — two migrations, not one, so a
problem in Orbit never blocks shipping Consent. Acceptance check for each: the full pickup proof
suite (`docs/evidence/`, 32 cases) and `node ops/b4-proof.mjs coordination` are unaffected; `CONSENT`/
`ORBIT_ALERT` jobs are provable independently with their own small fixtures, cleaned up per
`data-model.md` §1.

---

## G. Ask Rosina's action catalog

`docs/contracts/ask-rosina.md` does not exist in this worktree or on any branch visible from here
(`git log --all`/`git branch -a` show no `ask-rosina` content as of this base SHA) — it is still
being written by Codex elsewhere, so this section cites the six named actions only against what
is independently verifiable today, and states, per the task's own rule, that **an action is a
usable UI action only once its underlying query/mutation is itself IMPLEMENTED + EVIDENCED** — a
doc describing an action never makes it usable by itself.

| Action | Underlying primitive | Status today |
| --- | --- | --- |
| Read schedule | `events`, `practices`, `parentingSchedule` | primitives **EXISTING/IMPLEMENTED**; no evidenced "Ask Rosina" NL action wrapper exists yet — **NEW-PROPOSED** action-layer wiring only, no schema gap |
| Explain a rule | `householdPolicy` | same as above — primitive exists, action wrapper **NEW-PROPOSED** |
| Propose an event | Area A's `proposeEvent` | blocked on Area A shipping — **NEW-PROPOSED**, not usable until A lands |
| Request consent | Area C's `ConsentRequirement` | blocked on Area C — **NEW-PROPOSED** |
| Propose a parenting swap | Area B's `HolidayArrangement` | blocked on Area B — **NEW-PROPOSED** |
| Suggest Orbit | Area F's `ORBIT_ALERT`, **suggest only** — Rosina may never call `activateOrbitAlert` itself; only a parent can | blocked on Area F — **NEW-PROPOSED**, and permanently restricted even once built |

**Recommendation:** the two read-only actions ("read schedule," "explain a rule") need no new
mutation and can ship as soon as an action-catalog dispatcher exists in `web/` — that is a frontend
task, not blocked by any migration in this contract. The other four are gated on their areas above,
in the order given in §Implementation order.

---

## Cast

Dana Coleman (`p_dana`) is excluded **only** from the synthetic history seed, per the task; her
persona, fixtures, and existing access tests are unchanged. This is **already implemented, not a
new rule**: `src/fixtures.ts:200` seeds `r_dana_friend_parent` as `DISCOVERED`, created
`2026-10-24` — i.e. she is already modeled as having just entered Nora's village near the end of
the STORIES window, with full evidence of the before/after transition
(`docs/evidence/11a-dana-absent-before.md`, `11d-dana-now-candidate.md`, `11f2-dana-absent-after-
reset.md`). Every new v2 history record (backbone or stories) must respect the same cutoff: no
record dated before 2026-10-24 may name Dana as a participant, actor, or subject of anything in
Nora's village. In Jax's village she is already an unconditional `ACTIVE` parent
(`src/fixtures.ts:202`) and is untouched by this rule.

---

## Scenarios

Every scenario date is explicit and in **America/Detroit**. Each depends on the NEW-PROPOSED
pieces above — none of this is runnable until the migrations in §Implementation order land.

### 1. Priya asks whether Nora can have a peanut-butter snack

**Mon 2026-10-21, 3:45 PM.** Priya (`p_priya`) is sitting after school. She asks Rosina.
Rosina reads `careFacts(childId: "p_nora")` (Area D) and the legacy `carePlan.text`. Priya's grant
`g_priya` already includes `careplan.read` (`src/fixtures.ts:311`), so the read is **authorized**
(`has_scope` unchanged). The `ALLERGY` `CareFact` is seeded `PARENT_VERIFIED` (Kendra entered it).
Rosina answers: no — peanut allergy, epi-pen in the right backpack pocket, verified by Kendra.
**Nothing changes** — this is a pure read.

### 2. Priya asks about bedtime and approved shows

**Same visit, 3:50 PM.** Same grant, same scope check. The seed adds a household-scoped
(`h_a`) `BEDTIME` fact and an `APPROVED_SHOW` fact, both `PARENT_VERIFIED`, scoped to Kendra's
house since that's where Priya is sitting tonight. Rosina answers with both, and — honestly — would
say "not on file" for anything not seeded, rather than guess. **Nothing changes.**

### 3. Andre proposes a parenting-time swap

**Fri 2026-10-23.** Andre (`p_dad`) has a work trip and wants to trade his Friday for next
Tuesday (Kendra's day). He is a parent (`is_parent_of` true) — he can **propose** freely. This
creates a `HolidayArrangement` (Area B) with `status: PROPOSED`, `holidayName: null`,
`dateStart/dateEnd` = 2026-10-23 and 2026-10-27. Required approver: Kendra specifically
(`schedule_swap_approval: BOTH_PARENTS`, Area B's permission table) — **not** "whoever's day it
is," since the whole point is changing whose day it is. Until Kendra approves, `effective
ScheduleFor` for Oct 23 still returns the **weekly** schedule (Andre) — the precedence rule only
engages once `status: APPROVED`. Seeded as **approved** in STORIES (§SEED) to demonstrate the full
path; an **unapproved** second swap request is seeded in UPCOMING to show the pending state
honestly.

### 4. Kendra reviews a field-trip consent request

**Request sent Fri 2026-10-30 (today); trip Thu 2026-11-05; deadline Mon 2026-11-03, all America/
Detroit.** Angela (`p_price`, teacher) files a `SchoolReport` (`kind: 'field_trip_permission'`)
which creates a `PermissionSlip` + a `ConsentRequirement` (Area C) with `requiredApproverIds:
['p_mom']` — frozen from `household_policies.caregiver_approval = ANY_PARENT` for `h_a` at creation
time, so only Kendra needs to act even though Andre is also a parent. Kendra reads it via
`chatThread`/Mission Control, approves before the deadline: `Approval{ subjectType:
'ConsentRequirement', decision: APPROVED }`. Seeded **still pending** in UPCOMING (§SEED) to show
an open consent request honestly, per the task's explicit instruction.

### 5. "Who has Nora for Thanksgiving this year?"

**Asked Sat 2026-10-31; the holiday itself is Thu 2026-11-26.** The weekly schedule alone would say
Andre (`THU,FRI,SAT,SUN`). An **APPROVED** `HolidayArrangement` ("Thanksgiving 2026," alternating-
year rule, Kendra's year) covering Nov 26–28 exists in the seed. `effectiveScheduleFor` returns
Kendra, `source: HOLIDAY_ARRANGEMENT`, and Rosina **says which rule produced the answer** — "the
holiday arrangement for Thanksgiving overrides Andre's usual Thursday" — rather than just stating a
name with no provenance. If no arrangement existed, Rosina would say so explicitly and flag it via
`scheduleConflicts`-adjacent honesty rather than silently defaulting to the weekly rule as if it
were a holiday decision.

### 6. "School is closed Monday. Who has confirmed they can help?"

**Closure Mon 2026-11-09; asked the preceding Fri 2026-11-06.** A `SchoolReport` (`kind:
'school_closure'`) from Carol (`p_jennings`) creates a `PROPOSED` `Event` (`category:
SCHOOL_CLOSURE`). This needs **coverage**, which is a supervision-shaped coordination need —
closest to pickup's engine, via the already-existing `supervisionCandidates`, but it does not fit
cleanly into `PICKUP`/`CONSENT`/`ORBIT_ALERT` as named. **Flagged as Open Question 4** rather than
quietly invented: recommend a fourth `CoordinationType: SUPERVISION` reusing the exact
`pending → discovering → awaiting_approval → confirmed/failed` machine pickup already proved,
since `supervisionCandidates` already generalizes the ranking half. Seeded **partially confirmed**
(Loretta says yes; Tasha hasn't replied) to show "who has confirmed" honestly mid-discovery.

### 7. A teacher reports missed homework

**Tue 2026-10-20.** Daniel (`p_okafor`, substitute, holds `g_daniel` `careplan.read` only — **not**
`school.write`) cannot file this; it's Angela's seed instead (`school.write`, Area E). `kind:
'homework_followup'` creates a `Task` (owner: Kendra, `status: OPEN`, `dueDate` 2026-10-22).
Resolution, seeded within STORIES: Kendra marks it `DONE` on 2026-10-22 after following up at
home — the "missed assignment → teacher follow-up → resolution" chain the SEED PLAN names
explicitly.

### 8. A parent authorizes an Orbit Alert

**Fri 2026-10-30 (today), 4:10 PM.** Nora wasn't picked up from soccer on time; Kendra is stuck in
traffic. She asks Rosina to "suggest Orbit" (Area G) — Rosina may only **suggest**; Kendra herself
calls `activateOrbitAlert`. Audience: `orbit_notify_eligible` for `h_a`/`h_b` includes Loretta,
Bryan, Tasha, Monique (Nora's existing pickup grant holders) **and** Andre — this household's
explicit policy choice to include the co-parent, demonstrating that inclusion is policy, not
default. All are notified **simultaneously**, no waiting period, `notify_order` only recording
display sequence. The 911 banner renders immediately in the UI. No coordinate or place name is
ever sent to the audience (Open Question 5's default); Kendra's own Mission Control view shows the
last check-in. Loretta responds `ON_WAY`; Tasha responds `CANNOT_HELP`. Only Kendra (or Andre)
can close the alert — it stays `ACTIVE` until a parent explicitly does so, even after Loretta's
`WITH_ME`.

---

## Seed plan (design only — no data written by this task)

Three layers, exactly as specified, built on the v2 event/job model above and generated only after
it exists.

1. **BACKBONE, Sep 1 – Oct 29.** Recurring routines only — school days, soccer, gymnastics, bedtime,
   parenting handoffs — generated deterministically from `parenting_schedules` + the Tigers
   practice cadence already in the seed (`src/fixtures.ts:386-388`). Every row carries
   `village_event.source = 'SYNTHETIC_SCENARIO'` and a `scenario_id` of `backbone`. Dana excluded
   throughout, per §Cast.
2. **STORIES, Oct 19–25.** The 60–80 connected events: Scenarios 3 (approved swap), 7 (homework →
   follow-up → resolution), plus the task's named chain — "early dismissal → coordination job →
   unsuccessful outreach → another adult confirms → assignment changes → parent notified" — built
   as one connected sequence sharing a single `scenario_id`, each row's `payload` referencing the
   prior step's record id. Also: a completed pickup (reusing the real evidenced pickup job
   lifecycle, replayed as `SYNTHETIC_SCENARIO`), an unavailable caregiver (`UNAVAILABLE` reason
   code, already a real enum value), a `NO_TRANSPORT` reply + parent approval, a past consent
   decision (Area C, already `APPROVED`), a parent-verified allergy record (Scenario 1's `CareFact`),
   a cancelled practice, a moved recital, Scenario 3's approved swap. Dana's `DISCOVERED` row
   (2026-10-24) sits inside this window, matching the existing fixture exactly.
3. **UPCOMING, Oct 30 – Nov 30.** Scenario 4's open consent request, Scenario 6's school closure
   with partial confirmation, Scenario 5's Thanksgiving arrangement, Scenario 3's **second, still-
   unapproved** swap request (the deliberate unresolved case), and at least one coverage need left
   genuinely unconfirmed at seed-reset time.

**Provenance, every record:** `village_event.occurred_at` vs `recorded_at` (already two columns,
`0007_village_event.sql:11-12`) distinguishes in-story time from seed-generation time; `actor_id`,
`subject_id`, `scenario_id` are already columns on that same table — **no new provenance mechanism
needed**, only populating what already exists. `source` is already constrained to `('LIVE',
'SYNTHETIC_SCENARIO')` (`0007_village_event.sql:16`) — simulated Rosina actions get
`SYNTHETIC_SCENARIO` plus a `payload.simulatedBy: 'rosina'` marker, kept distinguishable from real
app actions per the task's instruction.

**Deliberately unresolved, shown honestly:** Scenario 4 (pending consent), Scenario 3's second
swap (pending approval), Scenario 6 (one caregiver unconfirmed) — none of these get a fabricated
resolution; the UI renders "pending" as pending.

**No rankings from history:** nothing in the seed generator may read past `CandidateEvaluation`/
`orbit_responses` rows to bias a *current* availability or ranking computation — the task's
explicit rule, and already consistent with how `_rank_and_advance` works today (it only ever reads
the live job's own rows, never historical ones).

**Determinism and reset:** reuses the existing `createSeed()`/`db:reset` mechanism
(`data-model.md` §6) — stable ids, re-running `db:reset` restores exactly, and the existing
evidence fixtures (the 28-table/157-row checksum baseline) are **untouched**; v2 seed data is
additive rows outside that checksum's table set or added as a second, separately-checksummed
baseline — to be decided with whoever implements the generator, not fixed here.

---

## Open questions for Bryan

1. **A second cross-subgraph write** (`school` → `schedule`, Area E's `fileSchoolReport` creating a
   `PROPOSED` `Event`). `data-model.md` §2 requires this be a recorded decision, not a silent
   second helper. **Recommendation:** approve one narrow helper, `createProposedEventFromReport`,
   called only from `fileSchoolReport`, never generalized into a third caller without coming back
   here.
2. **Scenario 6's coordination type.** The task names only `PICKUP`/`CONSENT`/`ORBIT_ALERT`, but a
   school-closure coverage need doesn't fit any of the three. **Recommendation:** add a fourth
   `CoordinationType: SUPERVISION`, reusing pickup's exact state machine and `supervision
   Candidates`'s existing ranking — the marginal cost is one enum value and one constraint update,
   not a new engine.
3. **`events.propose` vs. just `schedule.read`.** This contract makes proposing an event a narrower
   grant than reading the calendar. **Recommendation:** keep them separate — reading a calendar
   should never imply the right to add to it — but confirm no existing workflow assumed the two
   were the same.
4. **`school.write` as a new scope vs. promoting `school.report` from a capability to a grant.**
   This contract keeps `capabilities.school.report` as "offers to," unchanged, and adds a
   genuinely new grant `school.write` as the actual permission. **Recommendation:** keep the two
   separate, per the existing "capability ≠ permission" rule (`village.graphql:93-96`), but this
   does mean seeding a new grant for Angela and Carol, not just reusing their capability row.
5. **Orbit audience sees no location at all, by default.** The task flags this as its own top risk
   (custody/DV misuse) and explicitly asks that it be surfaced as an open question rather than
   decided unilaterally. **Recommendation: keep "no location to the audience, ever" as the
   default**, with only the activating/parent view seeing the last check-in. This is the one
   decision in this contract Bryan should personally confirm or override before any Orbit code is
   written.
6. **`orbit_notify_eligible` policy granularity.** Is eligibility per-child (today's proposal) or
   per-child-per-household (so a non-custodial household could have a narrower Orbit audience than
   the custodial one)? **Recommendation:** per-child for v1 (simpler, matches how
   `ride_cost_cap_usd` is already per-household-of-the-child, not per-person), revisit if a real
   scenario needs finer granularity.
7. **Seed baseline checksum strategy** (§SEED, "determinism and reset"). Whether v2 story/upcoming
   data joins the existing 28-table checksum or gets its own. **Recommendation:** its own —
   changing the existing baseline's shape risks every current evidence file's checksum assertion;
   a second, additive checksum keeps both provable independently.
8. **`HolidayArrangement.dateStart`/`dateEnd` as dates vs. a child-specific holiday calendar.**
   This contract hardcodes nothing about which calendar dates are "Thanksgiving" — it's just a
   named range a parent sets. **Recommendation:** confirm that's sufficient for the demo (no need
   for a shared holiday-calendar lookup table) versus a future "same holiday, every year"
   convenience.

---

## Implementation order

Dependencies first, so nothing is built before what it needs:

| # | Migration | Area | Depends on | Why this order | Rough estimate |
| --- | --- | --- | --- | --- | --- |
| 1 | `0021_events_status_participants.sql` | A — Events | nothing new | Rosina's calendar answers (Scenarios 5, 6) and the seed generator both need `Event.status`/`category` to exist first | 1 day (migration + resolvers) |
| 2 | `0024_care_facts.sql` | D — Care info | nothing new | Scenarios 1, 2 need it; no dependency on anything else in this list | 0.5 day |
| 3 | seed generator (code, not a migration) | SEED | #1, #2 | "care info + events + seed first" — the task's own stated order; the generator can't run until the tables it populates exist | 1–1.5 days |
| 4 | `0022_holiday_arrangements.sql` | B — Holidays | #1 (shares the `Event`/precedence concepts) | Scenario 3, 5 need the precedence rule; riskier than A/D because of the overlap-detection logic | 1 day |
| 5 | `0025_school_reports_and_tasks.sql` | E — School | #1 (for the optional `PROPOSED` event write) | Scenario 7; can run in parallel with #4 if staffed separately | 0.5 day |
| 6 | `0023_consent_requirements.sql` | C — Consent | #1 (`Event`/`HolidayArrangement` as consentable subjects) | task's stated order: consent after care/events/seed | 1.5 days |
| 7 | `0026_consent_coordination_type.sql`, `0027_orbit_alert.sql` | F — Coordination (Consent, Orbit) | #6 (Consent wraps `ConsentRequirement`); Orbit is independent of Consent but depends on #1/#2 for a realistic Scenario 8 | task's stated order: Orbit last, and the riskiest piece (Open Question 5) | 1.5 days (Consent wiring) + 2 days (Orbit) |
| 8 | Ask Rosina action-catalog wiring | G | all of the above, plus Codex's `ask-rosina.md` | frontend/action-layer work, not schema; cannot be estimated confidently until `ask-rosina.md` lands | TBD |

**Sunday is the target, not a promise.** If time runs short, cut in this order (last cut first):
**Orbit (#7's second half)** first — it is the newest concept, has the highest-stakes open question
(5), and Scenario 8 is the only scenario that needs it. Next, **Consent's full generality** —
ship `PermissionSlip`-only (no `ConsentRequirement`) if needed, accepting that Scenario 4 shows a
simpler single-approver flow instead of the general frozen-approver-list mechanism. **Do not cut**
Events, Care info, the seed generator, or the Holiday precedence rule — Scenarios 1, 2, 3, 5, 6, 7
all route through them, and the task is explicit that these three power "Rosina's answers" and come
first for a reason.

---

## Summary for Bryan (one screen)

- **Nothing here changes any existing table, column, or behavior that pickup depends on.** Every
  addition is a new column with a safe default, a new table, or an additive constraint widening —
  the acceptance check on every migration above is "pickup's 32-case evidence suite is unaffected."
- **Biggest finding:** `village_event` (migration `0007`) already is the history/provenance table
  the seed plan needs — built, RLS'd, empty on purpose, just never exposed to GraphQL. This saves a
  whole new mechanism.
- **Biggest judgment call:** keeping `Approval` as the one decision ledger and adding
  `ConsentRequirement` only for the "open request" half, instead of a generic `ConsentRequest` type
  — argued in Area C, open to challenge.
- **Biggest open risk, flagged deliberately:** Orbit sharing **no location at all** with the
  notified audience (Open Question 5) — the task asked that this be surfaced, not decided
  unilaterally, and this contract does exactly that.
- **One naming gap:** Scenario 6 (school-closure coverage) doesn't fit `PICKUP`/`CONSENT`/
  `ORBIT_ALERT` as named — recommend a fourth `SUPERVISION` type reusing pickup's existing machine
  (Open Question 2).
- **Order, if Sunday slips:** Orbit cuts first, then Consent's generality — Events, Care info, and
  the seed generator are the floor, not negotiable, because three of eight scenarios and the whole
  seed plan depend on them.
