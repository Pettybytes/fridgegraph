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
- Per-caller rate limit **plus** a process-wide generation budget a new login cannot reset.
- **Ephemeral first slice:** bounded bytes for in-memory preview/export only. **No** new DB schema,
  **no** reuse of Orbit photo storage, **no** guest list / sending / RSVP / calendar writes.
