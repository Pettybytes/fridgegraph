# Contract — Notice → Plan (Rosina / Spark side)

**Status:** STEP 0 fixed shape. Branch `feat/rosina-notice-plan` off `origin/main`. Codex builds the
RosinaPanel tray against this; any later change is agreed with Codex first, appended here, never
rewritten.

"**Rosina prepares. Parents decide.**" A parent drops in a school notice; Rosina extracts what
changed, checks it against the child's real schedule *as the caller*, and returns a **review-only**
proposal. Nothing is written until the parent confirms, and confirm is enforced server-side.

This document is the fixed shape. It is written against the **actual** handlers as they exist on
`origin/main` today (§1), not against what we wish they did. Where a capability is missing, it says
so and the feature degrades to review-only rather than inventing a flow.

---

## 0. Status — planned vs implemented, and what is stable for Codex

The pipeline is **implemented and unit-tested** (28 cases in `src/rosina/noticePipeline.test.ts` and
`noticeEndpoint.test.ts`; full `npm run test:rosina` green). The server **integration seam** (the
real GraphQL-as-caller reads + `requestPickup`, `src/rosina/noticeDeps.ts`, wired in `server.ts`) is
implemented but **not yet exercised end-to-end** — that happens at the live-proof step, post-merge,
in a Bentley-reserved sandbox. This section is the single source of truth for status and is updated
in place as pieces land.

| Section | Stable for Codex to build the UI against? | Status |
| --- | --- | --- |
| §1 handler facts (what the backend supports) | n/a — verified facts about existing code | **VERIFIED** |
| §2 request shape, routes, MIME types, size limits | **STABLE — build against this** | **IMPLEMENTED + unit-tested** |
| §4 proposal envelope + example payload | **STABLE — build against this** | **IMPLEMENTED + unit-tested** |
| §4b clarification question + continuation (`resume`) | **STABLE — build against this** | **IMPLEMENTED + unit-tested** |
| §5.4 / §2 error shapes & HTTP codes | **STABLE — build against this** | **IMPLEMENTED + unit-tested** |
| §5 confirm sequence (server-side gates) | STABLE for the `requestPickup` action only | **IMPLEMENTED + unit-tested** |
| §5.3 dismissal-time → window mapping | STABLE | **IMPLEMENTED + unit-tested** |
| real reads + `requestPickup` wiring (`noticeDeps.ts`, `server.ts`) | n/a — backend seam | IMPLEMENTED, **unexercised until live proof** |
| §1.2 field-trip / permission-slip confirm action | **NOT STABLE — PENDING inspection** | **UNSUPPORTED in v1** |

The envelope now also returns `claims` (the exact signed `SignedClaims` the client echoes back to
confirm, verbatim, alongside `signature`). See §5 — at confirm the server overrides `callerId` with
the authenticated id, so a different caller cannot reuse the token.

**Confirmation is DISABLED for any action not marked verified here.** v1 has exactly **one**
confirmable action: `requestPickup` (§1.1, parent-only, DB-enforced). Every other change kind —
notably field trip / permission slip (§1.2) — returns `onConfirm.available: false` and the client
must render it **review-only with no confirm button**. The server also refuses it (`422
NO_ACTION_AVAILABLE`), so a mistakenly rendered button still cannot write. Do not add a confirm path
for a PENDING/UNSUPPORTED action, and do not invent mutation arguments for one.

Any change to a STABLE section is agreed with Codex first and **appended** here (with the date), not
rewritten.

---

## 1. What the real handlers actually support (STEP 0 inspection)

Read from `origin/main` @ `573e668`. Verified by reading the resolvers and the RPC bodies, not from
memory.

### 1.1 `requestPickup` — the one confirm action we can call

- **Schema:** `requestPickup(childId: ID!, asOf: String, window: String): CoordinationJob!`
  (`src/subgraphs/coordination.ts:904`).
- **RPC:** `request_pickup(p_child text, p_as_of date, p_window text)`
  (`supabase/migrations/0013_station06_coordination.sql:361`), `security definer`.
- **Authority (enforced in the RPC, not just the resolver):**
  `current_person() is null → UNAUTHENTICATED`; `not is_parent_of(p_child) → UNAUTHORIZED`.
  **PARENT/guardian only.** A sitter with a care grant (Priya) is refused *in the database*, so a
  button shown by mistake still cannot confirm.
