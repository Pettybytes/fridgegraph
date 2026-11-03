# Contract — 30-day demo pickup-coordination history (v1, PROPOSED)

Status: **PROPOSED.** Drafted directly from the confirmed fields and limitations in
`docs/contracts/village-pulse-data.md` (that contract authorizes no schema/resolver/migration/
reset/outreach change by itself — this one is the backend/seed PR it names). **Published now,
without waiting on Bentley** — he builds the audio side against this and may comment; nothing here
is final until he's reviewed it, but publishing unblocks his work instead of gating it. Migration
number reserved: `0084` (next free after `0083`, confirmed against `main` and every open PR before
reserving). Nothing applied live. Staged branch `feat/demo-history`; draft PR; never merged.

Companion machine-readable schema: `docs/contracts/demo-history.schema.json` (JSON Schema,
`$id` versioned `v1`) — the exact shape of every story/event/response/voice-note payload below.

## 1. What a "story" is

No new "story" table. A **story** is one `coordination_jobs` row (`type = 'PICKUP'`) plus
everything that references it — `attempts`, `candidate_evaluations` (the response record),
`confirmations`, and now `voice_notes` (§5) — read through the existing `jobTimeline(jobId)`
query. `storyId = coordination_jobs.id`. This mirrors §1 of `docs/contracts/fridge-notes.md`'s own
"don't invent a parallel bookkeeping table for something that's already a view over existing rows"
reasoning.

## 2. Dataset shape

- **Child:** `p_nora`, parent `p_mom` (Kendra) — same framing as `village-pulse-data.md` §"Display
  window and units". Caregivers are drawn ONLY from people who already hold a real grant for Nora
  in the existing seed (`src/fixtures.ts`): `p_gma` (Loretta), `p_tasha`, `p_priya`, `p_walter`,
  `p_gloria`. No new person is invented for this dataset.
- **Documented anchor:** `D = 2026-11-02` (America/Detroit), a FIXED calendar date, not "today" at
  seed/reset time. A versioned dataset needs a stable anchor — computing offsets from a floating
  "now" would make "the same v1 dataset" render differently depending on when a demo happens to
  run, and would silently drift the DST-boundary case (§4) off the date it is meant to sit on.
  Revisit the anchor (as a new dataset version, §7) if the demo's live "today" drifts far enough
  past `D+29` that the history reads as stale — not a problem this contract tries to solve.
- **~20 stories**, `D-29` through `D-1`, **irregular spacing** — several days carry 2–3 stories,
  most days carry zero, never one-per-day. The exact day/story map ships with the seed PR, not
  guessed here; this contract fixes the vocabulary and IDs, not the literal calendar.
- **Mix of outcomes**, matching `village-pulse-data.md`'s own suggested plan table exactly in kind
  (pending / discovering / both-timed-out / awaiting-approval-with-a-real-response /
  approved-with-completion-unknown / declined-with-further-coordination /
  in-progress-no-reply-yet / explicit-refusal-or-cancellation): accepted offers, declines,
  timeouts, cancellations, pending approvals, resolved (confirmed) coordination.
- **Several complete voice-to-resolution stories** (§5): a caregiver's recorded voice response,
  linked to its own `candidate_evaluations` row, carried through to a parent decision.
