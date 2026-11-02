# Contract — "Pin it to the fridge" (Phase 2 intake), BACKEND, STAGED/MOCKED

**Status:** contract + **mocked** backend. Branch `feat/rosina-pin-to-fridge` off `origin/main`
`5c7f2e0`. Owns `src/rosina/**` and this intake contract only. **No model/provider calls and no
shared-stack calls** in this staged task; real persistence, private storage and any to-do/calendar
write are **dependency boundaries** (§7) owned elsewhere. **Never merge.**

A parent uploads a private photo/scan of a child's artifact — a drawing, permission slip, report
card, appointment card, or "other" — and Rosina proposes a typed, source-grounded interpretation to
**pin to the fridge**. Pinning shows extracted suggestions; it **does not** create a to-do, book an
appointment, sign a slip, or submit anything.

## 1. Flow (three steps; all mocked here)

1. `POST /api/rosina/pin/upload` → stores the bytes in **private** media and returns `{ assetId }`
   (authorization checked on every later access; §6).
2. `POST /api/rosina/pin` `{ childId, assetId, caption? }` → a **typed classification proposal** with
   visible uncertainty and source-grounded extracted fields (§3–§4), or a clarification (§4).
3. `POST /api/rosina/pin/confirm` `{ claims, signature }` → **pins** it. The confirm is bound and
   re-authorized server-side (§5). Pinning is the ONLY write this slice performs.

## 2. Classification — uncertainty stays visible

```jsonc
"classification": {
  "kind": "appointment_card",            // drawing | permission_slip | report_card | appointment_card | other
  "confidence": "low",                   // high | medium | low — a VISIBLE hint, NOT calibrated proof
  "uncertain": true,                     // true when the top kind is not clearly dominant
  "alternatives": [                      // always shown when uncertain, so the parent can re-pick
    { "kind": "permission_slip", "confidence": "low" }
  ]
}
```

Model confidence is never treated as calibrated proof. When `uncertain` is true the client shows the
alternatives and lets the parent choose the kind before confirming; the chosen kind is part of the
signed confirm (§5), so a mis-classification cannot be silently pinned.

## 3. Typed proposals (one per kind; fields are source-grounded)

Every extracted field carries a `source` — `verified_quote` for pasted/readable text validated as a
verbatim substring, or `transcription` (model-read, with an image/page ref) — mirroring the
notice-plan contract. Required-but-missing or ambiguous **dates** force a clarification (§4), never an
invented date.

| kind | typed fields | default audience | what pinning does / does NOT do |
| --- | --- | --- | --- |
| `drawing` | `title?`, `caption` | `FAMILY` | pins the art + caption. No document claims. |
| `permission_slip` | `title`, `dueDate?`, `event?`, `signatureRequired:true` | `PARENTS_ONLY` | pins a reminder. **Does NOT sign or submit.** |
| `report_card` | `term?`, `date?` | `PARENTS_ONLY` | pins privately. Parents-only by default. |
| `appointment_card` | `title?`, `date?`, `startTime?`, `place?` | `PARENTS_ONLY` | pins a reminder. **Does NOT book.** |
| `other` | `caption` | `PARENTS_ONLY` | pins the image + caption only. |

`report_card` and any document image default to **PARENTS_ONLY**. `audience` is an explicit field on
the proposal with the allowed options; a wider audience is a deliberate parent choice, re-bound at
confirm (§5).

## 4. Response `200`

```jsonc
{
  "status": "READY",                     // "READY" | "NEEDS_CLARIFICATION"
  "clarification": null,                 // { "question": string } when NEEDS_CLARIFICATION
  "classification": { /* §2 */ },
  "asset": { "assetId": "pma_…", "mimeType": "image/png" },
  "extracted": { /* typed per kind, §3; each field { value, source } */ },
  "audience": { "selected": "PARENTS_ONLY", "options": ["PARENTS_ONLY","FAMILY","CAREGIVERS"] },
  "suggestions": [                       // shown WITHOUT claiming any record was created
    { "kind": "appointment", "text": "Looks like an appointment on 2026-11-20. Pinning does not book it; a calendar entry needs a separate, verified contract (not created)." }
  ],
  "proposal": {                          // the confirm envelope (opaque to the client; echoed to confirm)
    "proposalId": "pin_…", "version": 1,
    "expiresAt": "2026-11-03T13:15:00-05:00",
    "claims": { /* SignedClaims, §5 */ }, "signature": "<hmac>"
  }
}
```

`NEEDS_CLARIFICATION` → `clarification` set, `proposal: null`; `extracted` carries what was read
(unknown required fields null). Dates that cannot be resolved against the explicit Detroit reference
date return **one** clarifying question, never a guess.

## 5. Separate parent confirmation — bound + re-authorized + idempotent

`POST /api/rosina/pin/confirm` `{ claims, signature }` (claims echoed verbatim from the proposal).

