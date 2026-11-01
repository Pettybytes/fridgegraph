# Evidence 64 — content-rich fixture through the real photo-descriptors path

**Date:** 2026-11-01 · **Window:** W-PHOTO-64 · **Serving code:** Rosina `539a8b4` (pid 20096), graph `405f7a7`
**Receipt:** `64-photo-descriptor-authority.json` — **23/23 PASS**
**Preserved untouched:** evidence `63` (blank 1×1 fixture) and `63-…-run01-failed.json`

## Fixture and its provenance
`docs/evidence/fixtures/fictional-child-yellow-raincoat.jpg` — a **fictional test fixture**, committed
under evidence, **not** app art and never shipped in `web/`. Provenance is recorded in
`fixtures/PROVENANCE.md` and only where the generating receipt supports it: tool `image_generate`,
model **`google/gemini-3.1-flash-image`**, and the prompt as sent. Seed, sampler, exact timings are
marked **unknown**. **No Muse attribution**: `muse-image-1.0` was not verified in this session, and
this run establishes nothing about an in-product image-generation feature.

Stored through the ordinary upload path: 362,754 bytes on disk → **79,141 bytes** after the endpoint's
`sips` re-encode and segment strip.

## What the model returned, and how it compares to the image
| Proposed | In the child's 55-entry vocabulary | Visible in the fixture |
|---|---|---|
| `wearColor: yellow` | yes | **yes** — yellow raincoat |
| `carryColor: red` | yes | **yes** — red backpack |
| `carryItem: backpack` | yes | **yes** — red backpack |

**Nothing was dropped as off-vocabulary in this run** (the earlier blank-image run's off-vocabulary
drop was injected by the offline stub, not by the model).

**Omissions, reported rather than smoothed over:** the illustration also shows **braided dark hair**
and the **raincoat as a garment**, and the model proposed **neither** `hair` nor `wearGarment`. Three
of five descriptor kinds were populated; two were simply absent. That is legitimate — unknown stays
unknown and nothing is forced — but it is an omission, not a full description. The envelope also
carries `textInImage`; this run did not assert its contents.

## The other cases, unchanged
- Priya (unauthorized) → **403** `NOT_AUTHORIZED`.
- A **real ACTIVE alert** with a frozen audience of 3 → the AUDIENCE recipient gets the **same,
  byte-identical 403**.
- Recipient photo **viewing** during that ACTIVE alert → **200 `image/jpeg`**, `X-Orbit-Access:
  AUDIENCE`, all 79,141 bytes; unknown photo still **404**.
- Offline counting-stub layer unchanged: **0 vision invocations** on every refusal, with the success
  path incrementing the counter once (positive control).
- The proposal is **review-only**: no alert created, Orbit state unchanged. The proof closed the alert
  it activated, then ran the ordinary demo reset.

## What this does and does not establish
It proves the authorization gate, the vocabulary filter and the review-only envelope against a real
image and a real model call — and that the same image reaches a parent and not a recipient. It does
not establish model description quality in general: one fixture, three of five kinds, no
adversarial or low-light cases.
