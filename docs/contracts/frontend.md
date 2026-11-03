# Contract — frontend (`web/`)

Applies to anything under `web/`. Stack: Vite 8 · React 19 · TypeScript 7 · Tailwind v4 · shadcn/ui · Apollo Client 4 · Supabase JS 2 · D3 7 · react-force-graph-2d · react-map-gl 8 + MapLibre 6 · Motion 14 · GSAP 3 · Lenis · Three 0.186 · Vanta 0.5 · Spline.

## 1. The one rule about motion

**Never run two animation systems inside one component without a written reason in the PR.**

Pick by intent:

| Need | Use | Do not use |
| --- | --- | --- |
| Multi-step, tightly timed choreography | GSAP + `@gsap/react` | Motion |
| State transitions, layout, enter/exit, gestures | Motion (`motion/react`) | GSAP |
| Ambient background depth | Vanta (one instance) | a second animation system |
| Smooth scroll | Lenis, one instance at app root | per-component scroll hacks |
| Programmed 3D | Three | Spline |
| Designer-authored 3D scene | Spline | Three |

## 2. Boundaries

- **GraphQL**: Apollo Client is the only transport. No second client, no `fetch` to the graph.
- **Data viz**: D3 owns computation and custom rendering. The signature Living Village uses a deterministic SVG/DOM portrait composition (Bryan’s explicit 2026-10-31 direction), with fixed relationship-group positions and no force-layout jitter. `react-force-graph-2d` remains only in the separately tested legacy graph. MapLibre owns geography. Never let two of them own the same visual.
- **Maps**: MapLibre is the default renderer. Mapbox is optional. Never assume a Mapbox token exists.
- **shadcn/ui**: components are owned source in `src/components/ui`, editable, styled in FridgeGraph's own identity. Not a themed third-party look.
- **Catalogs** (React Bits, Kokonut UI): copy-paste then own it. Not runtime dependencies. React Bits' upstream licence is `NOASSERTION` — read it before copying any file.
- **Spline**: hosted assets. Must degrade gracefully offline; never the only path to critical UI.

## 3. Environment

- Frontend gets **`VITE_*` publishable values only**: `VITE_GRAPHQL_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_MAPBOX_TOKEN`.
- **`VITE_` means "compiled into the browser bundle".** Treat every `VITE_` value as public. A service-role key, DB URL or server secret in `web/` is a security defect.
- `web/.env.example` lists names only, no values. A root `.env.example` is also tracked, names only — see `AGENTS.md` §4.
- Demo perspectives: the browser calls `POST /api/demo/login` and holds only the returned access token and actual expiry in memory. Renewal calls the same endpoint; no browser Supabase client, refresh token, persistence, or sign-out/revoke. The server enforces permissions. Current contract: `docs/evidence/39-persona-sessions.md` and HANDOFF. Apollo sends the current perspective’s bearer to the graph; it never holds a server credential.

## 4. Build and verify

```bash
npm --prefix web run build     # tsc -b && vite build — must pass
npm run check                  # repo secret scan (root)
```

Any visual claim needs a real browser check via `playwright-cli` — not a screenshot from memory, not "it should look right".

## 5. Known defects and version traps

Documented so nobody re-discovers them the hard way.

1. **shadcn wrote components to the wrong place.** On `setup/web-scaffold`, shadcn created literal directories `web/@/components/ui/button.tsx` and `web/@/lib/utils.ts` while `tsconfig` maps `@/*` → `./src/*`. So `@/components/ui/button` resolves to `web/src/components/ui/button` — **which does not exist**. The build passes only because nothing imports the button yet. **Fix before the first UI task:** move `web/@/components` → `web/src/components`, `web/@/lib` → `web/src/lib`, delete `web/@`, confirm `import { Button } from '@/components/ui/button'` compiles.
2. **TypeScript 7 removed `baseUrl`.** Path aliases must be `paths`-only. `baseUrl` fails with `TS5102`.
3. **Tailwind v4 has no `tailwind.config.js`.** Tokens are declared with `@theme` in `src/index.css`.
4. **Motion 14 exports React bindings from `motion/react`.** `import { motion } from 'motion'` does not resolve.
5. **Vanta 0.5 does not export effects from its root.** Import deep paths (`vanta/src/vanta.birds`). No conflict with Three 0.186 — verified by bundling.
6. **Vite:** prefer `import.meta.dirname` over `__dirname` (the native config loader warns).

## 6. Definition of done for a frontend change

1. `npm --prefix web run build` passes.
2. `npm run check` passes.
3. The change was exercised in a browser through `playwright-cli`, and you said what you saw.
4. No secret, no `VITE_` server value, no copied code with an unread licence.
