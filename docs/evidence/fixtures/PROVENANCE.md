# Fixture: fictional-child-yellow-raincoat.jpg

A **fictional test fixture** for the photo-descriptors proof. Not app art, not a real person, never
shipped in `web/`.

Recorded only where the generating receipt supports it:

| Field | Value | Source |
|---|---|---|
| Tool | `image_generate` (OpenClaw media tool) | the generation task's own completion event |
| Provider/model | `google/gemini-3.1-flash-image` | stated in that completion event |
| Prompt | "Flat vector illustration of a fictional 7-year-old girl with braided dark hair, wearing a bright yellow raincoat and carrying a red backpack, standing against a plain light grey background, full body, simple cartoon style, no text, no logos" | the request as sent |
| Aspect ratio requested | 3:4 | the request as sent |
| Seed / sampler / exact pixel size / generation timestamp | **unknown** | not exposed to this session |
| Branding | **none** — no Muse, no product attribution | not claimed |

**This is not a Muse Image fixture.** The verifying model for `muse-image-1.0` was not available to
this session, and nothing here should be read as evidence of an in-product image-generation feature.
Any Muse attribution would be invented provenance.
