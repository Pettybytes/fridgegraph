# Judge checklist — standalone layout proof

This is a **mock layout preview**, not an integrated app route. The preview at `/demo-checklist-preview.html` passes fictional availability flags and makes no model or backend call. It starts with Kendra viewing Nora. Voice and photo are hidden in these captures because their readiness flags are false. The component can show them only when integration passes true flags.

The notice step uses the committed `Try a sample` asset. Its source says **Monday, October 26, 2026**, dismissal **12:30 PM**; the scenario records Nora's pickup at **3:00 PM** that day. The checklist calls this a historical sample. [Evidence 67](../67-rosina-notice-briefing-live.md) records the conflict and the resulting pickup-request action; a request is not an arranged pickup.

Playwright Chrome captured the parent preview at 1440×1000 and 390×844 in light and dark, plus the separate read-only Demo guide preview at both widths. Four browser tests checked that the notice and evidence link rendered, voice/photo were hidden, no horizontal overflow occurred, dismiss/reopen worked, the guide showed only its read-only step, and no `/api/` request was made.

- [Desktop light](desktop-light.png) · [desktop dark](desktop-dark.png)
- [Phone light](phone-light.png) · [phone dark](phone-dark.png)
- [Demo guide desktop](guide-desktop.png) · [Demo guide phone](guide-phone.png)

The photo sample at `web/public/samples/demo-checklist/fictional-outfit.png` is byte-identical to `scripts/fixtures/fictional-outfit.png` (SHA-256 `59650ade6120091f98965d19deff8055e93eab7e96f43e70ba485551caa1ed78`). Its [sample-kit provenance](../../../web/public/samples/demo-checklist/PROVENANCE.md) preserves the source credit and the unknown creation method. No image model is credited without evidence.
