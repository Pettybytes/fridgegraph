# Portraits — reimagined cast for Muse Image

**Status: FULL SET GENERATED (37 portraits) + ONE PACK (12 assets) — AWAITING SHEET REVIEW.**
**Nothing integrated, nothing merged, no backend or routing change.** The current 16 portraits are
still the ones the app serves; they are **placeholders** and this document no longer says anything
about preserving them. The pilot was approved on 2026-11-02 and its three images are retained in
the full set.

Provenance split, kept explicit:

- The **current 16** were produced with ChatGPT image generation. They are **not Muse**.
- The **pilot 3** were produced with **`muse-image-1.0`** on 2026-11-02, 3 successful calls, 0 retries.
  `web/src/components/fg/portraits.ts` still carries the old ChatGPT provenance note and must be
  updated only when the approved set is actually integrated.

---

## Superseding note (2026-11-02)

This document **supersedes** the earlier "preserve established appearances" instruction and the
pilot-only plan recorded at `e9ede1b`. That direction is retired, not deleted: the prior text remains
in git history at `e9ede1b`, and the current file records the replacement rather than overwriting
history silently. The completed work is **37 reimagined portraits** plus **12 Ellison pack assets**,
staged under `docs/evidence/154-portraits/` and `docs/evidence/154-pack/`. Nothing is integrated.

---

## 1. Inventory and cast reconciliation

Measured against `src/fixtures.ts` and `src/fixtures-cast-v2.ts` on branch `docs/portraits-prep`.

| Item | Value |
| --- | --- |
| People in the cast (excluding the demo guide) | **37** |
| Existing portrait files | **16** PNGs in `web/src/assets/portraits/` |
| Size | 384×384 |
| Missing artwork | **21** people have no file and render a monogram today |
| Manifest | `web/src/components/fg/portraits.ts` (`PORTRAIT_BY_PERSON`, 16 entries) |
| Excluded | `p_demo_guide` — a demo affordance, not a person in the cast |

The 37 reconcile exactly to the fixture rows, with **no added people, no changed birthdays, no
renames and no altered relationships**. Ages below are as of **2026-11-02** from the recorded birth
dates in the fixtures.

### Cast table (person ID is authoritative)

| Person ID | Name | Age | Group / written appearance anchor |
| --- | --- | --- | --- |
| `p_dad` | Andre Ellison | 40 | Ellison — Black |
| `p_walter` | Walter Ellison | 71 | Ellison — Black |
| `p_gloria` | Gloria Ellison | 67 | Ellison — Black |
| `p_tasha` | Tasha Ellison | 36 | Ellison — Black |
| `p_mom` | Kendra Ellison | 38 | Brooks — white |
| `p_gma` | Loretta Brooks | 68 | Brooks — white |
| `p_bryan` | Bryan Brooks | 42 | Brooks — white; **fictional character**, not the project owner |
| `p_nora` | Nora Ellison | 8 | Kendra & Andre's child — mixed race (Black/white) |
| `p_max` | Max Ellison | 13 | Kendra & Andre's child — mixed race (Black/white) |
| `p_leo` | Leo Ellison | 16 | Kendra & Andre's child — mixed race (Black/white) |
| `p_dana` | Dana Coleman | 39 | Coleman — white |
| `p_ray` | Ray Coleman | 40 | Coleman — white |
| `p_jax` | Jax Coleman | 8 | Coleman — white |
| `p_dwayne` | Dwayne Ferris | 41 | Ferris — Black |
| `p_cassandra` | Cassandra Ferris | 34 | Ferris — Black |
| `p_malik` | Malik Ferris | 9 | Ferris — Black |
| `p_simone` | Simone Lee | 38 | Lee — Korean-American |
| `p_denise` | Denise Lee | 37 | Lee — Korean-American |
| `p_micah` | Micah Lee | 10 | Lee — Korean-American |
| `p_avery` | Avery Lee | 7 | Lee — Korean-American |
| `p_rosa` | Rosa Castellano | 64 | Castellano — Mexican-American |
| `p_tomas` | Tomás Castellano | 66 | Castellano — Mexican-American |
| `p_emma` | Emma Castellano | 8 | Castellano — Mexican-American |
| `p_felicia` | Felicia Reyes | 37 | Reyes — Colombian-American |
| `p_taylor` | Taylor Reyes | 10 | Reyes — Colombian-American |
| `p_skye` | Skye Reyes | 7 | Reyes — Colombian-American |
| `p_marcus` | Marcus Reyes | 47 | Colombian; youth soccer coach; resident adult in Taylor/Skye's household |
| `p_oscar` | Oscar Alvarez | 47 | Latino (Colombian); neighbour |
| `p_priya` | Priya Nair | 23 | Indian-American; sitter/nanny |
| `p_okafor` | Daniel Okafor | 35 | Nigerian-American; substitute teacher |
| `p_price` | Angela Price | 44 | Black; teacher |
| `p_monique` | Monique Davis | 39 | Black; parent friend |
| `p_evelyn` | Evelyn Carter | 66 | Black; grandmother |
| `p_whitfield` | Ms. Whitfield | 42 | White; 3rd-grade teacher |
| `p_jennings` | Carol Jennings | 51 | White; school nurse |
| `p_holt` | Gary Holt | 58 | White; bus driver |
| `p_chris` | Chris Harlan | 41 | White; parent friend |

