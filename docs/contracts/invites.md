# Contract — Invites (slim), BACKEND (Muse Image)

**Status:** Implemented to the contract handed to `feat/web-activity-timeline`. Branch
`feat/rosina-invites-backend` off `origin/main`. This doc is the exact shape the web timeline builds
against; any field change is posted as a diff on the PR before it is coded.

A parent asks Rosina to make a party invitation. Rosina extracts the event fields, validates them
(Detroit-local dates) **before any image call**, and — for a complete request — returns structured,
**editable** event fields plus **art-only** illustration bytes for an in-memory preview/export. The
app owns the text layer; the child's name, date and venue are **never** sent to the image model.
Default is **fixture** mode; the live Muse Image path is behind `INVITE_LIVE=1` (not run tonight).

## Request

```
POST /api/rosina/invite        Authorization: Bearer <caller jwt>
{ "childId": "p_nora", "request": "dinosaur birthday invite for Nora on Nov 15 at Maple Hall, 2–4pm" }
```

`childId` (string, required), `request` (string, required, ≤ 2000 chars) — the parent's own words. No
image/photo/upload field is ever accepted (see error 400 below).

## Response `200`

```jsonc
{
  "status": "READY",                 // "READY" | "NEEDS_CLARIFICATION"
  "clarification": null,             // { "question": string } when NEEDS_CLARIFICATION, else null
  "event": {
    "childFirstName": "Nora",
    "occasion": "Birthday party",
    "date": "2026-11-15",            // YYYY-MM-DD | null  (validated real America/Detroit date)
    "startTime": "14:00",           // HH:MM | null
    "endTime": "16:00",             // HH:MM | null
    "timezone": "America/Detroit",
    "placeLabel": "Maple Hall"       // | null
  },
  "art": {                           // null when NEEDS_CLARIFICATION (no image generated)
    "mimeType": "image/png",
    "width": 1024,
    "height": 1024,
    "base64": "<base64 image bytes>",          // bounded; in-memory preview/export only; no URL
    "quietArea": { "x": 96, "y": 600, "w": 832, "h": 328 }  // px region reserved for the app's text
  },
  "provenance": {
    "source": "FIXTURE",             // "MUSE_IMAGE" | "FIXTURE"
    "model": null,                   // "muse-image-1.0" when source=MUSE_IMAGE, else null
    "cached": false,                 // served from the process cache vs generated this request
    "promptHash": "<sha256 of the art-only prompt>"   // "" when NEEDS_CLARIFICATION
  }
}
```

- Every `event` field is editable; rendering the text is the app's job, not the model's. `timezone`
  is always `America/Detroit`.
- On `NEEDS_CLARIFICATION`: `clarification` is set, `art` is `null`, and `event` carries whatever was
  extracted (unknown required fields left null/empty); `provenance` carries the active `source` with
  `model: null`, `cached: false`, `promptHash: ""`.
- `art.base64` is **ephemeral** (in-memory preview/export). **No provider signed URLs** appear in the
  response or in evidence. Provenance records model id, prompt hash, and generated-vs-cached.

## Errors (bounded)

| HTTP | code | when |
| --- | --- | --- |
| 401 | `UNAUTHENTICATED` | bad/absent bearer |
| 403 | `UNAUTHORIZED` | not parent/guardian of the child, OR the demo guide — generic, no oracle; **zero model calls** |
| 429 | `RATE_LIMITED` | per-caller rate limit; body also carries `{ "retryAfterMs": number }` |
| 429 | `BUDGET_EXHAUSTED` | process-wide generation budget spent — a new login cannot reset it |
| 502 | `IMAGE_FAILED` | the model pipeline failed (Muse Spark extraction or Muse Image generation, live mode) |

**Additions beyond the handed list (posted as a diff on the PR; non-breaking for the web client):**
`400 INVALID_REQUEST` for a missing/overlong `childId`/`request` or any image/photo/upload field in
the body. Extraction failures are folded into the existing `502 IMAGE_FAILED` (one model-pipeline
error), not a new code.

## Live Muse Image path (behind `INVITE_LIVE=1`; UNVERIFIED — reconfirm before enabling)