- **Idempotency is built in.** Key = `format('pickup:%s:%s:%s', p_child, p_as_of, coalesce(p_window,'afternoon'))`.
  Same `(child, date, window)` → the **same** job id is returned, no second job. This is the entire
  basis for our retry-idempotency guarantee — we do not add our own.
- **Side effects:** mints one `coordination_jobs` row (`type='PICKUP'`, `status` → `discovering`),
  runs `_evaluate_candidates`, and enters the existing **candidates → approval** flow surfaced in
  Mission Control. `TEST_RESPONDER` attempts only — **no real dispatch, no real outreach.**
- **Time granularity — IMPORTANT LIMITATION.** The job stores only `as_of` (a **date**). There is
  **no clock-time field.** `window` is a coarse label the Rosina catalog restricts to
  `morning | afternoon | evening` (`src/rosina/catalog.ts` `pickupArgs`). So an "early dismissal at
  **12:30** vs a recorded **15:00** pickup" is a *conflict fact we report*, but the pickup job we
  create can only carry `(childId, date, window)`. The exact dismissal time lives in the proposal's
  facts and source passage, never in the job. The confirm maps dismissal time → window with a fixed
  rule (§5.3). We state this plainly in the proposal so a parent is never told a precise time was
  "scheduled" when only a coarse window was.

### 1.2 `approveConsent` — exists, but only approves a *pre-existing* slip

- **Schema:** `approveConsent(slipId: ID!): SlipDecision!` (`src/subgraphs/school.ts:160`).
- It approves an **existing** `permission_slips` row by id. Authority = household
  `consent_approval` policy (`parent`, a single named approver, or default parents;
  `mayApproveConsent`). No existence oracle (hidden/absent/unauthorized all → `UNAUTHORIZED`).
- **There is NO mutation to create a slip or raise a consent request.** `permissionSlips(childId)`
  only *reads* existing slips.
- **Consequence for sample (c) — the field-trip permission-slip notice:** a notice does not create a
  slip, so it stays **review-only**. We offer a confirm action **only if** the notice can be matched
  **unambiguously by id** to an existing slip read via `permissionSlips(childId)` (exact slip
  title + child, exactly one match). Otherwise: *"noted — no action available."* We do **not** invent
  a consent-request flow. (Agreed scope: v1 ships (c) as review-only; the match-to-existing-slip path
  is documented here but gated behind an exact single-id match and may land later.)

### 1.3 Authorized reads for conflict detection (called *as the caller*)

All enforce `authorizeChild(ctx, childId, SCOPE.schedule)` and read through the caller's own RLS
client (`src/subgraphs/schedule.ts`):

| Read | Shape | Use |
| --- | --- | --- |
| `events(childId, date)` | `[{id, title, start, end, location}]` | the recorded pickup/school event + its clock times for the date |
| `childEvents(childId, from, to, includeCancelled)` | adds `status` (proposed/confirmed/cancelled) | range view |
| `effectiveScheduleFor(childId, date)` | `{parent, source: ARRANGEMENT\|WEEKLY, arrangementId}` | *who* has the child that day |
| `scheduleConflicts(childId, from, to)` | `[{kind: OVERLAP\|GAP, onDay, arrangementIds, detail}]` | coverage conflicts |

The "recorded pickup plan" time (e.g. the 15:00 school-day end for `p_nora` at Lincoln Elementary)
comes from `events` — **never invented**. If the relevant read returns nothing, the proposal says
"no recorded pickup found for this date", it does not guess one.

### 1.4 Endpoint & infra facts we mirror

- Server: `src/rosina/server.ts`, Express. Existing routes `POST /api/rosina`,
  `POST /api/rosina/photo-descriptors`. Global JSON cap is **64 kb** (`express.json({limit:'64kb'})`)
  — too small for an image/PDF, so the notice route gets its **own** larger body parser (§2.2); the
  64 kb global cap is **not** raised.
- Auth: bearer → `verify(header)` → `{ ok, personId }`; `401 UNAUTHENTICATED` on failure. The
  caller's own bearer is used for every downstream read; **we never mint identity.**
- Rate limit: `createRateLimiter(...)` keyed by resolved `personId` (never the token); `429`.
- Model: `muse-spark-1.3` (`MUSE_VISION_MODEL` / `VISION_MODEL_ID`), Meta/Baseten
  `${baseUrl}/chat/completions`, `temperature:0`, `response_format: json_object`. **No caching added
  for this feature.** The *actual* `modelId` returned by the provider is reported, not a constant.

