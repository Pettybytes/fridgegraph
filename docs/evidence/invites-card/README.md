# Invitation card UI — fictional fixture proof

This proof uses the self-contained `/invites-preview.html` development page and the local `FIXTURE` response. The image is hand-authored sample art, not Muse output. The live `/api/rosina/invite` path and the backend fixture were not available when this UI was built. No backend or shared-stack call was made.

The Playwright test at `web/e2e/invites-card.spec.ts` ran in Chrome at 1440×1000 and 390×844. It edited the occasion, checked that the canvas pixels changed while the art was fetched once, captured light and dark views, clicked **Download PNG**, and saved the downloaded file. Both exports have the PNG signature and 1000×1400 dimensions. Their SHA-256 is identical (`1ee6215293ea9f7fe3efb7354928429fc0e6f7083be4e1dfc9bf586b8c7cf32e`), showing viewport width does not change the card pixels. I visually inspected the exports for complete wrapping inside the reserved quiet area.

- [Desktop light](desktop-light.png) · [desktop dark](desktop-dark.png) · [desktop exported PNG](desktop-export.png)
- [Phone light](phone-light.png) · [phone dark](phone-dark.png) · [phone exported PNG](phone-export.png)

The card's request is a fixed sample; its text is not interpreted. The editable fields are drawn by the browser over the art. Editing them does not generate art or create a record. Real Muse credit appears only for a response whose provenance source is `MUSE_IMAGE`.