- **No invented pickup completion.** The current schema has no column or event representing "the
  child was physically picked up" distinct from "a candidate was confirmed" — `confirmations`
  records the latter, not the former (`village-pulse-data.md`'s own D-17 row: "Parent approval
  recorded; pickup completion unknown"). This dataset never claims completion for any story. Adding
  a genuine completion concept is explicitly out of scope for this PR.

## 3. Event types — `jobTimeline(jobId)`, existing + two new

**Existing, unchanged:** `JOB_CREATED`, `ATTEMPT_OPENED`, `ATTEMPT_CLOSED` (`detail` carries the
existing `attempts.closed_reason` vocabulary — `TIMEOUT`, `NO_ANSWER`, or a handful of other
system-closure reasons; never implies a response), `COST_CALCULATED`, `CONFIRMATION` (already
means "parent approved AND a candidate was confirmed" — `confirmations.received_at`).

**New — closing two real gaps found while designing this dataset, not hypothetical:**

- **`RESPONSE_RECORDED`** — a caregiver's own, real decision: `candidate_evaluations.responded_at`
  (new column, §4) paired with `response_kind` (new column, `'ACCEPTED' | 'DECLINED'`). Distinct
  from `ATTEMPT_CLOSED` on purpose: an attempt can close (timeout, no-answer) with **no** human
  response ever recorded; a `RESPONSE_RECORDED` event only exists when one did.
- **`JOB_DECLINED`** — today, `approve_pickup`'s `DECLINED` branch sets
  `coordination_jobs.status = 'failed'` and `failure_reason`, but writes **no timestamp anywhere**
  for that decision — there is currently no way to show "a parent explicitly declined this, and
  when" as a timestamped event at all. New column `coordination_jobs.decided_at` (§4), set only on
  that branch, surfaces it.

Both are additive to the `TimelineEntry` shape (`at`, `kind`, `attemptId`, `candidate`, `detail`)
already documented in `docs/handoff/HANDOFF.md`'s `jobTimeline` row — no field removed, no
existing kind's meaning changed.

## 4. IDs, new columns, `recordedAt` rules

| Concept | ID / column | Rule |
| --- | --- | --- |
| Story | `coordination_jobs.id` | Stable, existing. Pattern for this dataset: `job_hist_NN`. |
| Attempt/contact instant | `attempts.id` / `attempts.at` | Existing, unchanged. |
| Actual caregiver response | `candidate_evaluations.id` / **`responded_at`** (new) | Set ONLY by a real human answering (`accept_pickup`, both its normal and late-reply branches) — never by cost calculation or any other system write, which is exactly why `updated_at` (touched by both) was not reused for this. `NULL` whenever no human has answered yet, including every `TIMEOUT`/`NO_ANSWER` closure. |
| Response kind | **`candidate_evaluations.response_kind`** (new) | `'ACCEPTED' \| 'DECLINED'`, set in the same statement as `responded_at`. `NULL` iff `responded_at` is `NULL` — enforced by both always being set together, never one without the other. |
| Parent decision (approve) | `confirmations.id` / `received_at` | Existing, unchanged — already a real, distinct instant. |
| Parent decision (decline/cancel) | **`coordination_jobs.decided_at`** (new) | Set only by `approve_pickup`'s `DECLINED` branch. `failure_reason` (existing) carries the reason text. |
| Explicitly recorded completion | — | Not represented. See §2. |
| Voice note | `voice_notes.id` | New table, §5. `response_id` (FK to `candidate_evaluations.id`) is the same link `CandidateEvaluation.voiceNoteId` exposes from the other side (`VoiceNote.responseId`, GraphQL). `status` is `PENDING` until the real audio/transcript/duration/hash are delivered — see §6. |

All instants are `timestamptz` (UTC canonical in storage); display conversion to America/Detroit is
the reading client's job, same as every other time field in this schema (`local_today()`,
`shared_statuses.expires_at`, etc.) — this contract stores and returns UTC, never a pre-converted
local string.

## 5. Response-time contract (for a future `Village pulse v2` / Activity read)

- **Match:** a response's own `attempts_job_candidate_uq` pair (`job_id`, `candidate_id` —
  already a unique index, 0013) deterministically identifies the ONE attempt a given
  `candidate_evaluations` response belongs to. No new linking column needed.
- **Duration:** `responded_at − attempts.at`. Labeled **"time from recorded attempt to response"**
  — dispatch delivery itself is not verified (no read-receipt exists anywhere in this schema), so
  the label never claims to measure delivery, only the recorded interval between the two instants
  this schema actually has.
- **Sample exclusion:** a `TIMEOUT`/`NO_ANSWER` closure has no `responded_at` and is excluded from
  duration samples by construction (there is no instant to exclude at the query layer — it is
  simply absent). A genuine `DECLINED` response **is** included — it is a real, timed response.
