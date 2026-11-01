# FridgeGraph design system

How to build FridgeGraph surfaces with the shared tokens and primitives. This is the
**usage** reference; the **rules** (quality gates, anti-slop, motion budget, corners,
copy, Rosina, phone showcase) live in [`docs/contracts/design.md`](../contracts/design.md)
and win wherever the two disagree.

Everything here is implemented in `web/src`. Nothing in a surface should hard-code a
hex colour, a radius, a duration, or a z-index — reach for a token.

---

## 1. Where things live

| Thing | Path | Import |
| --- | --- | --- |
| Tokens (CSS) | `web/src/index.css` | automatic (global) |
| Tokens (JS) | `web/src/styles/tokens.ts` | `@/styles/tokens` |
| Primitives | `web/src/components/fg/primitives.tsx` | `@/components/fg/primitives` |
| Rosina avatar | `web/src/components/fg/RosinaAvatar.tsx` | `@/components/fg/RosinaAvatar` |
| Phone frame | `web/src/components/fg/PhoneFrame.tsx` | `@/components/fg/PhoneFrame` |
| Portrait manifest | `web/src/components/fg/portraits.ts` | `@/components/fg/portraits` |
| Child-access context | `web/src/features/personas/childContext.tsx` | `@/features/personas/childContext` |

`cn` (clsx + tailwind-merge) is importable as `'cn'`.

---

## 2. Tokens

### Palette — runtime, theme-aware
Defined as `--fg-*` on `:root` and overridden under `.dark`; consume them (or the
shadcn bridge that points at them), never a literal colour. A literal `background: white`
or `color: #…` is the bug that makes dark mode render white-on-white.

- **Surfaces:** `--fg-canvas` (page), `--fg-surface` (card), `--fg-elevated` (raised card)
- **Text:** `--fg-ink` (primary), `--fg-muted` (secondary)
- **Lines/brand:** `--fg-border`, `--fg-primary`, `--fg-primary-hover`, `--fg-on-primary`, `--fg-accent`
- **Interaction:** `--fg-selection`, `--fg-focus`
- **Truthful status** (activation ≠ delivery — see contract §3): `--fg-onway`/`--fg-onway-ink`, `--fg-withme`/`--fg-withme-ink`, `--fg-simulated`, `--fg-real`, `--fg-attention`
- **Rosina:** `--rosina-periwinkle`, `--rosina-violet`, `--rosina-navy`, `--rosina-silver`
- **Legacy aliases** (`--fg-slate/workspace/plum/line`) exist only so older shell CSS resolves to the new tokens; don't use them in new code.

### Radius — concentric roles
`@theme` radii, outer→inner so nested corners stay concentric (inner = outer − inset):
`--radius-device` (44) › `--radius-screen` (36) › `--radius-card` (16) › `--radius-nested` (10)
› `--radius-control` (10) › `--radius-chip` (8) › `--radius-pill` (999). The shadcn scale
(`--radius-sm/md/lg/xl`) is also available for bridged components. `.fg-squircle` adds
`corner-shape: squircle` as progressive enhancement under `@supports`.

### Motion — easing + duration
Custom curves (built-in CSS easings are too weak):
`--ease-out: cubic-bezier(0.23,1,0.32,1)` (enter/exit), `--ease-in-out: cubic-bezier(0.77,0,0.175,1)`
(on-screen movement), `--ease-drawer: cubic-bezier(0.32,0.72,0,1)`.
Durations: `--dur-feedback` (140ms), `--dur-panel` (220ms), `--dur-scene` (300ms).
JS equivalents (`duration`, `easing`, `spring.default/panel/momentum`, `z`, `readToken`) are in `@/styles/tokens`.
Never `ease-in` on UI; never `transition: all`; never animate layout properties.

### Z-index — fixed scale
`--z-base` › `--z-raised` › `--z-sticky` › `--z-nav` › `--z-overlay` › `--z-modal` › `--z-toast`.
No arbitrary `z-index` values.

---

## 3. Primitives