The signature binds, and confirm re-derives, **all** of:
`{ callerId, childId, assetId, captionHash, fieldsHash, audience, kind, version, expiresAt }`
— so a changed caption, a changed field, a **changed audience**, a different kind, a different child,
a different asset, or a different caller all invalidate the token.

Server steps (each a hard gate):
1. Verify the HMAC over the exact claims with `callerId` taken from the **authenticated** bearer (not
   the body) — caller binding.
2. **Re-authorize** the caller as parent/guardian of `childId` **at confirm time** (not trusting the
   proposal), and re-check access to `assetId` (§6). Failure → generic `403` (no oracle).
3. Expiry → `410`; a tampered field/caption/audience → `400`.
4. **Idempotent pin:** the pin key is `(callerId, childId, assetId, version)`. A retry / double-click
   returns the **same** pinned note, never a second. (Mocked here with an in-memory keyed store; the
   real store enforces it — §7.)
5. **Uploaded text is untrusted content, never instructions** — the caption and any extracted text are
   treated as data at every step; nothing in them changes classification, audience, or authorization.

Pinning writes **only** the pinned note (image ref + caption + fields + audience, bound to caller +
child). It does **not** create a to-do, calendar entry, signature, or submission (§7).

## 6. Private media design

- **Authorization on access, every time.** `assetId` resolves to bytes only for a caller authorized
  for that asset's child; a non-owner, a wrong child, and a missing asset all answer identically (no
  oracle). No ambient/"anyone-with-the-id" access.
- **No public bucket for private uploads.** Private media is never placed in a public bucket or behind
  an unauthenticated URL.
- **Upload limits + safe MIME:** allowlist `image/png`, `image/jpeg`, `image/webp`, `application/pdf`;
  decoded size ≤ **10 MB**; reject anything else (`415`) and oversize (`413`).
- **Metadata stripping:** EXIF/GPS and document metadata are stripped on ingest before storage (the
  stored asset carries no location/device metadata). Mocked here as a `stripMetadata` hook on the
  media interface; the real implementation does the strip.
- **Reset/expiry cleanup:** pinned assets are cleaned up on demo reset and on expiry; an unconfirmed
  upload expires. (The reset hook belongs to the reset owner — §7 — this task does not edit reset.)
- **Revocation semantics (documented):** access is checked **on every fetch**, so revoking a caller's
  authorization immediately stops new fetches. **Already-delivered bytes cannot be recalled** — any
  client cache or previously issued **short-lived** signed URL remains usable until it expires.
  Therefore: signed URLs (if the real store uses them) MUST be **short-TTL and per-fetch**, never
  long-lived; the contract does not hand out durable URLs. Revocation = no new grants of access;
  it is not retroactive deletion of bytes a caller already holds.

## 7. Dependency boundaries (what this task does NOT own)

| Capability | Owner / status |
| --- | --- |
| Pin persistence table + RLS, private media bucket/storage, reset cleanup | **Bentley / teacher-persona SQL+reset** — NOT changed here. This slice mocks them behind interfaces. |
| To-do creation, calendar/appointment booking, slip signing/submission | **Separately verified contracts — do not exist yet.** This slice only *suggests*; it never claims these records were created. |
| The note propose→confirm persistence shape | Coordinated with the **school-report note contract** (migrations 0070–0073): same propose → stage → separate-confirm posture. This slice's confirm is a **stateless HMAC envelope** (no new SQL) pending the real table. |
| SAM (Segment Anything) auto-crop | **Research only (§8).** Manual crop / original-image fallback is the default; no paid SAM call without separate authorization. |

## 8. SAM (auto-crop) — research only

SAM could auto-segment the artifact from a messy photo (crop the drawing off the fridge/table). For
this task: **availability/contract research only**, no integration, no paid call, no usage claim.
Findings are recorded in the PR; the shipped default is **manual crop or the original (uncropped)
image** — the pipeline never depends on SAM, and a SAM integration would be a separate, authorized
task with its own cost controls.

## 9. Public-demo sample documents

Demo samples MUST contain **readable fictional text in the actual image/PDF** passed to Muse —
blank artwork with browser-only overlay text is **not** a valid extraction proof. Samples are
rendered from exact HTML → PNG/PDF (local render, no model/stack call) under
`web/public/samples/pin/`, clearly fictional.

## 10. Errors (bounded)

`401 UNAUTHENTICATED` · `403 UNAUTHORIZED` (not parent/guardian, or not authorized for the asset;
generic) · `400 INVALID_REQUEST` / `INVALID_PROPOSAL` (malformed body or tampered claims) · `413
PAYLOAD_TOO_LARGE` · `415 UNSUPPORTED_MEDIA_TYPE` · `410 PROPOSAL_EXPIRED` · `409 ASSET_CHANGED`
(asset no longer accessible at confirm) · `422` (nothing to confirm).
