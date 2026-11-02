# Portraits — preparation for a replacement set

**Status: PREPARATION ONLY. Nothing generated. No paid call made. No image replaced.**
**No Muse usage is claimed anywhere in this document.** The current artwork was produced with
ChatGPT image generation and is explicitly *not* Muse — `web/src/components/fg/portraits.ts` says so
in its own provenance note, and that labelling must not drift.

---

## 1. Inventory (measured at `db66009`)

| Item | Value |
| --- | --- |
| Portrait files | **16** PNGs in `web/src/assets/portraits/` |
| Size | 384×384 (downscaled from the supplied originals) |
| Style | photorealistic headshots, including the fictional children |
| Source | AI-generated, supplied and approved by Bryan; **ChatGPT, not Muse** |
| Manifest | `web/src/components/fg/portraits.ts` (59 lines) |

Exact files: `Andre, Angela, Bryan, Chris, Dana, Evelyn, Jax, Kendra, Leo, Loretta, Malik, Nora,
Priya, Ray, Tasha, Walter`.

**Person-ID mapping** (`PORTRAIT_BY_PERSON`, 16 entries — the authoritative join):

| ID | Name | | ID | Name |
| --- | --- | --- | --- | --- |
| `p_nora` | Nora Ellison | | `p_dana` | Dana Coleman |
| `p_malik` | Malik Ferris | | `p_ray` | Ray Coleman |
| `p_mom` | Kendra Ellison | | `p_evelyn` | Evelyn Carter |
| `p_dad` | Andre Ellison | | `p_walter` | Walter Ellison |
| `p_gma` | Loretta Brooks | | `p_price` | Angela Price |
| `p_priya` | Priya Nair | | `p_chris` | Chris Harlan |
| `p_tasha` | Tasha Ellison | | `p_jax` | Jax Coleman |
| `p_bryan` | Bryan Brooks | | `p_leo` | Leo Ellison |

**Resolution rules that must survive any replacement** (currently enforced in code):

1. `PORTRAIT_BY_PERSON` is keyed by **person ID** and the ID **decides**.
2. An unknown ID returns `undefined` → **monogram fallback**, and never falls through to a name. A
   newly created child named "Nora" must not inherit Nora Ellison's face.
3. `PORTRAIT_BY_FULLNAME` is an **exact** full-name safety net used **only when there is no ID**.
   Never a first-name match.
4. Removing a mapping line is the documented way to fall back to a monogram — replacements must not
   break that property.

**Consuming surfaces** (7 files import the manifest; each must be re-checked after any swap):
`features/orbit/Orbit.tsx`, `features/village-map/VillageMap.tsx`,
`features/village-map/labelLayout.ts`, `features/village-map/MapCanvas.tsx`,
`components/signature/layout.ts`, `components/signature/SignatureVillageRoute.tsx`,
`components/fg/primitives.tsx`.

---

## 2. Non-negotiable constraints

- **Fictional people only.** No real-person reference photographs are supplied to any model, and none
  will be. No resemblance to a real individual is a goal.
- **Identity is not inferred from names.** Art is joined by person ID; the name net is exact-only and
  secondary. Nothing in the pipeline may guess an identity.
- **Keep the current portraits until a replacement is generated, reviewed AND integrated.** No
  deletion, no silent overwrite, no "temporary" swap committed.
- **Monogram fallback stays.** Every consumer must still render a person with no artwork.
- **No provenance inflation.** ChatGPT art is never called Muse; Muse art is never claimed before a
  successful call returns and is recorded.
- **Children are the sensitive case.** The existing set is photorealistic, minors included. A
  replacement set should *not* increase realism for the child characters. Recommendation: keep the
  existing child portraits, or move children to a clearly illustrated style; do not generate new
  photoreal children without an explicit decision from Bryan.

---

## 3. Art direction

One coherent studio, so the picker and the village do not look like a collage of stock photos:

- **Framing:** head-and-shoulders, centred, consistent crop at 1:1; eyes on the upper third.
- **Lens/camera:** consistent focal feel (≈ 85 mm portrait compression), shallow but not extreme
  depth of field.
- **Lighting:** one key from camera-left, soft fill, same direction in every frame; no dramatic
  rim lighting.
- **Background:** the same neutral mid-tone studio backdrop for all adults; slight tone shift per
  family only if needed for separation.