- `POST ${META_BASE_URL}/images/generations` (default `https://api.meta.ai/v1`), `Authorization:
  Bearer ${META_API_KEY}` — **server-side key only, never logged, never returned**.
- Server-forced body: `{ model: "muse-image-1.0", prompt: <art-only>, n: 1, size: "1024x1024",
  response_format: "b64_json" }`. `n`, size and a bounded output size are forced server-side.
- **Shape caveat:** follows the OpenAI-compatible Images convention the repo's Meta provider mirrors
  for chat (`src/rosina/museVision.ts`). **Meta's own image docs were not fetched tonight** (no
  network / no live calls). The exact request shape, supported sizes/aspect ratios and usage terms
  **must be reconfirmed against Meta's docs and cited here before `INVITE_LIVE=1` is enabled.**

### Art-only prompt (hard guardrail)
The image model receives **ART ONLY** — theme (from the occasion), illustration style and
composition, with a quiet area reserved for the app's text (`src/rosina/invitePrompt.ts`). It is
built from the occasion alone and asserted to contain **no** child name, date, or venue. Fixed in
every prompt: fictional, illustrated/hand-drawn, **no people or faces, no photoreal people, no
text/lettering, no logos/brands/known characters**. An uploaded photo is never accepted or sent.

## Guardrails & scope
- Caller's own bearer; **parent/guardian of that child only**; demo guide refused; a refused caller
  triggers **zero** Spark or image calls (authorization precedes extraction).
- Per-caller rate limit **plus** a per-CHILD daily budget a new login cannot reset — superseded
  from the originally-planned process-wide in-memory counter; see §8 below.
- **Ephemeral art, now a real ledger:** art bytes stay in-memory preview/export only; **no** reuse
  of Orbit photo storage, **no** guest list / sending / RSVP / calendar writes. The 0085 budget
  ledger (§8) IS new DB schema — money-adjacent (AGENTS.md §1.6), scoped to accounting only
  (never the image bytes themselves, which still never touch the DB).

---

## 8. Web integration, budget/ledger, deduplication, reference upload (this PR — STAGED)

Follow-up to the original "ephemeral, no DB" slim slice above: connects the already-built backend
(PR #130/#131) to the real UI (PR #140 was mock-only — the fixed fictional sample, never calling
this endpoint), and replaces the process-wide in-memory `GenerationBudget` with a real per-CHILD
persistent one. Fresh branch, draft PR, **never merged**; migration 0085 **STAGED**, not applied.
Money-adjacent (AGENTS.md §1.6: senior-only, Claude only on explicit instruction, human review
required before any apply) **and** schema/data (forward-only, 0001-0084 never touched) — both
apply to this section.

### 8.1 Web wiring

- `web/src/features/invites/liveInvite.ts` — the real `InviteCreator`, POSTs to `/api/rosina/invite`
  with the caller's own forwarded bearer (same pattern as `createServiceRosinaAdapter`,
  `src/features/rosina/adapter.ts`). Wired into `App.tsx`'s `invitations` slot behind
  `authMode === 'live'`, the same ternary every other live feature (calendar, mission control,
  Rosina chat) already uses — mock sessions keep the existing fixed fictional sample.
- **Preserve the last successful design while regenerating.** `InvitesPanel.tsx`'s `result` state
  is no longer cleared at the start of a new `prepare()` call — the existing card stays rendered
  (and downloadable) through a regeneration attempt, a clarification request, or a failure. It is
  only ever replaced by a NEW successful result.
- **Explicit retry, never automatic.** A `failed` phase (a transient-feeling error — rate limit,
  image pipeline failure, exhausted budget) shows a Retry button that re-runs the same request on
  click. A `refused` phase (401/403 — a real permission boundary, not transient) does NOT offer
  Retry — retrying an authorization refusal changes nothing.
- **Generating art is not sending.** No code path in this slice creates a guest list, an RSVP, or
  a calendar write — `InviteComposer`'s only write-shaped action is `download()`, a client-side PNG
  export. Nothing new was added here; stated for the record since the UI is now real.
- **Gate-off / fixture state is clearly labelled**, not simulated success: `inviteCredit()`
  (`invite.ts`, pre-existing) already renders "Sample art" whenever `provenance.source ===
  'FIXTURE'` — true whether `mode="mock"` (the UI's own build-time fixture, no network call at
  all) or `mode="live"` with `INVITE_LIVE` off server-side (a REAL request that happens to return
  labelled fixture art). Both read as "Sample art" to the parent; neither claims a real generation.

