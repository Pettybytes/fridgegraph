# Contract — Invites (slim), BACKEND (Muse Image)

**Status:** Implemented to the contract handed to `feat/web-activity-timeline`. Branch
`feat/rosina-invites-backend` off `origin/main`. This doc is the exact shape the web timeline builds
against; any field change is posted as a diff on the PR before it is coded.

A parent asks Rosina to make a party invitation **in their own words**. The art is driven by the
parent's **creative request** (its subject, transformation, style, composition and any wording they
ask for). A reference image is **OPTIONAL** (Bryan, 2026-11-03): a description alone generates art, an
**uploaded reference** is remixed, and a revision sends the **prior generated result** back. The
parent fills the event details and wording (who, when, where, and the exact words) in the panel; those
fields are **editable, never required to make art, never block it, and never invented**, and a missing
detail becomes a non-blocking `suggestion`, not a gate. The app owns the event-text layer and composites
it on an opaque plate, so the model paints no lettering and text never collides. Only the parent's typed
`request` and any uploaded reference ever reach the provider, **never** any graph-derived private data
(the child's record, schedule, household). Default is **fixture** mode; the live Muse Image path is
behind `INVITE_LIVE=1`.

> **Creative-workflow rework (this change).** Supersedes the earlier *art-only / preset-theme /
> vision-style-extraction / schedule-required* design described in the historical sections below
> (§"Art-only prompt", §8.3). The parent's request now drives the art; an uploaded reference is used
> as a **real image-to-image edit** (not just a style hint); revisions re-edit the prior result; and
> the event schedule no longer gates generation. Where older prose disagrees, this rework wins.

## Request

```
POST /api/rosina/invite        Authorization: Bearer <caller jwt>
{
  "childId": "p_nora",
  "request": "turn these into warrior unicorns in golden armor and add “Happy Birthday Sam”",
  "referenceImage": { "mimeType": "image/png", "dataBase64": "<bytes>" },  // OPTIONAL, remixed as an edit
  "revise": false            // optional; true re-edits the PRIOR generated result (sent back as referenceImage)
}
```

`childId` (string, required), `request` (string, required): the parent's own words, bounded by the
**single** shared limit `MAX_REQUEST_CHARS = 2000` (`invitePrompt.ts`). That one limit is enforced at
the endpoint (over-length returns `400`) AND shown on the web textarea (`maxLength` + a live counter),
so the full accepted request reaches the brief, with **no separate, smaller silent truncation** (an
earlier 900-char cap is removed). `referenceImage` (OPTIONAL): the **only** accepted upload field,
PNG/JPEG/WebP, ≤ 5 MB, dims 16–4096 px, validated by magic bytes and **EXIF/GPS/XMP-stripped**
server-side before it reaches the provider. A request with no reference generates from the description
alone. Any **other** image/photo/upload key is rejected `400`
(see below). `revise: true` reuses the edits path with the prior generated art as the reference, so
the result keeps every existing element the request does not ask to change.

## Response `200`

```jsonc
{
  "status": "READY",                 // always "READY" now — art is never gated on the schedule
  "clarification": null,             // retained for back-compat; always null (no longer a gate)
  "suggestion": "Add a date below to finish the invitation.",  // string | null — non-blocking nudge
  "event": {
    "childFirstName": "Sam",
    "occasion": "Birthday party",
    "date": "2026-11-15",            // YYYY-MM-DD | null  (validated real America/Detroit date)
    "startTime": "14:00",           // HH:MM | null
    "endTime": "16:00",             // HH:MM | null
    "timezone": "America/Detroit",
    "placeLabel": "Maple Hall"       // | null
  },
  "art": {
    "mimeType": "image/webp",        // the provider's REAL output format, read from the bytes (png|jpeg|webp)
    "width": 1024,                   // the REAL pixel dimensions, read from the bytes — NOT assumed
    "height": 1536,
    "base64": "<base64 image bytes>",          // bounded; in-memory preview/export only; no URL
    "quietArea": { "x": 82, "y": 1027, "w": 860, "h": 445 }  // the bottom-third band for the app's text
  },
  "provenance": {
    "source": "MUSE_IMAGE",          // "MUSE_IMAGE" | "FIXTURE"
    "model": "muse-image-1.0",       // "muse-image-1.0" when source=MUSE_IMAGE, else null
    "cached": false,                 // served from the process cache vs generated this request
    "promptHash": "<sha256 of the creative brief (+ reference hash)>",
    "outputFormat": "webp",          // the actual format the provider returned (verified, never assumed)
    "edited": true                   // true when a reference image drove the result (an edit / revision)
  },
  "reference": { "requested": true, "applied": true }  // present when a reference was sent; applied=false in fixture
}
```

- Every `event` field is editable; rendering the text is the app's job, not the model's. The brief
  forbids any lettering in the generated image and keeps its lower third empty; the app composites
  the event text on an opaque plate over that band, so model art can never collide with the text.
- Every `event` field is editable; rendering the text is the app's job, not the model's. `timezone`
  is always `America/Detroit`. A missing name/occasion/date surfaces as `suggestion` (plain words,
  never invented) — it **does not** block the art or the download.
- **Output format/dimensions are verified from the returned bytes, not assumed.** Muse Image defaults
  to **WebP** and treats `size` as an **aspect ratio**, not an exact pixel size, so `art.mimeType`,
  `art.width/height`, `provenance.outputFormat` and the `quietArea` all track the real output. The
  downloaded card is always re-encoded to PNG by the canvas regardless of the source format.
- `art.base64` is **ephemeral** (in-memory preview/export). **No provider signed URLs** appear in the
  response or in evidence. Provenance records model id, prompt hash, generated-vs-cached, the real
  output format, and whether a reference drove the result.

## Errors (bounded)

| HTTP | code | when |
| --- | --- | --- |
| 401 | `UNAUTHENTICATED` | bad/absent bearer |
| 403 | `UNAUTHORIZED` | not parent/guardian of the child, OR the demo guide — generic, no oracle; **zero model calls** |
| 429 | `RATE_LIMITED` | per-caller rate limit; body also carries `{ "retryAfterMs": number }` |
| 429 | `BUDGET_EXHAUSTED` | per-child daily generation budget spent — a new login cannot reset it |
| 502 | `IMAGE_FAILED` | the Muse Image generation/edit call failed (live mode) |
| 413 | `PAYLOAD_TOO_LARGE` | the `referenceImage` exceeds 5 MB |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | the `referenceImage` is not a PNG/JPEG/WebP (by magic bytes) |

**Additions beyond the handed list (posted as a diff on the PR; non-breaking for the web client):**
`400 INVALID_REQUEST` for a missing/overlong `childId`/`request`, a malformed `referenceImage`
(bad base64 / out-of-range dimensions), or any image/photo/upload key **other** than `referenceImage`
in the body. A missing `referenceImage` is **allowed** (it generates from the description alone). The
optional best-effort field extraction (Muse Spark) **never fails the request**: a Spark error just
yields empty, editable fields and a `suggestion`; only a Muse Image generation/edit failure produces
`502 IMAGE_FAILED`.

## Live Muse Image path (behind `INVITE_LIVE=1`)

Uses Meta's **documented** Muse Image interfaces (`src/rosina/inviteImage.ts`):

- **Generation** — `POST ${META_BASE_URL}/images/generations`
  (<https://dev.meta.ai/docs/image-generation>). Body: `{ model: "muse-image-1.0", prompt: <creative
  brief>, n: 1, size: "1024x1536", response_format: "b64_json", output_format: "png" }`.
- **Edit (image-to-image)** — `POST ${META_BASE_URL}/images/edits`
  (<https://dev.meta.ai/docs/api-reference/images/edit-image>). Same body **plus**
  `images: [{ image_url: "data:<mime>;base64,<ref bytes>" }]`. A `referenceImage` is always present
  (an upload remix, **or** the prior result sent back on a `revise`), so this is the route taken.
- `Authorization: Bearer ${META_API_KEY}` — **server-side key only, never logged, never returned**.
  `n`, `size`, `output_format` and a bounded output size (8 MB) are forced server-side.

**Meta API findings (verified against the docs, reflected in code):**
- `output_format` **defaults to `webp`**, not PNG — we request `png` but **read the actual format
  back** from the response's `output_format` field and from the returned bytes (magic-byte sniff).
- `size` is an **aspect ratio**, not an exact pixel size — so the real pixel dimensions are **read
  from the returned bytes** (`imageHygiene.readImageDimensions`), never assumed to be 1024×1024. An
  unreadable image is an **uncertain** failure (budget charged conservatively), never a silent guess.

### Creative brief (replaces the old art-only/preset-theme prompt)
The image model receives a **creative brief built from the parent's OWN request**
(`src/rosina/invitePrompt.ts` → `buildCreativeBrief`): it preserves the requested subject,
transformation, style, composition and **any wording the parent asked for** (e.g. "Happy Birthday
Sam"). For an edit it instructs the model to transform the provided reference keeping its recognizable
subject; for a revision, to preserve every existing element the request does not change. A calm
lower-centre area is reserved for the app's event text. Safety constraints fixed in every brief:
**illustrated and fictional; no real, identifiable people or private likenesses; no copyrighted
characters, brand logos or trademarks.** Only the parent's typed request (and their uploaded
reference) are sent — never graph-derived data; `childId` is used for authorization and budget only.

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
- **Cost model.** Muse Image is priced at **$0.01 per generated image**, per Meta's published
  docs — a real, current, citable figure, not modeled on a third-party comparable (an earlier
  draft of this contract wrongly described Muse Image as a "fictional provider" priced off DALL-E
  3's $0.04/image; that was incorrect and has been corrected). The constant lives ONLY as a SQL
  literal inside `invite_budget_reserve` (migration 0085) — `src/rosina/inviteLedgerBudget.ts`'s
  `INVITE_GENERATION_COST_USD` export mirrors it for tests/documentation only and is never sent to
  the server.
- **Cost and settlement are decided SERVER-SIDE ONLY.** `reserveInviteBudget` takes no cost
  argument at all. `settleInviteBudget`'s outcome is a closed GraphQL enum,
  `InviteGenerationOutcome { SUCCEEDED FAILED UNCERTAIN }`, plus a `cached: Boolean!` argument that
  conveys a FACT the caller observed (its own image client's cache), not a price — the SQL function
  computes the actual charge itself from `(status, cached)`. No caller-accessible mutation can set
  or influence either the per-generation price or the settled outcome's cost.
- **Settlement is trusted server work, not a caller-reported fact.** Removing the cost argument
  and closing `status` to an enum stops a caller from naming its own PRICE, but does nothing to
  stop the reservation's own legitimate owner from calling `settleInviteBudget` directly (GraphQL
  or the raw RPC) and simply lying about the outcome — claiming `FAILED` or `cached: true` to
  falsely release/zero a real, billed generation. `status`/`cached` are genuinely knowable only by
  whoever made the real provider call — Rosina's own backend (`src/rosina/inviteLedgerBudget.ts`)
  — which alone holds `INVITE_SETTLEMENT_HMAC_SECRET`. Every `settle()` call now includes `proof`,
  an hmac-sha256 over the exact settlement facts (`generationId|status|cached|model|outputSha256`)
  keyed with that secret; `invite_budget_settle` (0085) verifies the SAME hmac against the
  `app.invite_settlement_hmac_secret` database setting (configured out of band when 0085 is
  applied, never checked into any migration file) and fails CLOSED — uniform `false`, no oracle —
  on any mismatch or unconfigured secret. This check lives INSIDE the SQL function, so it protects
  a direct RPC call identically to the GraphQL mutation; it is not a UI-only restriction. Ownership
  of the reservation remains necessary (unchanged) but is no longer sufficient on its own — proven
  directly in `ops/invite-budget-proof.mjs` check 13: the reservation's own owner, with a garbage
  or missing proof, cannot release it; the same reservation settles normally once a correctly
  computed proof is supplied.
- **A cache hit is never a paid generation.** A repeat prompt (many families' requests collapse
  onto the same small set of occasion-based themes) returns `provenance.cached: true` from the
  image client with no real provider call. `InviteImageGenerator.peekCached(promptHash)` lets
  `inviteEndpoint.ts` skip `reserve()` entirely for a confidently-known cache hit — it is never
  blocked by an exhausted budget, because it costs nothing. If the cache state changes between
  that check and the real `generate()` call (a race with a concurrent request), a reservation IS
  made, but `generate()`'s own `provenance.cached` remains the single source of truth `settle()`
  charges against — `cached: true` at settle time always replaces the provisional charge with $0,
  regardless of what `peekCached` predicted.
- **An UNCERTAIN outcome is charged conservatively, never silently released.** Not every thrown
  error reverses the reservation. `inviteImage.ts` distinguishes a CONFIRMED failure (the provider
  gave a clean, synchronous rejection — a non-2xx HTTP status — before producing anything; settles
  FAILED, free) from an UNCERTAIN failure (a network error/timeout/abort after the request was
  sent, where it's never learned whether the provider received and billed it; or a local
  validation failure on an otherwise-200 response, where the provider most likely DID generate and
  the parsing/bound check is what rejected it). An UNCERTAIN outcome settles charged, at the full
  reserved amount, and is never refunded by default — the provider may have billed for it.
- **Default cap: $1.00/child/day → 100 generations/day** at the real $0.01/generation price.
  Overridable per household via the EXISTING `household_policies` mechanism (same table
  `ride_cost_cap_usd` already uses), rule `invite_daily_budget_usd`. Scope is strictly **per
  child** (see above) — "per family" is never accurate wording for this limit unless a future
  slice actually implements per-household splitting, which this one does not.
- **FIXTURE never touches the ledger at all** — no real spend, no reservation, by construction
  (the endpoint only calls `reserve`/`settle` when `source === 'MUSE_IMAGE'`, and even then only
  when `peekCached` cannot already answer "free").
- **Atomic, race-safe.** `invite_budget_reserve` takes a `pg_advisory_xact_lock` keyed per child
  before reading today's spend, so two concurrent requests for the SAME child cannot both pass the
  check before either writes — proven under real concurrency in `ops/invite-budget-proof.mjs`
  check 6 (two simultaneous reservations at the cap boundary: exactly one succeeds).
  `invite_budget_settle` only updates a reservation the SAME caller created, and only once — a
  second settle on an already-terminal reservation is refused, so no replay/override of a prior
  outcome is possible (proof check 7).
- **Retries cost nothing extra beyond what they actually spend.** `reserve` happens before the
  image call; `settle(FAILED)` after a CONFIRMED model error reverses it immediately — the same
  refund semantics the old in-memory budget had, now persisted (proof check 4). An UNCERTAIN
  outcome is the deliberate exception: it is NOT reversed, per above.
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
  untouched by construction. Proven directly: `ops/invite-budget-proof.mjs` check 14 inserts,
  calls the REAL `resetDemo()`, and confirms the row count is identical before and after.
- **Evidence recorded per generation**: `model`, `prompt_hash`, `output_sha256` (sha256 of the
  returned art bytes, computed server-side after generation), `cost_usd`, `source`, `status`,
  timestamps. Reference proof is byte-for-byte: `output_sha256` is computed from the exact bytes
  returned to the client, not a separate re-fetch.

### 8.3 Reference image upload — REAL image-to-image edit (reworked)

> **Reworked.** The earlier version of this section used Muse **vision** (`muse-spark-1.3`) to extract
> a bounded *style hint* from the reference and feed it to a text-only generation, because an earlier
> reading concluded muse-image-1.0 "cannot take a reference image." **Meta's documented Muse Image
> API does expose an edits (image-to-image) endpoint** — `POST ${META_BASE_URL}/images/edits` with
> `images: [{ image_url }]` (<https://dev.meta.ai/docs/api-reference/images/edit-image>). The rework
> uses it: the **actual uploaded image** now guides the result, and the vision-extraction path
> (`inviteReference.ts`) is removed.

**Provider path.** Every accepted request carries a `referenceImage` (an upload remix, or the prior
generated result sent back on a `revise`), so the endpoint routes to `/images/edits` and passes the
image as a `data:` URL in `images[]`. The creative brief tells the
model to transform the provided image to match the request, keeping its recognizable subject (edit)
or every element the request doesn't change (revision). The uploaded image is used as the **edit
input**, not placed verbatim in the card; the exported card is the generated art plus the app's text.

**Safety (`imageHygiene.ts` + `inviteEndpoint.ts`, all in memory, never persisted, never logged):**
PNG/JPEG/WebP only by **magic-byte sniff** (a lying `mimeType` is rejected), **≤5 MB**, **dimensions
read server-side** (16–4096 px), **EXIF/GPS/XMP stripped** before the bytes reach the provider. The
caller is authenticated and must be the child's parent/guardian (unchanged authz — a refusal makes
zero model calls). A reference/revision generation **counts as one unit against the per-child ledger
budget (0085)** and the per-caller rate limit: the budget is **reserved before** the edit call (a
reference always reserves — it is never a silent cache hit), so an exhausted budget makes zero
provider calls.

**What reaches the provider.** Only the parent's typed `request` (as the creative brief) and the
stripped reference bytes. No graph-derived data; `childId` is used for authz + budget only. The brief
+ the reference content hash form the dedup/cache key, so a different request or a different reference
yields different art, and `revise` is distinguished in the key so a revision never collides with the
original.

**Honesty.** The response carries `reference: { requested, applied }` and `provenance.edited`. With
`INVITE_LIVE` off (FIXTURE), the control still renders, the reference is validated for safety but the
sample cannot remix it (`applied:false`) and the UI says so. In live mode an applied edit reports
`applied:true`; if the edit could not be applied the UI says the reference wasn't applied — never
silently approximated.

**Revision & retry invariants (web, `InvitesPanel.tsx`).**
- **Edited fields survive a revision.** The editable event is held by the composer, not the card. A
  successful revision keeps the parent's current (edited) name/date/place/host/message and only fills
  a still-empty field from the fresh extraction — a revision-only instruction ("add balloons") never
  replaces an existing value with an empty or default one. A *fresh* "Prepare a new invitation"
  adopts the new extraction outright (it is a new design).
- **Retry repeats the exact failed operation.** The last attempt's `{ request, referenceImage,
  revise }` is captured; **Retry** replays that — same mode, same reference, same revision intent —
  rather than silently starting a fresh prepare.
- **Every accepted result is revisable (limit reconciliation + resize path).** The generator bound is
  8 MB at the provider's aspect ratio; the revision-input (reference) bound is 5 MB / 16–4096 px. A
  generated result can exceed the reference bound, which would otherwise make it un-revisable. Before
  a result is sent back as a revision reference, `renderInvite.toRevisionReference` sends it verbatim
  when it already fits, and otherwise **downscales it to ≤ 4096 px and re-encodes PNG, shrinking until
  it is also ≤ 5 MB** — an explicit resize path, so any accepted result can be revised.

### 8.4 Proof

- **Mocked-provider tests** (`src/rosina/invite.test.ts`, 21 tests, no network/DB): authorization
  (unchanged from the original slice), the per-child ledger budget (a new login sharing the same
  child's budget, independent budgets per child, FIXTURE never reaching the ledger), the PII guard
  refusing before any reservation, deduplication (concurrent/duplicate/retry-after-failure), a
  successful generation settling with a real output hash, a known cache hit skipping reservation
  entirely, the settle-time `cached` fact still correctly zeroing the cost on a cache-hit race, an
  UNCERTAIN outcome charging conservatively, a CONFIRMED failure settling free, and direct unit
  coverage of `createLiveImageGenerator`'s CONFIRMED-vs-UNCERTAIN failure classification.
- **GraphQL-layer forgery tests** (`src/subgraphs/coordination.inviteBudgetAuthz.test.ts`, 9
  tests, real `buildSubgraphSchema` execution against this subgraph's own typeDefs + resolvers):
  schema introspection proves `reserveInviteBudget`/`settleInviteBudget` have no cost/price
  argument of any kind, that `status` is the closed `InviteGenerationOutcome` enum (not a free
  string), and that `proof` is a required argument on `settleInviteBudget`; execution proves an
  out-of-enum `status` or a missing `proof` is a GraphQL validation error before the RPC is ever
  called, both resolvers forward ONLY their fixed, documented argument set to the RPC (no
  `p_cost_usd` or other price-shaped field reaches it; `proof` is forwarded verbatim, never
  computed or validated by the resolver), the RPC's own allow/deny decision passes through
  unmodified including a refusal of a forged proof (never silently upgraded to success), and an
  unauthenticated caller is refused before either RPC is reached.
- **Real disposable-Postgres proof** (`ops/invite-budget-proof.mjs`, 14/14 checks): reservation
  with no caller-supplied cost, shared per-child budget across logins, independent per-child
  budgets, settle(FAILED) reversal, authorization refusals (stranger + wrong-child parent),
  concurrency at the cap boundary, settle ownership and replay refusal, a cache-hit settle
  charging $0 and releasing its budget, an UNCERTAIN settle keeping the full reserved charge,
  forged RPC signatures (an extra cost argument) resolving to no function at all (SQLSTATE
  42883), a total stranger refused when settling/releasing a reservation it does not own, the
  `authenticated` role having no direct select/insert/update/delete grant on
  `invite_generations` at all (SQLSTATE 42501, checked even for the reservation's own owner), the
  reservation's own LEGITIMATE OWNER refused when settling with a garbage or missing hmac proof
  (the core settlement-trust negative test — ownership alone is not sufficient), and the
  demo-reset survival proof.
- **Web tests** (`web/src/features/invites/*.test.tsx`): the existing honest-states suite plus new
  coverage for preserve-last-design-while-regenerating, the explicit Retry button actually
  re-running the request, and no Retry offered on a 403 refusal.
- **One bounded real-generation check, PREPARED and NOT RUN**: `ops/invite-live-check.mjs` — a
  single real `INVITE_LIVE=1` request against the live Rosina service, for Bentley to run in his
  own authorized window. This PR makes zero provider calls itself.

### 8.5 Rollout order

1. Review this PR (money-adjacent + schema; AGENTS.md §1.6 human review).
2. Generate a real `INVITE_SETTLEMENT_HMAC_SECRET` (e.g. 32+ random bytes, base64/hex) and
   configure it in TWO places that must match exactly: Rosina's own environment, and the database
   — `alter database <db> set app.invite_settlement_hmac_secret = '<the same secret>';` (run once,
   out of band; never checked into any migration file or committed anywhere). Settlement cannot
   succeed until both sides agree — that is the fail-closed design, not a bug.
   **Platform fallback (0091).** A Supabase project whose migration role is not a superuser cannot
   run that `ALTER DATABASE` (PostgreSQL 15+ parameter ACL: SQLSTATE 42501, verified on both pooled
   and direct connections). Migration 0091 adds a private, grant-less single-row table
   `invite_settlement_config`; `invite_budget_settle` keeps the GUC as its first source and falls
   back to that row. The secret is inserted out of band with the same rule: never in a migration
   file, never committed. An empty table still fails closed.
3. Bentley applies migration 0085 in an authorized window (content hash recorded in the PR), on
   the real project database — never by this PR, never by an agent.
4. Deploy the updated `coordination` subgraph (adds `reserveInviteBudget`/`settleInviteBudget`) and
   the updated Rosina service (adds the ledger-backed budget + dedup + the settlement proof) —
   backend only; the web cutover (which bundle actually serves `InvitesPanel mode="live"`) is a
   separate, later window, same split every other live-wiring deploy in this project's history has
   used. Rosina fails fast at startup if `INVITE_LIVE=1` but `INVITE_SETTLEMENT_HMAC_SECRET` is
   unset — invites stay OFF (logged), never silently running without settlement trust.
5. `INVITE_LIVE` stays **off** through this rollout — fixture mode is the default and spends
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

### 8.7 App-owned card text — host and personal note (web only, no backend change)

The backend response shape above is unchanged: extraction returns `childFirstName`, `occasion`,
`date`, `startTime`, `endTime`, `timezone`, `placeLabel`, and nothing else. The **card** also shows a
host line and a short personal note, and those are app-owned text — the same principle already stated
at the top of this document ("the app owns the text layer; the child's name, date and venue are
**never** sent to the image model"). They are:

- `hostName` and `message`, added to the web `InviteEvent` type in
  `web/src/features/invites/invite.ts`. Never extracted, never returned by the endpoint, never sent
  to any model, never persisted.
- Filled by `withInviteDefaults(event, defaultHostName)`: a blank host becomes the signed-in parent's
  name, a blank note becomes `DEFAULT_INVITE_MESSAGE`. A value the family typed is never overwritten.
  Applied once, in `InviteComposer`'s READY branch, so the fixture and live paths behave identically.
- Editable in the card's field list ("Hosted by", "Personal message") and dropped from the layout
  entirely when blank — the remaining type scale does not shift.

**Fixture labelling is explicit in both layers.** The API says it with `provenance.source`
(`FIXTURE` | `MUSE_IMAGE`) and `provenance.cached`; the UI says it three ways — the panel eyebrow
("Sample preview"), a plain-words source note under the preview (in live mode it states outright that
live art generation is switched off and the fixture is being shown), and the credit burned into the
exported PNG footer, now `Sample art — not generated` for a fixture and `Art generated with Muse
Image` for real Muse output. A fixture can therefore never be mistaken for newly generated art in a
download, a screenshot, or the page itself.

The rendered canvas is captioned as the downloaded PNG, and the readable card beside it is generated
from the same ordered line spec (`lineSpecs`), so the exported image and the on-screen text cannot
drift apart.