### Relationships that must survive (read from the fixtures, not inferred)

- `p_mom` and `p_dad` are Nora's parents; `p_leo` and `p_max` are her brothers; `p_gma` is her
  grandmother on Kendra's side, `p_walter` and `p_gloria` are her grandparents on Andre's side;
  `p_bryan` is her uncle; `p_tasha` is her aunt and godmother.
- School/activity circle around Nora: `p_price` teacher, `p_okafor` substitute, `p_jennings`
  school nurse, `p_holt` bus driver, `p_marcus` coach, `p_monique` and `p_chris` parent friends,
  `p_priya` sitter, `p_whitfield` teacher.
- Coleman: `p_dana` and `p_ray` are Jax's parents; `p_evelyn` is his grandmother; `p_price`,
  `p_okafor`, `p_marcus` also serve Jax.
- Castellano: `p_rosa` and `p_tomas` are Emma's guardians.
- Reyes: `p_felicia` is Taylor's and Skye's guardian; `p_marcus` is their step-parent and a
  resident adult in that household.
- Lee: `p_simone` and `p_denise` are Micah's and Avery's guardians.
- Ferris: `p_dwayne` is Malik's guardian; `p_cassandra` is his aunt; `p_oscar` is his neighbour;
  `p_priya` is his nanny.

Shared written appearance anchors for related people (used in prompts, and the basis of continuity
for later batches):

- **Ellison, Black:** Andre 40, Walter 71, Gloria 67, Tasha 36 — natural Black hair, warm brown
  skin, strong family resemblance between Andre and his parents.
- **Brooks, white:** Kendra 38, Loretta 68, Bryan 42 — Kendra is Loretta's daughter; Bryan is
  Kendra's brother. Same family, same general colouring, different ages and lives.
- **Kendra & Andre's children, mixed race:** Nora 8, Max 13, Leo 16 — visibly siblings, Black and
  white parentage, shared features across the three.
- **Coleman, white:** Dana 39, Ray 40, Jax 8.
- **Ferris, Black:** Dwayne 41, Cassandra 34, Malik 9.
- **Lee, Korean-American:** Simone 38, Denise 37, Micah 10, Avery 7.
- **Castellano, Mexican-American:** Rosa 64, Tomás 66, Emma 8.
- **Reyes, Colombian-American:** Felicia 37, Taylor 10, Skye 7; Marcus 47 and Oscar 47 are
  Colombian, not members of Felicia's household except Marcus, who is her partner/step-parent.

"Shared anchor" means a written description used in every prompt for that family. It does **not**
mean the model is given a reference photo. No real-person reference is supplied to any model.

### Resolution rules that must survive any replacement (currently enforced in code)

1. `PORTRAIT_BY_PERSON` is keyed by **person ID** and the ID **decides**.
2. An unknown ID returns `undefined` → **monogram fallback**, and never falls through to a name. A
   newly created child named "Nora" must not inherit Nora Ellison's face.
3. `PORTRAIT_BY_FULLNAME` is an **exact** full-name safety net used **only when there is no ID**.
   Never a first-name match.
4. Removing a mapping line is the documented way to fall back to a monogram — replacements must not
   break that property.
5. Integration maps by **person ID only**, never by first name, and keeps the monogram fallback.

**Consuming surfaces** (7 files import the manifest; each must be re-checked after any swap):
`features/orbit/Orbit.tsx`, `features/village-map/VillageMap.tsx`,
`features/village-map/labelLayout.ts`, `features/village-map/MapCanvas.tsx`,
`components/signature/layout.ts`, `components/signature/SignatureVillageRoute.tsx`,
`components/fg/primitives.tsx`.