- **Expression:** calm, neutral, eyes to camera. No exaggerated emotion — these are identity chips,
  not marketing shots.
- **Colour:** restrained palette that survives both light and dark UI; no strong colour cast that
  fights the app tokens.
- **Exclusions:** no text, lettering, logos, brands, uniforms with insignia, or recognisable
  characters. No props that imply a real occupation credential.
- **Accessibility:** face must remain legible at 384² and at avatar sizes down to ~40 px.

## 4. Prompt template

```
Studio portrait of a fictional adult, head and shoulders, centred, eyes to camera,
calm neutral expression. 85mm portrait lens feel, soft key light from camera-left,
gentle fill, neutral mid-tone seamless backdrop, muted natural colour, no colour cast.
Photorealistic but plainly generic — not resembling any real person.
Square 1:1 composition with even margin around the head.
No text, no logos, no brands, no uniforms or insignia, no props, no other people.
```

Per-person variation is applied **only** through neutral, non-identifying attributes (age band,
build, hair length/colour, clothing tone) held in a small table — never through ethnicity or any
trait that could map to a real individual.

## 5. Pilot proposal — ONE image, before any batch

| | |
| --- | --- |
| Subject | **`p_walter` (Walter Ellison)** — an adult, so the pilot avoids the children question entirely |
| Model | `muse-image-1.0` |
| Request | `n: 1`, `size: "1024x1024"`, `response_format: "b64_json"` |
| Output | one image, downscaled to 384² for review, original retained |
| Review gate | (a) reads as the same character as the current Walter; (b) no resemblance to a real person; (c) matches the art direction; (d) monogram fallback untouched; (e) all 7 consuming surfaces still render |

**Nothing else is generated until the pilot is reviewed.** One image, one call.

## 6. Request contract — repo-declared, and self-flagged as unverified

From `docs/contracts/invites.md:79-84`:

```
POST ${META_BASE_URL}/images/generations      (default https://api.meta.ai/v1)
Authorization: Bearer ${META_API_KEY}          (server-side only; never logged, never returned)
body: { model: "muse-image-1.0", prompt: <art-only>, n: 1,
        size: "1024x1024", response_format: "b64_json" }
```

**That same document warns, in its own words, that the shape "follows the OpenAI-compatible Images
convention the repo's Meta provider mirrors for chat", that Meta's image docs "were not fetched",
and that the request shape, supported sizes and usage terms "must be reconfirmed against Meta's docs
and cited here before `INVITE_LIVE=1` is enabled."**

So: the *repo-declared* contract is verified as **what the repo says**; it is **not** verified
against Meta. Reconfirming it is a precondition of the pilot, not an optional nicety.

Operational rules for the eventual call: key from the environment only (never copied into a script,
never echoed), response handled in memory, `b64_json` never written to logs, output hashed and stored
under the portraits asset path with a provenance record.

## 7. Cost — UNVERIFIED, and bounded rather than guessed

**There is no pricing data in this repository.** Nothing in `docs/`, `src/`, or `.env.example` states a
per-image price for `muse-image-1.0`. `INVITE_GENERATION_BUDGET` defaults to **50** (`src/rosina/server.ts:58`)
but that is a *generation-count* budget for invites, not a price, and not evidence about Muse Image.

Therefore this plan **does not state a dollar estimate**, because inventing one would be a fabricated
figure. What it does instead:

- **Hard cap: $10 total** for the preparation phase.
- **Pilot = exactly 1 image.** No batch before the pilot is reviewed.
- **Before the pilot call**: confirm the provider's current price for `muse-image-1.0` at
  `1024x1024`, record it with its source, and **abort if the projected cost exceeds $10**.
- **Full set (16) is a separate decision** that requires the measured per-image price; if
  16 × price > $10, stop and report rather than proceed.
- Any usage/`usage` object returned by the provider is recorded verbatim in the provenance record.

## 8. Provenance record (per generated image)

`provider`, `model`, full request parameters, UTC timestamp, prompt SHA-256, response image SHA-256,
output path, reviewer, review outcome. Plus one line stating whether the call succeeded — **no Muse
claim before a successful call**.

## 9. Out of scope here

- No generation, no spend, no key handling in this document.
- No image replacement, no manifest edit, no consumer change.
- No `docs/handoff/HANDOFF.md` edit (per the standing rule) and **no merge**.
