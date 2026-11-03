# FridgeGraph brand mark

Replaces the placeholder `Sprout` icon (lucide-react) that stood in for a real mark since the
project's early screens. Governed by `docs/contracts/design.md` §11 — that's the authoritative
summary; this file carries the full rationale, the file manifest and how to regenerate exports.

## Design

A confident French-door fridge silhouette: a rounded outer body, a clear vertical center seam
where the two doors meet, and two handles (one per door, set just off the seam). At 24–40px a
small heart magnet sits on the lower-left door — the one piece of personality, not a literal
appliance detail.

**Two optical sizes, not one drawing scaled.** A detailed drawing shrunk uniformly to 16px loses
the seam and handles to anti-aliasing and the heart becomes an illegible smudge — a real,
longstanding icon-design problem, not a hypothetical one. So there are two source drawings:

| Variant | Component | Used at | Includes |
| --- | --- | --- | --- |
| Detailed | `FridgeMark` | 24–40px (sidebar/header, persona picker) | Silhouette, seam, 2 handles, heart |
| Simplified | `FridgeMarkSimple` | 16px (favicon) | Silhouette, seam, 2 handles — no heart, slightly heavier stroke |

Both live in `web/src/components/fg/FridgeMark.tsx`, built to lucide's own conventions (24×24
viewBox, round caps/joins, `stroke="currentColor"`, a `size` prop) so the mark sits beside the
*other*, unchanged lucide nav icons in the sidebar without a visual seam of its own.

**It is deliberately NOT lucide's stock `Refrigerator` icon.** `Refrigerator` is already the nav
icon for "The Fridge" page link, right in the same sidebar — reusing it as the brand mark too
would make the two indistinguishable at a glance, exactly the problem this PR exists to fix
("replace the sprout with an *original, recognizable* fridge icon"). The two icons are
intentionally different shapes.

**Color.** The existing indigo brand primary (`--fg-primary`) only — no new color is introduced.
For the two React components this is free: they use `currentColor` and inherit through the same
`.brand svg` / `.fg-picker-brand svg` CSS rule the old `Sprout` icon already relied on. The
favicon and the static exports (which can't inherit CSS custom properties) bake in the same
color's actual sRGB value, computed directly from the live tokens rather than eyeballed:

| Token | oklch (`web/src/index.css`) | sRGB hex |
| --- | --- | --- |
| `--fg-primary` (light) | `oklch(0.47 0.15 274)` | `#434fad` |
| `--fg-primary` (dark) | `oklch(0.64 0.16 276)` | `#7380eb` |

(The *old* `favicon.svg` was an abstract gradient blob using an unrelated bright purple
(`#863bff`/`#7e14ff`) that had drifted from the actual `--fg-primary` token entirely — replacing
it was also a chance to fix that drift, not just the shape.)

`web/public/favicon.svg` embeds both values behind a `prefers-color-scheme` media query inside the
SVG's own `<style>` — a single file that already adapts to the browser's theme, same as the rest
of the app.

## Consumers (inventoried, then replaced)

| Consumer | File | Before | After |
| --- | --- | --- | --- |
| Sidebar/header brand link | `web/src/app/Shell.tsx` | `<Sprout size={26} .../>` | `<FridgeMark size={26} .../>` |
| Persona picker brand link | `web/src/features/personas/PersonaPicker.tsx` | `<Sprout size={26} .../>` | `<FridgeMark size={26} .../>` |
| Browser-tab favicon | `web/public/favicon.svg`, declared in `web/index.html` | abstract purple blob | `FridgeMarkSimple`, light/dark aware |

Checked and found NOT to exist, so NOT added (this PR introduces no PWA and no new surface):
apple-touch-icon, `manifest.json`/`site.webmanifest`, any other declared icon size.

**Deliberately left unchanged**: `web/src/features/mission-control/pulse/VillagePulse.tsx` also
imports `Sprout` from lucide, but as a decorative header icon for the "Village pulse" dashboard
panel — not as the FridgeGraph wordmark's brand mark. It isn't one of the consumers this brief
lists (sidebar/header, persona picker, favicon/tab icons), and touching it would be the kind of
unrelated branding change the brief says not to make.

**Accessible names preserved.** Every consumer already set `aria-hidden="true"` on the icon — the
link's accessible name comes from the "FridgeGraph" text node beside it, not the icon. That didn't
change.

## Exports for Framer/video

| File | Purpose |
| --- | --- |
| `docs/brand/fridgegraph-mark.svg` | Reusable source — 24×24 viewBox, the same artwork `FridgeMark` renders, indigo baked in as a static color (no `currentColor`, since it's consumed outside this app's CSS). |
| `docs/brand/fridgegraph-mark-512.svg` | Same artwork, exported at a 512×512 viewBox for tools that want a large, fixed canvas. |
| `docs/brand/fridgegraph-mark-512.png` | Transparent 512×512 PNG raster, rendered from the 512 SVG via `web/scripts/export-brand-mark-png.mjs` (Playwright/Chromium, `omitBackground: true`) — not hand-exported, so re-running the script after any shape change reproduces it exactly. |

To regenerate the PNG after editing either SVG export:

```sh
cd web && node scripts/export-brand-mark-png.mjs
```

## Historical screenshots and evidence

Nothing under `web/evidence/` or `docs/evidence/` was rewritten or deleted — those are the
historical record of past PRs' rendered proof and stay exactly as captured, old mark and all.
This PR's own rendered proof (sidebar/picker/tab, light and dark, plus the 16/24/40px comparison)
lives in `web/evidence/brand-mark/` as a new, separate capture — see that directory's own README
for the exact list.