### 8.2 Per-child budget + private ledger (0085, STAGED)

Replaces the process-wide, in-memory `GenerationBudget` (`src/rosina/inviteBudget.ts`, now removed
from the live wiring — the rate limiter in that file is unchanged) with `invite_generations`, a
real table, plus two `SECURITY DEFINER` RPCs (`invite_budget_reserve`/`invite_budget_settle`),
reached through a new GraphQL mutation pair on the `coordination` subgraph (`reserveInviteBudget`/
`settleInviteBudget`) — Rosina holds no DB credential of its own and never has; every read/write
still goes through the caller's own bearer, exactly like `buildInviteParentAuthorizer` already does
for authorization.

- **Scope: per CHILD, not per household.** A co-parented child (e.g. Nora: households `h_a`
  Kendra / `h_b` Andre) shares ONE budget regardless of which parent is asking — a per-household
  split would let the same party be re-generated twice for free by switching parents. "Per family"
  in the brief is realized as "per child," the unambiguous scope.
- **Cost model.** Muse Image has no published price (it is this project's own fictional provider
  abstraction — `src/rosina/inviteImage.ts` mirrors the OpenAI-compatible Images shape but is not a
  real Meta product). Modeled on **DALL-E 3's published Standard 1024×1024 price, $0.04/image**
  (the same resolution this endpoint requests), the closest real, currently-published comparable —
  observed 2026-11-03, see `src/rosina/inviteLedgerBudget.ts`'s `INVITE_GENERATION_COST_USD`.
  Revisit if Muse Image ever publishes a real figure of its own.
- **Default cap: $1.00/child/day → 25 generations/day**, the brief's own target. Overridable per
  household via the EXISTING `household_policies` mechanism (same table `ride_cost_cap_usd`
  already uses), rule `invite_daily_budget_usd`.
- **FIXTURE never touches the ledger at all** — no real spend, no reservation, by construction
  (the endpoint only calls `reserve`/`settle` when `source === 'MUSE_IMAGE'`).
- **Atomic, race-safe.** `invite_budget_reserve` takes a `pg_advisory_xact_lock` keyed per child
  before reading today's spend, so two concurrent requests for the SAME child cannot both pass the
  check before either writes — proven under real concurrency in `ops/invite-budget-proof.mjs`
  check 6 (two simultaneous reservations at the cap boundary: exactly one succeeds).
  `invite_budget_settle` only updates a reservation the SAME caller created (proof check 7).
- **Retries cost nothing extra beyond what they actually spend.** `reserve` happens before the
  image call; `settle(FAILED)` after a model error reverses it immediately — the same refund
  semantics the old in-memory budget had, now persisted (proof check 4).
- **Deduplication** (`src/rosina/inviteDedup.ts`) collapses a double-click, a network retry, or two
  tabs firing the identical request (same caller + child + request text) into ONE real
  extraction+reservation+image call — never two. Authorization and the per-request rate limit
  still run for every incoming HTTP request; only the expensive, money-relevant work is
  deduplicated. A genuinely different request, or an explicit retry AFTER a failure, is never
  deduplicated away (a handled failure is deliberately not cached).
- **Private, never returned to any client.** No `select`/`insert`/`update`/`delete` grant to
  `authenticated` on `invite_generations` at all — every access is through the two RPCs, both
  parent-authorized, both returning only `{allowed, generationId, remainingUsd}` for THIS child —
  never another family's data, a model name, a prompt, a hash, or a raw cost figure. Matches
  "keep credentials and provider accounting out of client responses" exactly.
- **Demo reset never touches it.** `invite_generations` is NOT in `ID_TABLES`/`RESET_SCOPED`/
  `SANDBOX_TABLES` (`src/demo/reset.ts`) — `resetDemo()` never references it, so it survives
  untouched by construction. Proven directly: `ops/invite-budget-proof.mjs` check 8 inserts,
  calls the REAL `resetDemo()`, and confirms the row count is identical before and after.
