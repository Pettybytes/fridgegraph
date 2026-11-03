# Village pulse v2 visual review

These are **controlled fictional fixture** captures from `web/village-pulse-preview.html`; the preview makes no live reads. The 10 fixture pickup jobs exist only to exercise dated status groups, bars, and open-item tiles. The displayed refresh time is a fixed fixture timestamp. The production pulse records the time of a successful caller-scoped request read.

| Viewport | Light | Dark |
| --- | --- | --- |
| 1440 × 900 | [desktop-light.png](desktop-light.png) | [desktop-dark.png](desktop-dark.png) |
| 390 × 844, requests | [phone-light.png](phone-light.png) | [phone-dark.png](phone-dark.png) |

Additional mobile panels: [recorded counts](phone-dark-counts.png), [open items](phone-dark-open.png).

The plot groups each request's Detroit creation date by its **current recorded status**. It does not reconstruct status changes. Response time, proposal metrics, gauges, donut and funnel are absent because supported calculation contracts are not available. Open Orbit status remains subject to the independent read/error boundary.

Rendered review: the first phone plot had unreadable date labels, so the plot now uses a compact SVG viewBox and shorter date labels. The first carousel made the open-items view as tall as the chart, so it now follows the active panel height. Nested tiles created excess depth, so the open items use dividers. The remaining Impeccable `cream-palette` finding points to the app's established warm-paper `--fg-canvas` token, required by `docs/contracts/design.md`; no new beige palette was introduced. The neutral gradient gives the glass panels a stable backdrop without using external media.
