# PR #121 — GitHub README rendering check

The page inspected was GitHub's rendered, authenticated private-repository README, not a local Markdown preview. Source: `docs/readme-story-pass`, with the final diagram at `e976974`. The four first-screen captures were taken at `4129e48`; `e976974` changes only the lower workflow diagram. Browser: Chrome, GitHub light default or dark default, desktop 1920 × 1080 window with an approximately 904 px README column, and DevTools mobile emulation at 376–393 px.

| Render | Capture | Observation |
| --- | --- | --- |
| Light desktop | [light-desktop.png](light-desktop.png) | Wordmark, family promise, Meta Muse and models, linked badge navigation and role cards visible. |
| Dark desktop | [dark-desktop.png](dark-desktop.png) | Same hierarchy and contrast; the animated SVG advanced through proposal and parent approval. |
| Light phone (376 px) | [light-phone.png](light-phone.png) | Promise, readable Meta Muse/model line, wrapped navigation and full-width role card. |
| Dark phone (393 px) | [dark-phone.png](dark-phone.png) | Promise, Meta Muse/model line and cards readable. GitHub's `#readme` anchor landed partway into the hero, so this crop does not show its wordmark. |
| Final workflow | [workflow-dark.png](workflow-dark.png) | GitHub rendered the color-styled Mermaid flow with all five nodes and the separate parent confirmation readable; the earlier horizontal version had its last node obscured by GitHub controls and was replaced. |
| Product proof | [proof-dark.png](proof-dark.png) | Both committed browser frames are readable: review of the transcribed notice and recorded request with “Pickup is not arranged yet.” |

All images above were cropped to the GitHub README pane, excluding browser tabs, URL, account menu and unrelated content. They are screenshots of the rendered page, not new product states. The product screenshots inside the README come from the [live sample-(a) browser receipt](../../../web/evidence/notice-plan/live-2026-11-02/RECEIPT.md).

The animated hero advanced on GitHub from disconnected inputs through a proposal to a solid connection after the displayed parent approval. A complete [static SVG](../../assets/readme/hero-static.svg) is linked next to the sandbox status and embedded SVG CSS disables its animation for `prefers-reduced-motion: reduce`. The authenticated browser closed during the DevTools reduced-motion emulation check, so **GitHub's reduced-motion rendering was not verified**. No claim of that check passing is made.

Local path/link existence check found no missing README targets. `npm run typecheck`, `npm run check`, and `git diff --check` passed during this docs-only pass. Exact-head GitHub CI is reported separately on PR #121. GitHub appearance was returned to its original **Sync with system** setting after the light/dark checks.
