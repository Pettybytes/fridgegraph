# web/TOOLBOX.md

One line per library: what it is for, and where it stops.

**Rule: never run two animation systems inside one component without a written reason in the PR.**

## Core

- **Vite** — dev server and production bundler for `web/`. Boundary: build tooling only; no app logic lives in config.
- **React 19** — component runtime for the whole app. Boundary: no state-management library is chosen yet.
- **TypeScript 7** — type checking via `tsc -b` in `build`. Boundary: type-level only; do not use it to encode runtime validation.
- **Tailwind CSS v4** — utility styling, wired through `@tailwindcss/vite` in `vite.config.ts`. Boundary: design tokens live in the `@theme` block in `src/index.css`, not scattered hex values.
- **shadcn/ui** — app component primitives (Radix-based, `style: radix-nova`, copied into `src/components/ui`). Boundary: components are owned source you may edit, styled in FridgeGraph's own visual identity — not a themed third-party look.
- **Apollo Client** — GraphQL client for the single router endpoint. Boundary: the only place GraphQL transport, caching and error policy are configured.
- **GraphQL** — schema/query language package required by Apollo. Boundary: no second GraphQL client.
- **Supabase JS** — client for auth and browser-safe Supabase access. Boundary: publishable (anon) key only — never a service-role or DB URL.
- **`@playwright/test`** — end-to-end and visual-regression harness. Boundary: dev dependency; tests live outside `src`.

## Data visualization

- **D3** — custom, data-driven visuals (scales, axes, custom SVG/canvas encodings). Boundary: D3 owns *computation and custom rendering*; it must not be the layout engine for graphs that `react-force-graph-2d` already handles.
- **react-force-graph-2d** — the Living Village graph (Obsidian Person Network style: portraits, role orbits, organic layout). Boundary: the village graph only; geographic views belong to MapLibre.
- **react-map-gl + MapLibre GL** — the Geographic Map view. MapLibre is the **default** renderer; Mapbox is optional and must not be assumed. Boundary: maps show geography only — no graph semantics.

## Motion and 3D

- **GSAP (+ @gsap/react)** — choreographed, timeline-driven sequences (multi-step, tightly timed producer-controlled animation). Boundary: choreography, not per-render state transitions.
- **Motion** — React transitions, layout animation, enter/exit, gesture-driven micro-interaction (import from `motion/react`). Boundary: component-level state animation; do not hand-build what `motion` already expresses.
- **Lenis** — smooth scroll normalization. Boundary: one instance, owned at app root; components never instantiate their own.
- **Three** — custom 3D scenes and shaders. Boundary: when the scene is programmed by us, not designed in Spline. Import via `three` + `@types/three`.
- **Vanta** — selected ambient animated backgrounds only (e.g. subtle depth behind a hero). Boundary: ambient backdrop never primary UI, and never alongside a second background animation. **Import effects from deep paths** (`vanta/src/vanta.birds`), because the root entry does not expose effect modules; verified bundling with `three@0.186`.
- **@splinetool/react-spline** — designer-authored 3D scenes exported from Spline. Boundary: designed scenes only; custom shader/geometry work belongs to Three. Spline scenes are hosted assets, so they must degrade when offline.

## Copy-paste catalogs (not dependencies)

- **React Bits** — copy-paste animated components. Boundary: source pasted in and owned by us; not installed as a runtime dependency.
- **Kokonut UI** — copy-paste Tailwind/shadcn-compatible pieces. Boundary: same as React Bits — pasted, then adapted to shadcn tokens.

## Known version boundaries

- `motion` v14 exports React bindings from `motion/react`; a bare `import { motion } from 'motion'` does not resolve.
- Tailwind v4 has no `tailwind.config.js`; theme tokens are declared with `@theme` in CSS.
- TypeScript 7 removed `baseUrl`; path aliases must be `paths`-only and resolve relative to the tsconfig.