---

## 2. Direction — REIMAGINE the whole cast

This replaces the earlier "preserve established appearances" instruction, which applied to
placeholders that are being retired. The 16 current portraits are **not** continuity references for
the new set. They are replaced wholesale.

Non-negotiables that do **not** change:

- **Fictional people only.** No real-person reference photographs are supplied to any model, and
  none will be. The standard is **no real-person reference and no intentional impersonation** — not
  a generic "does not resemble anyone" claim, which is neither achievable nor meaningful.
  **Bryan Brooks is a fictional character**, not the project owner.
- **Identity is not inferred from names.** Art is joined by person ID; the name net is exact-only
  and secondary. Nothing in the pipeline may guess an identity.
- **Monogram fallback stays.** Every consumer must still render a person with no artwork.
- **No provenance inflation.** ChatGPT art is never called Muse; Muse art is never claimed before a
  successful call returns and is recorded.
- **Children are the sensitive case.** The replacement set stays in **one photoreal direction**. The
  children are reimagined under the same direction as the adults; there is no separate style for
  minors and no illustrated/photoreal mix.

---

## 3. Art direction — one family album, not one studio

**Goal:** portraits that look like real photographs of real people, taken in their own lives, and
that belong together as one set. Not a uniform studio shoot, and not a stock-photo collage.

- **Format:** candid natural-light portrait, head and shoulders, square 1:1.
- **Background:** each person gets a background from their own life, **softly blurred** — e.g. a
  front porch, a kitchen, a soccer field, beside a school bus, a classroom, a campus sidewalk, a
  garden, a park, a backyard, a living-room couch.
- **Light:** varied and natural — golden hour, window light, overcast. No fixed key direction, no
  studio strobe.
- **Camera:** modest angles — straight-on, slight three-quarter, slightly above or below eye level.
  Normal portrait compression (≈ 50–85 mm feel), shallow but gentle depth of field; the face stays
  fully sharp.
- **Clothing:** ordinary, varied, consistent with the person's life. No uniforms with insignia.
- **Props:** optional accents, not a checklist — a dog's ear, a mug, glasses pushed up, a backpack
  strap, a ball. Some portraits simply show a person enjoying a moment, with no prop at all.
- **Expression:** natural, warm, unposed. Not a marketing smile, not a neutral mugshot.
- **PHOTO COHERENCE:** believable skin texture (pores, fine lines, freckles, sun spots where age
  implies them), natural colour, comparable photographic quality across the set, so the 37 read as
  one family album rather than 37 productions.
- **AVATAR-SAFE:** head and shoulders; face unobstructed; roughly centred with margin; recognisable
  at 32/48/96 px circular crops. No sunglasses, no face-covering hats, no heavy face shadows.
- **Exclusions:** no text, lettering, logos, brands, insignia, watermarks, or recognisable
  characters. No other people in frame.
- **Accessibility:** the face must stay legible at 384² and at avatar sizes down to ~32 px.

---

## 4. Prompt template

One prompt per person, built from that person's row in §1 plus a life detail:

```
Photorealistic candid portrait photograph of <age>-year-old <written appearance anchor>,
head and shoulders, face unobstructed and centred with generous margin around the head,
looking toward the camera with <natural expression>. <Light description> in a softly
blurred <background from their life> behind them. <Camera angle>, <lens> feel, shallow
but gentle depth of field with the face fully sharp. <Hair>, <clothing>, <optional prop>.
Believable real skin texture with natural colour and fine detail, no beauty retouching,
no plastic sheen. Square 1:1 composition. No sunglasses, no hat, no heavy shadows on the
face, no text, no lettering, no logos, no brand marks, no other people.
```

Continuity rule: related characters share the written anchor from §1 in every prompt. Once a
portrait is approved, **that portrait becomes the continuity reference for later generations of the
same person**, and any new image of that person must match it.

---

## 5. Pilot — 3 images, then STOP

The pilot exists to test the direction before spending on 34 more images, and to test the hardest
cases in the same pass: an adult woman, a mixed-race child, and an older woman.

| | |
| --- | --- |
| Subjects | **`p_mom` Kendra (38)**, **`p_nora` Nora (8)**, **`p_gma` Loretta (68)** |
| Model | `muse-image-1.0` |
| Request | `n: 1`, `size: "1024x1024"`, `response_format: "b64_json"` |
| Output | 3 images, originals retained, plus one labelled contact sheet |
| Budget | 3 × $0.01 = **$0.03** at Bryan's stated per-image price |
| Review gate | see below |