- **Evidence recorded per generation**: `model`, `prompt_hash`, `output_sha256` (sha256 of the
  returned art bytes, computed server-side after generation), `cost_usd`, `source`, `status`,
  timestamps. Reference proof is byte-for-byte: `output_sha256` is computed from the exact bytes
  returned to the client, not a separate re-fetch.

### 8.3 Reference image upload — deferred, not built

Checked both prerequisites the brief requires before building this: (1) **provider support** —
Muse Image's live path (§ live Muse Image path, above) is still itself UNVERIFIED against Meta's
real docs, and there is no reference-image parameter anywhere in the documented or implemented
request shape (`{ model, prompt, n, size, response_format }` only); (2) **existing private
upload/storage contract** — none exists for invites. `inviteEndpoint.ts`'s `IMAGE_KEYS` guard
actively REJECTS any image/photo/upload field in the request body today (400 `INVALID_REQUEST`),
which is the opposite of upload support. Both prerequisites are missing, so per the brief's own
instruction this slice ships **text-driven generation only**; reference upload is not implemented,
not stubbed, and not silently approximated by a vision-generated description — if a future slice
adds one, it must be an explicit, separately-labelled alternative pipeline, never presented as
equivalent to real reference-image support.

### 8.4 Proof

- **Mocked-provider tests** (`src/rosina/invite.test.ts`, 20 tests, no network/DB): authorization
  (unchanged from the original slice), the per-child ledger budget (a new login sharing the same
  child's budget, independent budgets per child, FIXTURE never reaching the ledger), the PII guard
  refusing before any reservation, deduplication (concurrent/duplicate/retry-after-failure), and a
  successful generation settling with a real output hash.
- **Real disposable-Postgres proof** (`ops/invite-budget-proof.mjs`, 8/8 checks): reservation,
  shared per-child budget across logins, independent per-child budgets, settle(FAILED) reversal,
  authorization refusals (stranger + wrong-child parent), concurrency at the cap boundary, settle
  ownership, and the demo-reset survival proof.
- **Web tests** (`web/src/features/invites/*.test.tsx`): the existing honest-states suite plus new
  coverage for preserve-last-design-while-regenerating, the explicit Retry button actually
  re-running the request, and no Retry offered on a 403 refusal.
- **One bounded real-generation check, PREPARED and NOT RUN**: `ops/invite-live-check.mjs` — a
  single real `INVITE_LIVE=1` request against the live Rosina service, for Bentley to run in his
  own authorized window. This PR makes zero provider calls itself.

### 8.5 Rollout order

1. Review this PR (money-adjacent + schema; AGENTS.md §1.6 human review).
2. Bentley applies migration 0085 in an authorized window (content hash recorded in the PR), on
   the real project database — never by this PR, never by an agent.
3. Deploy the updated `coordination` subgraph (adds `reserveInviteBudget`/`settleInviteBudget`) and
   the updated Rosina service (adds the ledger-backed budget + dedup) — backend only; the web
   cutover (which bundle actually serves `InvitesPanel mode="live"`) is a separate, later window,
   same split every other live-wiring deploy in this project's history has used.
4. `INVITE_LIVE` stays **off** through this rollout — fixture mode is the default and spends
   nothing; enabling it is an explicit, separate decision requiring Meta's real image-docs
   reconfirmation (§ live Muse Image path) first.

### 8.6 Rollback

- **Web**: revert the `App.tsx` slot change — `InvitesPanel` falls back to `mode="mock"` (the
  fixed fictional sample) for every session, identical to pre-#140-mount behavior. No data loss:
  the panel never wrote anything to begin with.
- **Backend (subgraph/Rosina)**: redeploy the prior revision. The new GraphQL mutations and
  dedup/ledger-budget code are additive — nothing existing was removed from the call graph except
  the now-unused process-wide `GenerationBudget`, which has no external consumer.
- **Database (0085)**: additive only (`create table if not exists`, new functions) — no existing
  column, table, or function was altered. Rolling back means simply never calling
  `reserveInviteBudget`/`settleInviteBudget` again (redeploying the prior subgraph revision
  already achieves this); the table can be left in place inert, or dropped in a dedicated
  forward-only migration if ever desired. No data from any OTHER table is referenced by anything
  this migration removes.