- **UTC → Detroit:** elapsed time is computed from the two UTC instants; only the eventual display
  converts to America/Detroit. `D-1 = 2026-11-01` is deliberately **the fall-back DST boundary
  itself** (Detroit's clocks repeat 01:00–02:00 local that morning) — not a coincidence of the
  anchor choice (§2). That story's attempt/response pair straddles the ambiguous local hour, with
  both instants recorded as unambiguous UTC, so any future elapsed-time computation is exercised
  across exactly the case that breaks naive local-time subtraction.
- **Disclosure:** any future aggregate read (a "typical response time" figure) must disclose its
  own sample size (`N` = count of stories with a non-null `responded_at` in the window) alongside
  the figure — this contract does not define that aggregate query, only requires that whoever adds
  one states `N`, matching `village-pulse-data.md`'s own instruction.
- **No caregiver rankings:** nothing in this dataset or schema precomputes a per-caregiver average,
  leaderboard, or comparison — only raw, per-story `attempts.at`/`candidate_evaluations.responded_at`
  pairs exist. Anyone wanting an aggregate computes it themselves, per-story, every time; no
  materialized ranking artifact is ever added here.

## 6. Voice notes — private playback

**New table**, owned by `coordination` (same subgraph that already owns
`coordination_jobs`/`attempts`/`candidate_evaluations`/`confirmations`):

```sql
create table voice_notes (
  id                text primary key,
  response_id       text not null references candidate_evaluations(id) on delete cascade,
  speaker_person_id text not null references people(id),
  status            text not null default 'PENDING' check (status in ('PENDING', 'READY')),
  proposed_script   text,
  transcript        text,
  duration_seconds  numeric(6,2),
  -- Coarse, turn-level only — [{speaker, startSec, endSec}, ...]. NEVER word-level: nothing in
  -- this pipeline measures individual word timing, so nothing is invented to fill that shape.
  turn_timings      jsonb,
  -- The MP3 PLAYBACK asset (what the HTTP endpoint serves) — content_type travels with it so the
  -- endpoint never hardcodes a format.
  storage_path      text,
  sha256            text,
  content_type      text,
  -- Real, present-day pipeline instants — distinct from this response's own FICTIONAL
  -- responded_at (candidate_evaluations). Never confused with "when the story happened."
  generated_at      timestamptz,
  transcribed_at    timestamptz,
  -- The separate WAV actually fed to Muse ASR — provenance only. Never served over HTTP, never a
  -- GraphQL field (same "no provider plumbing to any client" rule as the rest of this table).
  muse_storage_path text,
  muse_sha256       text,
  created_at        timestamptz not null default now()
  -- status = 'READY' requires proposed_script/transcript/duration_seconds/storage_path/sha256/
  -- content_type/generated_at/transcribed_at/muse_storage_path/muse_sha256 ALL non-null —
  -- enforced by a CHECK constraint, not by convention.
);
```

**PENDING vs. READY — delivered assets are never fabricated.** A voice note starts `status =
'PENDING'`: every delivered column above is `NULL` until the real audio file, its Muse-generated
transcript, its measured duration, and its real hashes exist. `proposed_script` carries the
authored TTS input text — a PERMANENT, separate column from `transcript` (the ASR-verified output)
for BOTH statuses: a script is never read back as a transcript, and a transcript is never replaced
by its script (same rule `data/demo-voice/README.md` states). `voice_note_access` (below) refuses
playback for a PENDING note the exact same way it refuses an unauthorized caller — a judge can
never tell "not yet delivered" from "not authorized" or "doesn't exist." **A placeholder hash
(`'0'.repeat(64)`) is never written and never presented as a completed asset** — the column is
`NULL`, not a fake value, until the real bytes exist.

**Reconciled with #167 (merged).** All three of this dataset's complete-voice-to-resolution
stories — `vn_hist_08_1` (Priya), `vn_hist_09_1` (Loretta), `vn_hist_12_1` (Gloria) — are now
`READY`, reconciled byte-for-byte from `data/demo-voice/manifest.json` (transcript, measured
duration, real MP3 path/hash, real WAV path/hash, real `generatedAt`/`transcribedAt`). The Muse
transcripts are stored **verbatim**, including their own recognition errors (`4.20`, a duplicated
"few few"/"half half", a trailing-comma artifact) — never cleaned up, never regenerated.
`confirmations.received_at` for these three stories was re-timed so the parent's approval always
**precedes** any pickup time/arrival the delivered transcript actually commits to — e.g.
`job_hist_08`'s confirmation sits at 4:15 PM EDT, between Priya's 4:08 PM response and the 4:20 PM
pickup she states; a parent cannot be shown approving something after the caregiver has already
committed to it. Where a transcript states only an AVAILABILITY window rather than a committed
pickup instant (`job_hist_12`: "free at half past two"), no single clock time is treated as "the
pickup" — this schema still has no pickup-completion concept (§2).

- **One concrete FK, not a polymorphic `subject_type`/`subject_id`** — every voice note in this
  dataset answers exactly one `candidate_evaluations` response, and `on delete cascade` through
  that FK (which itself cascades from `coordination_jobs`) means a voice note needs **no own
  `sandbox` column and no reset-code entry at all** — it disappears automatically when its parent
  job does. A polymorphic shape (e.g. to someday attach a voice note to a school report) is
  explicitly deferred — building it now for a need this PR does not have would be exactly the kind
  of premature abstraction this codebase's own conventions warn against. Extend with a real
  migration when a second subject type is actually needed.
- **Inherits its response's visibility, plus the speaker hears their own.** `voice_notes_read`:
  `is_parent_of` the story's child (same boundary `candidate_evaluations_read` already enforces),
  **or** `speaker_person_id = current_person()` — the caregiver who recorded it can always hear
  their own note back, the same "author always sees their own" shape `fridge_notes_read` already
  established. **Restricted Orbit audiences:** this dataset has no Orbit-linked voice note — the
  schema is a plain FK to `candidate_evaluations`, so there is nothing today that WOULD narrow to
  an Orbit recipient list. If a voice note is ever attached to an Orbit response in a later PR, it
  must inherit Orbit's own stricter, caller-scoped RLS, never this table's broader one — recorded
  here as a constraint on that future work, not something this PR builds or tests.
- **No public bucket, no durable signed URL.** Audio bytes live in local, demo-only storage
  (mirrors `ORBIT_PHOTO_DIR`'s existing pattern exactly — `src/demo/server.ts`), never served by
  path directly. Playback is `GET /api/demo/voice-note/:voiceNoteId`:
  - `Cache-Control: no-store` on every response, including refusals.
  - A real bearer, verified, required.
  - **`voice_note_access(voiceNoteId)`** (new `SECURITY DEFINER` RPC, mirrors `orbit_photo_access`
    exactly) re-checks live authority on **every single request** — nothing is cached, nothing
    trusted from a prior check. **PENDING is refused the same way an unauthorized caller is** — a
    note with no delivered audio yet is never played, and that refusal is indistinguishable from
    "not authorized" or "doesn't exist."
  - **No signed URL at all, by design** — the endpoint itself re-checking authority per request
    already satisfies "no permanent public URL" without the added complexity of minting,
    expiring, and validating a separate token; this is the same choice Orbit's photo endpoint
    already made, and this PR does not diverge from it.
  - 404 for both "no such voice note" and "no access" — same no-oracle shape as the photo
    endpoint and as `fridge_notes`'s own RLS-driven zero-row reads.
- **Transcript, duration, and turn timings are a separate GraphQL read** (`voiceNote(id)` query,
  or inline on the `RESPONSE_RECORDED` timeline moment — the seed PR picks one, documented there),
  never bundled into the binary HTTP response. The two reads share only the `voiceNoteId`.
- **Never returned to any client:** a synthesis script, prompt, or provider-accounting field (cost,
  job id, model name). None of that exists on this table's public shape; none of it is a field any
  resolver this PR adds will ever select.
- **Three kinds of proof, kept separate, none standing in for another:**
  1. **SQL authorization** — real disposable Postgres, same methodology as every other proof this
     session: parent reads, the speaker hears their own note, an unrelated caregiver/other family/
     stranger is refused, a forged `response_id`/`speaker_person_id` is refused on insert, and a
     PENDING note is refused regardless of who asks.
  2. **HTTP playback** — the endpoint's own request/response behavior (bearer required, `no-store`
     header present, 404-for-both, reauthorization on a subsequent request, the RPC genuinely
     gating the file read) proven over a **real loopback HTTP server** (real `express()` +
     `http.createServer()`, real `fetch()`, injected auth/RPC/file dependencies —
     `src/demo/voiceNoteEndpoint.test.ts`), explicitly labeled as the SEPARATE check it is. **A
     disposable-Postgres SQL proof alone does not and cannot prove HTTP/signed-URL behavior** —
     stated here so the seed PR's proof section cannot quietly substitute one for the other.
  3. **GraphQL read contract** — real `graphql` execution (`buildSubgraphSchema` + `graphql()`,
     the same construction `src/server.ts` uses to serve this subgraph, not a direct resolver call
     and not a check against raw SQL columns) against this document's own JSON Schema shape,
     including a non-empty `turnTimings` case
     (`src/subgraphs/coordination.voiceNoteContract.test.ts`). This is a resolver/schema proof, not
     an RLS proof — it stands in front of (1), never in place of it.

## 7. Reset + outreach

- `coordination_jobs`/`attempts` for this dataset join the **existing**
  `createSimulatedCoordination()` fixture arrays (same mechanism already restoring `job_emma_nov05`
  etc. today) — no new reset-mechanism code, only more rows in the same place.
- `candidate_evaluations`/`confirmations`/`voice_notes` are **new** to `reset.ts` — they join
  `ID_TABLES` (restored by their own known ids, upserted after their parents) exactly like
  `goals` now correctly does after its own provenance correction (`fix/0083-goals-provenance`):
  cascade-cleared automatically when their parent `coordination_jobs` row is blanket-cleared
  (§6), then explicitly upserted back to their canonical v1 shape on restore. No new `sandbox`
  column needed on any of the three — cascade already scopes their cleanup correctly, and
  `ID_TABLES`'s own known-id restore needs no `sandbox` column to work.
- **Canonical reset restores the versioned v1 history exactly** — every seeded story reverts to
  its documented shape (title/status/timestamps/response/voice-note content), not just "some
  content exists." A genuinely unrelated `coordination_jobs` row (a different, non-dataset job a
  judge creates live, or that already exists — same class of concern the goals provenance fix just
  addressed) is scoped out of this dataset's own restore list entirely: restore only ever touches
  the ~20 known `job_hist_NN` ids, never a blanket "every pickup job for Nora."