**Pilot outcome:** approved by Bryan on 2026-11-02. The three pilot images are reused unchanged in
the full set; the remaining 34 were generated under the same direction. No provider fallback was
used or is automatic.

### Review gate

1. Each reads as a believable candid photograph, not a studio headshot.
2. The three read as **one album** despite different lives, light and backgrounds.
3. Face unobstructed and recognisable at 32, 48 and 96 px circular crops.
4. Nora reads as a mixed-race child who could plausibly be Kendra's daughter with Andre.
5. Loretta reads as 68, not 78 and not 58.
6. No text, logo, brand mark or insignia; no real-person reference or intentional impersonation.
7. Monogram fallback and ID-keyed resolution stay untouched (no code changed in this phase).

---

## 6. Results (2026-11-02)

### Pilot (approved)

| Subject | Result | Bytes | Attempts | Notes |
| --- | --- | --- | --- | --- |
| Kendra | **200 OK**, `muse-image-1.0` | 402,920 | 1 | kitchen window, mug, straight-on |
| Nora | **200 OK**, `muse-image-1.0` | 441,388 | 1 | golden-hour porch, denim jacket, slight three-quarter |
| Loretta | **200 OK**, `muse-image-1.0` | 388,646 | 1 | overcast garden, glasses pushed up, slightly above eye level |

### Full set + Ellison pack

| Item | Value |
| --- | --- |
| Portraits returned | **37** (3 pilot + 34 new) |
| Fridge-pack assets returned | **12** |
| Total images delivered | **49** |
| Generation calls | **53** (49 delivered + 4 re-prompts) |
| Retries | **0** |
| Failed calls | **0** |
| Cost | **$0.53** total at $0.01/image (49 delivered + 4 revisions; no price field in the response) |

- Every portrait is 1024×1024; 384² downscales are staged alongside.
- Assets, contact sheets, four mock compositions (desktop and phone, populated / empty / refused),
  a person-ID integration map and per-image provenance are staged at
  `/Users/user/.openclaw/workspace/portrait-pilot/`.
- **No integration.** No file in `web/src/assets/portraits/` changed, no manifest line changed, no
  consumer touched, no HANDOFF edit, no merge.

---

## 7. Request contract — now verified by a successful call

From `docs/contracts/invites.md` and confirmed by the pilot:

```
POST ${META_BASE_URL}/images/generations      (META_BASE_URL=https://api.meta.ai/v1)
Authorization: Bearer ${META_API_KEY}          (server-side only; never logged, never returned)
body: { model: "muse-image-1.0", prompt: <art-only>, n: 1,
        size: "1024x1024", response_format: "b64_json" }
```

The three pilot calls returned `200` with `data[0].b64_json` and `model: "muse-image-1.0"`. The
earlier caveat — that the shape followed the OpenAI-compatible Images convention and had not been
verified against Meta — is **resolved for this request shape by observation**, not by documentation.
The endpoint accepted it and returned images; no other shape was tested.

Operational rules used: key read from the environment file in place (never printed, copied into the
script, or logged), response handled in memory, `b64_json` written only to the output file, output
hashed and recorded.

---

## 8. Cost

- **Actual: 53 generation calls × $0.01 = $0.53** (49 delivered assets + 4 approved re-prompts),
  zero retries (Bryan's stated price; no price field in the provider response).
- **Hard cap: $10 total** for portraits and packs, separate from Wonder.
- Any `usage` object returned by the provider is recorded verbatim in the provenance record.
- If Muse disappoints, the result is reported and **GPT Image is a reviewed fallback Bryan decides
  on — never automatic.**

---

## 9. Provenance record (per generated image)

`provider`, `model`, full request parameters, UTC timestamp, prompt SHA-256, response image SHA-256,
output path, reviewer, review outcome. Plus one line stating whether the call succeeded — **no Muse
claim before a successful call**.

For this pilot the record is `portrait-pilot/provenance.json`, one entry per image.

---

## 10. Out of scope here

- No batch beyond the 3-image pilot, no spend beyond $0.03.
- No image replacement, no manifest edit, no consumer change.
- No provider fallback without Bryan's decision.
- No `docs/handoff/HANDOFF.md` edit (per the standing rule) and **no merge**.
