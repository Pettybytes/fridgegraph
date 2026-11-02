# Invitation UI aligned to PR #130's committed fixture

This is a local fixture proof, not a live Muse Image generation or a served backend call. The UI fixture PNG was generated directly from `src/rosina/inviteFixture.ts` at [PR #130 head `c427cd2`](https://github.com/Pettybytes/fridgegraph/pull/130). Its SHA-256 is `911503bf5bf8463faa9d6ebb05f92506ce1579bc73c8b2c8584ba4a2ff13e066`. The UI uses the same 1024×1024 dimensions and quiet area `{x:96,y:600,w:832,h:328}`, plus the committed example event (Nora, Birthday party, November 15, 2026, 2–4 PM Detroit, Maple Hall) and the backend art-only prompt hash. The old hand-authored sample SVG was removed because it no longer represents the PNG.

The UI response type now accepts the backend's `{ question: string }` clarification object. The error mapper recognizes its `error` field and `400 INVALID_REQUEST`. These changes were checked against [the unmerged contract](https://github.com/Pettybytes/fridgegraph/blob/feat/rosina-invites-backend/docs/contracts/invites.md); they do not claim the endpoint is served.

Playwright Chrome exported the card at 1440×1000 and 390×844. Both downloaded PNGs have the PNG signature, 1024×1024 dimensions, and dark footer pixels. They are byte-identical (SHA-256 `85392f6f3fade0ca32c432af815dc07080f1a3ba5b5c25f8b99d12b5c68cde7f`). I inspected the exported card: the event lines and **Sample art** footer fit inside the reserved quiet area. The 390px on-screen full-card preview is small because the art is square and the quiet area occupies its lower third; the editable text fields and full-resolution downloaded PNG remain readable.

- [Desktop exported PNG](desktop-export.png) · [desktop light](desktop-light.png) · [desktop dark](desktop-dark.png)
- [Phone exported PNG](phone-export.png) · [phone light](phone-light.png) · [phone dark](phone-dark.png)
