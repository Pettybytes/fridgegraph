# Fridge asset provenance

Service: Higgsfield. Model: GPT Image 2.5 (Flare variant). Generated 2026-11-02.

Collage scenes and blank invitation were generated using fictional cast reference images from the same service. They are labeled collectively “Sample family collage.” No app persona identity is assigned to them.

PNG metadata contains job IDs but no prompts: prompt on file with Bryan.

| Supplied file | Destination stem | Job | Original size |
| --- | --- | --- | --- |
| `Using-the-young-babysitter-from-the-firs.png` | `reading` | `ae8810ed-d45e-40ef-9abc-ec7801875e5f` | 2048×1360 |
| `Photorealistic-interior-photograph-of-a.png` | `fridge-front` | `fb6d31a4-448f-4702-9df4-7792b65620d1` | 2336×3504 |
| `Using-the-two-teenage-brothers-and-the-8.png` | `autumn` | `ae9c6c2e-e18f-4e61-9197-6796f777814a` | 2048×1360 |
| `Using-the-8-year-old-girl-from-the-first (1).png` | `soccer` | `03796a1c-b436-4e8b-8020-7c31c607cb5c` | 2048×1360 |
| `Using-the-8-year-old-girl-from-the-first.png` | `sprinklers` | `02446304-93cf-4dc3-80ed-a430a134f6cd` | 2048×1360 |
| `Using-the-8-year-old-girl-from-the-first (2).png` | `baking` | `b9fcc945-56d0-4d26-b88c-8a1ebac1421a` | 2048×1360 |
| `Using-the-father-from-the-first-referenc.png` | `school-hug` | `9c37b7de-9460-4d86-b1fa-b04845d63f5e` | 2048×1360 |
| `Top-down-photograph-of-an-elegant-blank.png` | `invitation` | `e5703cd9-15b6-46bc-a7ba-be4d1316fbe1` | 1792×2240 |
| `Using-the-mother-and-8-year-old-girl-fro.png` | `classroom` | `59f0c9f2-9ee2-47ad-84a5-e30db6bc1859` | 2048×1360 |
| `Using-the-same-mother-and-8-year-old-dau.png` | `sofa` | `842cbdaf-dc22-45cd-96e7-e68b7d114848` | 2048×1360 |

Edits: RGB conversion, proportional Lanczos resizes and WebP encoding (quality 90). No image generation, retouching or crop. The fridge original is also retained as fridge-front.png. CSS frames and DOM invitation text overlay the assets without altering them.

## Local handwriting fonts and original magnets (visual revision)

Kalam Regular and Bold: Copyright (c) 2014, Indian Type Foundry. SIL Open Font License 1.1, reproduced in `fonts/OFL.txt`. Unmodified TTF files obtained from https://github.com/google/fonts/tree/main/ofl/kalam. Served from this app's own `/fridge/fonts/` path; no Google Fonts CSS or third-party font requests.

Apple, school bus, A+, star, heart and flower: original SVG paths drawn in `web/src/features/fridge/Magnet.tsx` for this feature. No external icon assets or generation service. Decorative only.

## Approved Ellison art pack — distinct provenance

Only `packs/ellison/` is Muse Image artwork: model `muse-image-1.0`, supplied in PR #154 at fb91e9cbbe04adfe8f3a2dc880d40287527baf64. All 12 originals retain their verified source SHA-256 hashes. Full prompts, prompt hashes, generation timestamps and derivative hashes are in `packs/ellison/provenance.json`; original creative manifest is preserved as `source-manifest.json`.

Edits: proportional Lanczos resizes to 360, 720 and 1024 pixels wide, RGB conversion, WebP quality 90. No regenerated or retouched content. CSS framing and DOM sample text are presentation only. Bryan's approval mounts this pack by recorded child ID p_nora and explicitly retains the generic sample fallback for other families; that supersedes the older creative manifest's pilot-only/empty-fallback notes. Art is decorative, never an authorized family record or evidence of permission, signature, consent, availability or booking.

The kitchen refrigerator, generic sample scenes and invitation retain the Higgsfield provenance above; they are not credited to Muse.