- **Seed insertion triggers nothing.** Every row in this dataset is inserted directly (SQL upsert
  or the real `resetDemo()` transaction), never through `request_pickup`/`accept_pickup`/
  `approve_pickup`'s own RPC call paths — those are the ONLY paths that could ever reach an SMS/
  call/webhook dispatch or an Orbit emergency notification, and this dataset never calls them.
  Attempts' `destination_mode` is always `TEST_RESPONDER`, matching every other seeded attempt in
  this codebase; nothing in this dataset is ever `REAL_CONSENTED`.

## 8. Deploy ordering

Same shape as `docs/contracts/fridge-notes.md` §4, for the same reason: `jobTimeline`'s resolver
will unconditionally reference the new `responded_at`/`response_kind`/`decided_at` columns and the
new `voice_notes` table once this code ships. **Migration `0084` must be applied before this PR's
code is deployed**, not after.

## 9. What this PR does NOT do

- No live application anywhere; no real audio synthesis, no provider call, no cost.
- No completion concept (§2). No coverage/care-requirement linkage (`village-pulse-data.md` marks
  that "if desired later" — not built here).
- No Orbit-linked voice note (§6) — architecturally un-blocked, not populated or tested.
- No change to the web Activity/Village-pulse UI — this is the backend/seed contract those surfaces
  build against next.
- No `docs/handoff/HANDOFF.md` edit.
