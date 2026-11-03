# FridgeGraph brand mark — rendered proof

Replaces the placeholder `Sprout` icon (lucide-react) with an original French-door fridge
silhouette. Full design rationale and the reusable/export file manifest: `docs/brand/README.md`.
Design-contract entry: `docs/contracts/design.md` §11.

Captured against the built app (`npm run build && npx vite preview --port 4799`), via
`capture.mjs` (Playwright/Chromium).

## Captures

| File | What it shows |
| --- | --- |
| `sidebar-light.png` / `sidebar-dark.png` | The sidebar/header brand mark, inside a Kendra persona session, both themes. |
| `picker-light.png` / `picker-dark.png` | The persona picker header brand mark, both themes. |
| `tab-light.png` / `tab-dark.png` | Browser-tab proxy — see note below. |
| `size-comparison-16-24-40.png` | `FridgeMarkSimple` at 16px beside `FridgeMark` at 24px and 40px, confirming the heart is present only where it reads and the silhouette/seam/handles carry the mark at every size. |

**Tab proxy note.** Headless Chromium has no API to screenshot real OS browser-tab chrome. These
two renders show the exact `favicon.svg` content plus the page's real `<title>` ("FridgeGraph",
also fixed by this PR — it was the Vite default "web") at realistic tab scale, with each capture
taken under Playwright's `colorScheme: 'dark'`/`'light'` emulation so the favicon's own embedded
`prefers-color-scheme` media query actually switches, the same mechanism a real browser uses. It's
an honest proxy, not a literal screenshot of browser UI.

## Known pre-existing gap, not introduced here

`picker-dark.png` shows the persona cards themselves not fully styled for dark mode (the "Demo
guide" card's body text is low-contrast). This app has no runtime dark-mode toggle yet — nothing
currently wires `prefers-color-scheme` to the `.dark` class the CSS defines (`docs/contracts/
design.md`'s token sets are ready, unused in production so far) — so this capture forced the class
directly to exercise the CSS, surfacing a pre-existing incompleteness in the picker cards' own
dark styling. The brand mark itself renders correctly in both captures. Out of scope for this PR
(brand mark only); noted here rather than silently worked around.

## Monochrome check

The mark is pure stroke/fill geometry with no color-dependent detail (no gradient, no
multi-hue layering like the old favicon) — rendering it in `forced-colors`/grayscale reduces
cleanly to the same silhouette/seam/handles/heart shapes, confirmed by inspection of
`docs/brand/fridgegraph-mark.svg`.