All from `@/components/fg/primitives`. Each states its job; none is decorative.

- **`Surface`** — the card. `elevated` for a raised card, `data-pad` for padding. Resolves to `--fg-surface`/`--fg-elevated` + `--radius-card`.
- **`StatusChip`** — a truthful state. `tone` maps to a colour **and** an icon, and always carries text (never colour alone). Use for on-way / with-me / simulated / real / attention.
- **`SourceChip`** — labels where data came from (e.g. "Pickup records · sample").
- **`Avatar`** — `portraitFor({ personId, name })` → image, else a monogram. `kind="child" | "adult"`, `size`, `title`.
- **`InlineFeedback`** — an error/success line *next to the action*, with `tone`.
- **`Field`** / **`Composer`** — text input / message composer (real send button, no fake mic).
- **`IconButton`** — icon-only; **`aria-label` is required**.
- **`FgButton`** — pressable; `:active` scale feedback at `--dur-feedback`.
- **`Icon`** — the inline 1.75-stroke icon set.

`.fg-glass` is the only translucent material: `backdrop-filter` blur+saturate with solid
fallbacks under `prefers-reduced-transparency` and no-`backdrop-filter`. Use it on floating/
overlay surfaces **only** — not on every card (contract §6).

---

## 4. Rosina

`<RosinaAvatar state size src className />`. The art is a CSS viewport crop of Bryan's
approved concept board (`src/assets/rosina/rosina-board.png`, the one sanctioned in-repo
reference exception — see contract §9); it is **not** a drawn re-creation. States are
**real only**: `ready`/`calm`/`listening`/`speaking` show the Ready tile; `thinking` shows
the Thoughtful tile and must be set only while a request is genuinely pending. The state is
in the `aria-label`, never signalled by halo colour alone; the halo is the single motion and
holds still under reduced motion. Pass `src` to override with a future standalone render
(record its real tool — never label it Muse).

---

## 5. Phone frame

`<PhoneFrame label context status time bare>{screen}</PhoneFrame>` renders a device with
concentric 44→36 corners, decorative chrome, and a **persistent caption**. `status` is
`'live' | 'sample' | 'simulated'` so an embedded screen never misrepresents itself. See
contract §8 for showcase/embed requirements.

---

## 6. Identity & child context

- **Portraits:** `portraitFor({ personId, name })`. An **id decides** — an unknown id returns
  `undefined` (render a monogram) and never falls through to a name, so a new child can't
  borrow another person's art. The exact full-name net is consulted only when there is no id.
  Never a first-name match.
- **Child access:** `useChildAccess()` returns `authorized` (a fresh MyChildren read — each
  child with its **own** scopes, never unioned, read scope ≠ authority), the session home
  child, and the **separately tracked** focused child (`selectedChildId/Name` + `selectChild`,
  which no-ops for ids not in `authorized`). A focused child's name is its own `displayName`
  or "Name not shared" — never the home child's name. Handle `loading | ready | empty |
  refused | error` explicitly; `refused` is the honest state when there is no live client.

---

## 7. Composition patterns

Avoid making every section an identical rounded card (contract §3). The surfaces built here:

- **Picker** — editorial headline, a restrained Rosina introduction (not a docked panel),
  family-grouped **portrait-led** cards that say in plain words what each person can see,
  a quiet sandbox notice, Demo-guide entry read-only.
- **Today** — one dominant next action, a generous Ask Rosina composer, the children shared
  with you (a read scope, not parenthood), recorded activity (humanised — never raw enums),
  and a compact village preview. Live reads the authorized village/preview by selected child;
  mock dev shows a clearly-labelled sample and runs no live background query.
- **Rosina panel** — a launcher by default; it docks (and reserves width) **only while open**.

---

## 8. Before a visual PR

Run the gates in contract §2 (accessibility, motion performance, break-ui, Impeccable
detector on source **and** rendered, humanizer on copy, Playwright at 390×844 and 1440×900,
light and dark). Evidence is append-only under `web/evidence/design/`.