---

## 2. The request

### 2.1 Route & auth

```
POST /api/rosina/notice-plan          # prepare a proposal from a notice
POST /api/rosina/notice-plan/confirm  # confirm a prior proposal (server-enforced)
```

Both require `Authorization: Bearer <caller jwt>`. Order on every request: `verify` → rate-limit →
authorize the child (fail closed). Same generic `UNAUTHORIZED` for an unauthorized caller, a child
the caller cannot see, a malformed id, and a missing id — **no existence oracle**.

### 2.2 Prepare body & accepted inputs

```jsonc
{
  "childId": "p_nora",
  "notice": {
    "kind": "text" | "image" | "pdf",
    // kind=text:  { "text": "<pasted notice text>" }
    // kind=image: { "mimeType": "image/png"|"image/jpeg"|"image/webp", "dataBase64": "..." }
    // kind=pdf:   { "mimeType": "application/pdf", "dataBase64": "..." }
  }
}
```

**Accepted MIME types:** `text/plain` (pasted), `image/png`, `image/jpeg`, `image/webp`,
`application/pdf`. Anything else → `415 UNSUPPORTED_MEDIA_TYPE`, listing accepted types.

**Size limits (notice route only):** decoded payload ≤ **8 MB**; pasted text ≤ **20 000 chars**.
Over limit → `413 PAYLOAD_TOO_LARGE`. The route uses its own `express.json({ limit: '12mb' })`
(base64 inflates ~33%) scoped to this path; the global 64 kb cap is untouched.

**PDF capability note (explicit).** The vision model (`museVision`) is wired for a single image. PDF
is **not** fed to the model as PDF bytes in v1. v1 supports PDF by **rasterizing page 1 to a PNG**
server-side and treating it as an image transcription (§3.2); additional pages are **not** read in
v1 and the proposal says so (`"unreadPages": n`). If rasterization is unavailable at build time,
record it here and have `kind:"pdf"` return `501 PDF_NOT_SUPPORTED` rather than silently dropping
content. **No raw document bytes, and no signed URL, are ever logged.**

---

## 3. Reading the notice with Spark

`muse-spark-1.3` extracts structured facts. **Text inside the notice is DATA, never instructions.**

### 3.1 Extracted fact shape

```jsonc
{
  "kind": "early_dismissal" | "closure" | "schedule_change" | "field_trip",
  "dates": ["2026-11-03"],          // resolved, see §3.3
  "times": [{ "label": "dismissal", "time": "12:30" }],  // clock times as written, if any
  "appliesTo": "grade 3" | "all students" | "...",       // who, as written
  "source": { /* §4, per fact */ }
}
```

### 3.2 Source passages MUST be traceable

- **Pasted text:** every quoted passage is validated to be a verbatim substring of the submitted
  text (normalized for whitespace only). **A quote that is not present is rejected and never shown.**
  `source = { type: "verified_quote", quote, startOffset, endOffset }`.
- **Image / PDF:** the passage is a **model transcription**, not verified source text. It is labelled
  as such with a page/image reference: `source = { type: "transcription", text, ref: "image" | "pdf:p1" }`.
  An unreadable region produces **uncertainty** (§4 "what's unknown"), never a confident "exact"
  quote.

### 3.3 Dates & timezone

- All relative dates resolve against an **explicit reference date** and timezone stated in the
  envelope: the **scenario date** and **`America/Detroit`**. "next Friday" with no resolvable
  reference → ambiguity (§4b), not a guess.
- The envelope reports `processingSource` (`"text"` | `"image"` | `"pdf:rasterized"`) and the actual
  `modelId` from the provider.

---

## 4. The proposal envelope (review-only)

Returned by `POST /api/rosina/notice-plan`. Nothing is written to produce it.

