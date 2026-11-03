# Contract — Fridge backend, Phase 2 (goals CRUD + fridge notes)

Status: **STAGED, NOT APPLIED.** `feat/fridge-notes` (#157) merged the code and the staged
migration file `0083_fridge_phase2.sql` into `main` — the file itself has **never been applied to
any database**, shared or disposable. A correction after that merge (`fix/0083-goals-provenance`,
this branch) fixed a real `goals.sandbox` provenance bug found in review before any live apply —
see §3. The migration's content hash changed as a result; §3 and the PR record the new one. Every
proof in this contract still runs exclusively on a disposable, loopback-bound Postgres container
this session creates and removes.

Relationship to `#153` (`feat/fridge-experience`, draft, web-only): that PR builds **The Fridge**
UI — a photographic collage with a **read-only** goals whiteboard and mock/visual-only paper notes
for care/Orbit feedback. It explicitly states "No completion/edit actions or invented time
buckets" for goals, and that its goals read stays exactly `goals(childId) { title horizon status
}` — nothing this contract adds is consumed by `#153` today. **Layout/position storage is
browser-local, per-person, geometry-only** (`#153`'s own words) — this backend never stores,
reads, or implies shared note positioning. This contract does not modify any `#153` file.

Owner: `village` subgraph (port 4001) — same owner as the existing `goals`/`care_plans` tables,
for the same reason: parent-authored, child-scoped content, no cross-table atomicity need. A new
subgraph process was considered and rejected for this first slice — it would touch `main.ts`,
every router config, the alt-stack, and `.apollo/mcp.local.yaml`, none of which this feature
needs. Revisit only if fridge notes grow a genuine need for isolation (its own port/process).

## 1. Goals — CRUD, completion separate from approval, optional period

**Preserved exactly, unchanged:** `goals_read` RLS (`0003_rls.sql`) — a parent/guardian sees every
goal for their child; a grant holder with `goals.read` sees `APPROVED` goals only. A `PROPOSED`
goal is for parents. This contract does not touch that policy.

**New columns** (`goals`, additive):

| Column | Type | Meaning |
| --- | --- | --- |
| `period` | `text`, nullable, `check (period in ('DAY','WEEK','MONTH'))` | An **optional**, explicitly-chosen cadence. Never inferred from `horizon`. |
| `completed_at` | `timestamptz`, nullable | Set only by an explicit `completeGoal`/`uncompleteGoal` call. **Independent of `status`** — an `APPROVED` goal can be completed or not; a `PROPOSED` goal can even carry a stale `completed_at` from before it was re-proposed (the UI's job to render sensibly, not this layer's to prevent — re-proposing is out of scope here since there is no re-propose flow yet). |
| `sandbox` | `boolean`, default `false` | Demo-content provenance — **not exposed on the `Goal` GraphQL type**, purely reset bookkeeping. **Default is `false`, deliberately** — unlike `fridge_notes` (a brand-new table, safe to default `true`), `goals` already has rows at apply time, so a `true` default would retroactively mark every pre-existing goal as demo-clearable. The two canonical demo goals are marked `true` by 0083's own targeted `UPDATE ... WHERE id IN (...)`; `createGoal`'s resolver asserts `true` explicitly on every insert it makes. See §3 for the full correction history (two review rounds, not one). |

`horizon` (existing, free text) is untouched — `period` is additive, not a replacement. A goal may
have a `horizon` of `"June 2027"` and no `period`, or a `period` of `MONTH` and no `horizon`, or
both, or neither.

**New mutations** (`village` subgraph), all parent/guardian-only via the existing
`goals_parent_write` RLS policy (`is_parent_of(child_id)`, unchanged):

```graphql
enum GoalPeriod { DAY WEEK MONTH }
enum GoalStatus { PROPOSED APPROVED }

createGoal(childId: ID!, title: String!, ownerId: ID, horizon: String, period: GoalPeriod, status: GoalStatus): Goal!
updateGoal(id: ID!, title: String, ownerId: ID, horizon: String, period: GoalPeriod, status: GoalStatus): Goal!
completeGoal(id: ID!): Goal!
uncompleteGoal(id: ID!): Goal!
deleteGoal(id: ID!): Boolean!
```

`updateGoal` never accepts `childId` or `proposedById` — reassignment is structurally impossible
through this surface. A `BEFORE UPDATE` trigger (`_goals_guard`) enforces the same thing at the
database level regardless of transport: `child_id` and `proposed_by_id` can never change on an
existing row, full stop. This is a deliberate strengthening beyond what was explicitly asked for
goals (the explicit "prevent reassignment" requirement was stated for notes) — added for
consistency with notes' DB-enforced guarantee and because it costs nothing and closes an
otherwise-real gap (today's `goals_parent_write` policy is `for all` with no column-level limit).

`createGoal`/`updateGoal` derive `proposedById` from `current_person()` always — never a client
argument. `ownerId` stays a free nullable input (the existing seed shows it can be a parent, `null`,
or conceptually the child — there is no single correct default, so this layer does not guess one).

`completeGoal`/`uncompleteGoal` only ever touch `completed_at`; they never touch `status`.

## 2. Fridge notes — new table, first slice

**Scope of the first slice:** parent/guardian posting, with explicit sharing. Caregiver posting is
designed and enforced in the database, but is not the default path and is not built into any
GraphQL review/propose UI in this PR — a parent must explicitly grant a `fridge.post` scope first
(via the existing `grantAccess` mutation, no new grant mechanism).

### Schema

```sql
create table fridge_notes (
  id             text primary key,
  child_id       text not null references children(person_id) on delete cascade,
  author_id      text not null references people(id),
  text           text not null check (char_length(text) <= 500 and char_length(btrim(text)) > 0),
  paper_color    text not null default 'yellow'
                 check (paper_color in ('yellow','pink','blue','green','white')),
  audience       text not null default 'PARENTS_ONLY'
                 check (audience in ('PARENTS_ONLY','SHARED')),
  attachment_ref text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  revision       int not null default 1,
  sandbox        boolean not null default true
);
```

- `text`: bounded (≤500 chars), never blank. 500 was chosen as "a paper note, not a tweet" — longer
  than `shared_statuses.text`'s 60-char live-status cap (a different content type: a line, not a
  note), short enough to stay a fridge-sized note. Open to revision; not load-bearing elsewhere.
- `paper_color`: a fixed, explicit allow-list (`yellow,pink,blue,green,white`). `#153`'s own mock
  fixture uses yellow/pink/blue/green sample papers; this set is a superset and a first guess, not
  confirmed against a design system — **coordinate with whoever builds the real posting UI before
  treating these five strings as final.**
- `audience`: `PARENTS_ONLY` (default) or `SHARED`. Exactly two values in this first slice — no
  per-person audience list. "Explicit sharing" means the author (or a parent, on anyone's note)
  must deliberately set `audience: SHARED`; nothing defaults to shared.
- `attachment_ref`: nullable `text`, **no foreign key, no new storage** — same shape as
  `orbit_alerts.photo_id` (migration `0032`): a plain reference to a photo/attachment that lives in
  whatever store already authorizes and serves it. **For Rosina's later intake contract:** when
  that flow exists, it is responsible for (a) writing a value here that resolves through its own
  authorized loader, exactly as `orbit_photo_access(photoId)` does for Orbit today, and (b)
  re-checking the caller's live authority on every fetch — never trusting that a readable
  `attachment_ref` today is still readable tomorrow. This migration does not define that loader; it
  only reserves the column so the intake contract has somewhere to put the reference without a
  follow-up migration.
- `revision`: bumped by the `_fridge_notes_guard` trigger (below) on every content-changing update.
  Exists so a future client can detect a concurrent edit (`revision` sent back doesn't match);
  this PR does not add that check to the resolver — **last-write-wins** is the actual behavior
  today, verified concurrent-safe (no row corruption, no lost delete) in the rehearsal proof, not
  claimed to be conflict-free.
- `sandbox`: defaults `true`. Every note created through the live demo app is demo content; the
  canonical reset clears all of it unconditionally (§4). There is no "real, permanent" fridge note
  in this environment — consistent with every other persona/content in this demo.

### RLS

```sql
-- read: a parent, the note's own author, or anyone the audience + an explicit fridge.read grant covers
create policy fridge_notes_read on fridge_notes for select to authenticated
  using (
    is_parent_of(child_id)
    or author_id = current_person()
    or (audience = 'SHARED' and has_scope(child_id, 'fridge.read'))
  );

-- insert: a parent, OR a caregiver holding an explicit fridge.post grant — household membership
-- alone (resident_adult, or any membership without a grant) implies nothing
create policy fridge_notes_insert on fridge_notes for insert to authenticated
  with check (
    author_id = current_person()
    and (is_parent_of(child_id) or has_scope(child_id, 'fridge.post'))
  );

-- update: a parent, or the note's own author — the trigger below narrows what each may change
create policy fridge_notes_update on fridge_notes for update to authenticated
  using (is_parent_of(child_id) or author_id = current_person())
  with check (is_parent_of(child_id) or author_id = current_person());

-- delete: parents only, explicitly — not "any author of any note"
create policy fridge_notes_delete on fridge_notes for delete to authenticated
  using (is_parent_of(child_id));
```

### `_fridge_notes_guard` (BEFORE UPDATE trigger — enforced regardless of transport)

1. `child_id` can never change. Always, for anyone.
2. `author_id` can never change. Always, for anyone.
3. If the caller is **not** a parent of the child (i.e. is editing their own note as a
   `fridge.post`-holding caregiver), `audience` cannot change at all — no widening, no narrowing,
   through this path. Only a parent may change a note's audience. This is the simplest rule that
   fully satisfies "prevent unauthorized audience widening": a non-parent author's edits can never
   touch the field at all, so there is no widening path to close case-by-case.
4. Any content change (`text`, `paper_color`, `attachment_ref`, or — for a parent — `audience`)
   bumps `revision` and sets `updated_at = now()`.

RLS policies decide **who may attempt** a write; this trigger decides **which columns the attempt
may actually change**, regardless of what the `UPDATE` statement names — RLS's `WITH CHECK` alone
cannot express "this column only if this role," which is why this needs its own trigger rather than
a cleverer policy.

### Scopes (new, `src/authz.ts`)

```ts
fridgeRead: 'fridge.read',
fridgePost: 'fridge.post',
```

Granted via the existing `grantAccess` mutation — no new grant mechanism. The demo guide is **not**
given a `fridge_notes` read policy in this first slice (deliberate; unlike `goals`, which got one
in a later migration, `0025`, after the base feature existed) — a guide is refused on fridge notes
entirely for now, verified in the rehearsal proof. Revisit if/when a guide-facing fridge view is
actually built.

### Mutations (`village` subgraph)

```graphql
enum PaperColor { YELLOW PINK BLUE GREEN WHITE }
enum FridgeNoteAudience { PARENTS_ONLY SHARED }

postFridgeNote(childId: ID!, text: String!, paperColor: PaperColor, audience: FridgeNoteAudience, attachmentRef: String): FridgeNote!
updateFridgeNote(id: ID!, text: String, paperColor: PaperColor, attachmentRef: String): FridgeNote!
setFridgeNoteAudience(id: ID!, audience: FridgeNoteAudience!): FridgeNote!
removeFridgeNote(id: ID!): Boolean!
```

`updateFridgeNote` never accepts `audience` — that is `setFridgeNoteAudience`'s own mutation,
deliberately separated so the resolver layer mirrors the trigger's own distinction (content edit
vs. audience change) instead of silently dropping an `audience` argument a non-parent caller
passed. `postFridgeNote` always derives `author_id` from `current_person()` — never a client
argument, satisfying "derive actor from `current_person()`" the same way the goals mutations do.
`removeFridgeNote` is parent-only (RLS `fridge_notes_delete`), matching "parents may remove notes
for their child" literally — not "the author may delete their own note," which was not asked for
and is not built.

## 3. Canonical reset integration (`src/demo/reset.ts`)

- `fridge_notes` joins `SANDBOX_TABLES` — every row is `sandbox = true` by default (§2), so reset's
  existing blanket `delete where sandbox is true` clears **all** fridge notes on every reset, same
  mechanism as `coordination_jobs`/`attempts`/`care_facts`.

- `goals` joins **both** `SANDBOX_TABLES` and `ID_TABLES`, the same two-step shape Cast v2 itself
  already uses for its own sandboxed content (`care_facts`/`routines`): cleared by the blanket
  `sandbox = true` delete, then the two canonical rows restored by upsert in `RESTORE_ORDER`,
  afterward.

  **Two review corrections, not one** — recorded in full because both are real, found-live bugs,
  not hypothetical:

  1. *First cut* put `goals` in `ID_TABLES` only (restore-by-known-id) — this left every OTHER
     goal, including anything a judge creates live through `createGoal`, permanently un-clearable:
     a real demo-pollution bug. Fixed by adding a `sandbox` column, same convention as
     `fridge_notes`.
  2. *Second cut*, same PR, before any live apply: that `sandbox` column was added as
     `not null default true`. **`goals` is an existing, already-populated table** (unlike
     `fridge_notes`, a brand-new one) — a `true` default on `ALTER TABLE ... ADD COLUMN`
     retroactively backfills every row that already exists at apply time, which would have marked
     any genuinely non-demo goal already in a real database as demo-clearable, deleting it on the
     very next reset. **Corrected:** the column defaults `false` (an unknown pre-existing row is
     never assumed to be demo content); the two verified canonical demo goals are marked `true` by
     0083's own targeted `UPDATE goals SET sandbox = true WHERE id IN ('goal_reading',
     'goal_passing')` — never a blanket default, never an id prefix, never "every goal belonging to
     a fixture child" (which would also catch a real, non-demo goal for the same child).
     `createGoal`'s resolver now asserts `sandbox: true` explicitly on every insert it makes,
     rather than relying on any column default (which is now `false`, specifically so it is never
     mistaken for "this is demo content" by omission).

  - Proven in `ops/fridge-phase2-reset-proof.mjs` with a two-phase migration apply specifically
    built to catch the second bug: every migration except `0083` first, an "unrelated, pre-existing"
    goal inserted into the table in its *pre-0083 shape* (simulating a real row already in a live
    database), **then** `0083` applied as its own phase. Checks 1–2 assert directly against the
    migration's own behavior (the pre-existing row is `sandbox = false`, the two canonical rows are
    `sandbox = true`) before any further write. Checks 3–6 then run the real `resetDemo()` and
    prove, by contrast, that the SAME pre-existing row survives the entire reset untouched while a
    freshly demo-created one (`sandbox: true`, exactly what `createGoal` asserts) is cleared —
    ownership is the column, tracked from before migration, through migration, through a real
    reset, never the child or the id.

- Both additions are scoped exactly as their own content: `fridge_notes` touches nothing outside
  its own sandboxed rows; `goals` touches nothing outside its own sandboxed rows and its two known
  fixture ids. Neither widens any existing `SANDBOX_TABLES`/`ID_TABLES` member's own boundary.

**Migration content hash, post-correction:** `0083_fridge_phase2.sql` sha256
`559b98238fe8ff06a2ced37115ccfc90c403ed37801ef834ab77d05fb24c6280` (was
`f5842893fe9403a086281f5509807337eef6b5f658bff6ca99d9bb8477f8d4dd` at `#157`'s merge — changed by
this correction, recorded here since the file was never applied and is therefore still safe to
edit in place, per the project's "never edit an applied migration" rule).

## 4. Deploy ordering — migration BEFORE code, not after

This migration must be applied **before** this PR's code is deployed — the reverse of the usual
additive-column safety order. `village.ts`'s `goals` query resolver unconditionally selects
`period, completed_at` (`GOAL_COLUMNS`); deploying the code first makes every `goals` read fail
with `column "period" does not exist` until `0083` lands. Recorded here explicitly so Bentley's
apply window does not default to the normal "ship code, migrate later" sequencing — this one is
migration-first.

## 5. What this PR does NOT do

- No live application anywhere. Migration `0083` is staged only, rehearsed exclusively on a
  disposable, loopback-bound Postgres container this session created and removed.
- No caregiver-posting UI, no attachment upload/storage, no guide-facing fridge view, no
  conflict-aware client (the `revision` column exists; nothing reads or compares it yet).
- No change to `#153`'s files, routes, or layout-geometry store.
- No `docs/handoff/HANDOFF.md` edit — per the current convention, this report and the rehearsal
  proof live in the PR description; HANDOFF gets a consolidated docs PR separately.
