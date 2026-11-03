# Village pulse v2 · Dreemzy visual port

All FridgeGraph captures use the **controlled fictional fixture** in `web/village-pulse-preview.html`; the page makes no live API calls. Its ten pickup jobs, statuses and fixed 6:42 PM successful-read timestamp are fixture values. The live component uses the signed-in perspective's existing caller-scoped reads and records the time of a successful request read.

## Side by side

- [Desktop: Bryan's Dreemzy reference alongside FridgeGraph](side-by-side-desktop.png)
- [390px phone: Bryan's Dreemzy reference alongside FridgeGraph](side-by-side-phone.png)

The reference frames were rendered locally from Bryan's `DreemzyDashDemo.tsx` solely for visual comparison. They retain its **synthetic marketing metrics and LIVE badge** as reference material, never as FridgeGraph data. The source's remote background and logo were replaced in the comparison harness with Bryan's supplied local `pulse-backdrop.jpg` and a local placeholder mark. The harness was not added to the PR. The FridgeGraph frames contain only the documented fictional pulse fixture.

## FridgeGraph captures

| Viewport | Light | Dark |
| --- | --- | --- |
| 1440 × 900 | [desktop-light.png](desktop-light.png) | [desktop-dark.png](desktop-dark.png) |
| 390 × 844, first page | [phone-light.png](phone-light.png) | [phone-dark.png](phone-dark.png) |
| 390 × 844, second page | [phone-light-page-2.png](phone-light-page-2.png) | [phone-dark-page-2.png](phone-dark-page-2.png) |

[6.9-second parallax recording](parallax.webm): actual browser mouse movement and scrolling in the fixture preview. The preview page was given extra top spacing in the browser for the scroll demonstration; product code was unchanged.

## Calculation and visual review

The 30 Detroit creation dates are grouped into six five-day stream bins, colored by each job's **current recorded status**. The smooth stream joins those recorded bin totals; the daily table gives exact dates. Weekday bars count the same cohort by Detroit creation weekday. The gauge is distinct jobs with a contact attempt recorded divided by requests, with no target. The approval ring counts explicit parent confirmations and currently pending approvals without confirmation; other jobs are outside the ring. Open-item tiles use current visible pending-job and independently read Orbit status. No caregiver response-time, proposal metric, ranking, or alert payload is rendered.

The reference structure is preserved: local full-bleed image, spring mouse parallax, scroll-linked card reveal, 800px glass dashboard, 4-column tile grid, icon chips, stream/gauge/donut/bars/ring/open-status visuals, count-up/arc draw-in, and a phone swipe carousel with dots. Desktop-only parallax and spatial reveal stop on mobile and under reduced motion. The app does not copy reference deltas or random live-value fluctuations because no recorded data supports them.

Rendered review found the first pass too tall on phones and too faint over the brightest part of the photo. The chart labels were shortened while preserving full status names in the calculation popover and accessible titles; the mobile card was centered and tightened. The photo overlay was darkened so white text over the brightest sampled tile background reaches at least 5.0:1 in the captured phone fixture. Functional icon labels, links and error text stay textual. The reference's glass-within-glass layout and small tracked tile headings are intentional per Bryan's explicit direction; visual review flags those as nested cards and tiny text, so this port records the tradeoff rather than silently changing the source composition.