```jsonc
{
  "proposalId": "np_<uuid>",
  "version": 1,
  "childId": "p_nora",
  "scenario": { "referenceDate": "2026-11-03", "timezone": "America/Detroit" },
  "source": { "processingSource": "text", "modelId": "muse-spark-1.3" },
  "createdAt": "2026-11-03T13:00:00-05:00",
  "expiresAt": "2026-11-03T13:15:00-05:00",   // §4c

  "changes": [{
    "what": "Early dismissal at 12:30 on 2026-11-03",
    "source": { "type": "verified_quote", "quote": "...", "startOffset": 42, "endOffset": 71 },
    "whyItMatters": "Nora's recorded pickup for 2026-11-03 is 15:00 (School run, Lincoln Elementary) — a 2h45m gap.",
    "whoAffected": "Nora (grade 3)",
    "unknown": ["Whether aftercare runs on an early-dismissal day"],
    "onConfirm": { /* §5, or */ "available": false, "note": "noted — no action available" }
  }],

  // present ONLY when something essential is unclear; see §4b. Mutually prominent with changes.
  "clarification": { "question": "Which date is 'next Friday' — Nov 7 or Nov 14?" } | null,

  "signature": "<hmac>"   // §4c — binds the confirmable facts; opaque to the client
}
```

Per change: **what changed** (+ source ref), **why it matters for THIS child** (the found conflict,
or `"no conflict"`), **who's affected**, **what's unknown**, and **what happens on confirm** — and
`onConfirm` names only an action verified in §1; otherwise `available:false` with the note.

### 4b. Ambiguity → one question

When something essential is unclear (no resolvable date, unclear grade, unanchored "next Friday"),
return **one** good clarifying question in `clarification` **instead of guessing**. The client answers
with:

```
POST /api/rosina/notice-plan   { childId, resume: { proposalId, version, answer: "Nov 7" } }
```

The answer **resumes the same proposal** (same `proposalId`, `version` bumped) — it does not start a
new one. Only one open question at a time.

### 4c. Expiry, version & signing (stateless — no new DB table)

No proposal table is created (schema is senior-only and out of this lane). Instead the server returns
an **HMAC-signed** envelope. The signature covers:
`{ proposalId, version, callerId, childId, scenarioDate, action+params, scheduleFingerprint, expiresAt }`.

- `scheduleFingerprint` = a stable hash of the authorized reads the conflict was derived from
  (`events(child,date)` rows + `effectiveScheduleFor`), so a materially changed schedule invalidates
  the token (§5 stale check).
- `expiresAt` = `createdAt + 15 min`.
- Signing key: env `ROSINA_PROPOSAL_SIGNING_KEY` (names-only in `.env.example`; **never** logged or
  committed). Absent key in a configured prod environment is a startup error; tests inject a key.
- `version` increments on each clarification resume; an old version's signature no longer confirms.

---

## 5. Confirm (enforced server-side)

`POST /api/rosina/notice-plan/confirm`

```jsonc
{ "proposalId": "np_...", "version": 2, "childId": "p_nora",
  "action": "requestPickup", "params": { "asOf": "2026-11-03", "window": "afternoon" },
  "signature": "<hmac from the envelope>" }
```

Server steps, in order, each a hard gate:

1. **Verify signature** over the exact `{caller, child, version, action, params, fingerprint, expiry}`.
   Mismatch / tampered params → `400 INVALID_PROPOSAL`.
2. **Re-authenticate** the bearer; **re-authorize** the caller as parent/guardian of `childId` *now*
   (not trusting the token's claim alone). Failure → `403 UNAUTHORIZED` (generic; no oracle). Priya
   and other limited personas land here even if a button were shown.
3. **Expiry:** `now > expiresAt` → `410 PROPOSAL_EXPIRED`.
4. **Stale check:** re-read the schedule, recompute `scheduleFingerprint`; if it differs materially
   from the signed one → `409 PROPOSAL_STALE` (re-prepare required).
5. **Act:** call `requestPickup(childId, asOf, window)` exactly once. Its own idempotency key makes a
   double-click / network retry return the **same** job — never a second job. Review-only proposals
   (`onConfirm.available=false`) → `422 NO_ACTION_AVAILABLE`; nothing is called.
6. **Return** the `CoordinationJob` (id, status, version). The parent's real decision continues in
   Mission Control (candidates → Kendra's approval). **No calendar event is written** (that needs
   Bentley); the confirm's only write is the coordination job via `requestPickup`.

### 5.3 Dismissal-time → window mapping (the only granularity requestPickup accepts)

`America/Detroit` local time of the dismissal: `< 12:00 → morning`, `12:00–16:59 → afternoon`,
`≥ 17:00 → evening`. The exact time stays in the proposal facts (§3); the job carries only the
window. The proposal text makes this explicit so no false precision is implied.

### 5.4 Confirm error codes

| HTTP | code | when |
| --- | --- | --- |
| 401 | `UNAUTHENTICATED` | bad/absent bearer |
| 403 | `UNAUTHORIZED` | not parent/guardian of child (generic; also unseeable child) |
| 400 | `INVALID_PROPOSAL` | bad signature, shape, or version |
| 410 | `PROPOSAL_EXPIRED` | past `expiresAt` |
| 409 | `PROPOSAL_STALE` | schedule changed since prepare |
| 422 | `NO_ACTION_AVAILABLE` | review-only proposal, nothing to confirm |
| 200 | — | job returned (idempotent on retry) |

---

## 6. Authorization summary

- Prepare and confirm both authorize the child fail-closed, as the caller. No existence oracle.
- Only PARENT/guardian can confirm a pickup (DB-enforced in `request_pickup`). Limited personas may
  *read* what they're allowed and *see* a proposal, but the server refuses the confirm.
- A child the caller isn't authorized for → the same generic refusal as any other denial.
- Identity is never minted; every read and the pickup write run on the caller's own bearer.

---

## 7. Sample kit ("Try a sample" tray) — fictional only

Rendered from exact HTML → PNG and PDF so the text is exact (Muse Image only for decoration, never
for notice text). Samples go through the **same** pipeline as a manual drop. School = the fictional
village school matched **by id** from `docs/handoff/VILLAGE-MAP-CONTRACT.md`
(`feat/village-map-backend`) — matched by id, not by a similar name. Scenario child `p_nora` at
Lincoln Elementary (recorded school day ends 15:00).

- **(a) early dismissal** conflicting with Nora's recorded 15:00 pickup on the scenario date —
  **built FIRST, end to end. SHIPPED (assets only).** School `g_school` (Lincoln Elementary),
  scenario date **2026-10-26**, dismissal **12:30 PM**. Source: `src/rosina/samples/`
  (`notice-a-early-dismissal.html` / `.txt`); rendered assets:
  `web/public/samples/notice-plan/notice-a-early-dismissal.png` and `.pdf` (served to the tray).
- **(b) ambiguous notice** needing the one clarifying question (§4b). **SHIPPED.** "dismissed early
  **next Friday**" with no explicit date → the pipeline returns one question and the `resume` answer
  continues the same proposal. Source `notice-b-ambiguous.{html,txt}`; assets
  `web/public/samples/notice-plan/notice-b-ambiguous.{png,pdf}`.
- **(c) field-trip permission slip** — **review-only** (§1.2), confirm disabled (server 422).
  **SHIPPED.** Grade 3 Nature Center trip that returns before dismissal (no conflict). Source
  `notice-c-field-trip.{html,txt}`; assets `…/notice-plan/notice-c-field-trip.{png,pdf}`.

Render step: `node ops/render-notice-samples.mjs` (Playwright headless Chromium, no network). The
`.html` is the single source of truth for the text; `.txt` is the pasted-text form (verified-quote
path), `.png`/`.pdf` the image/PDF forms (transcription path) — identical text in all three.

---

## 8. Tests (stubbed model + stubbed reads; no network, no Meta cost)

Extraction mapping; quote validation (a fabricated quote is **rejected**); conflict detection against
fixture schedules; the one-question path (resume same proposal); notice-embedded injection ignored;
Priya refused at the **server** on confirm; a **stale** proposal refused; **retry idempotency** (same
job returned); confirm calls `requestPickup` **exactly once** with the right window.

---

## 9. Explicitly recorded limitations / missing capabilities

1. No consent-request creation exists → field-trip notices are review-only (§1.2).
2. `requestPickup` has no clock-time field → only a coarse window is set; exact time stays in the
   proposal (§1.1, §5.3).
3. PDF is not sent to the vision model as PDF; v1 rasterizes page 1 only, rest reported unread
   (§2.2).
4. No DB schema change: proposals are stateless signed tokens, not rows (§4c).
5. No calendar-event write on confirm (needs Bentley); confirm's only write is the coordination job.
6. No caching added for this feature.

Live proof (model id, served revision, actual output, one run per sample as Kendra) is appended as
evidence **only after merge and a verified deployment** in a Bentley-reserved sandbox window. No
changes to Bentley's branch or migrations.
