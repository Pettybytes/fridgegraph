# Design contract

Authoritative for every `web/` visual change. When a skill and this contract disagree, this
contract wins. Read it before any `web/` work, then follow the skill for technique.

It governs look, motion, copy and the phone-showcase surface. It does not relax any
authorization, scope, wording or interaction rule from `AGENTS.md`, `docs/contracts/frontend.md`,
`ask-rosina.md`, `coordination-v2.md` or the Orbit contracts. A page that looks finished but
leaks scope, fakes a state, or skips an interaction test is not done.

Scope: `web/` only. Backend, schema, auth and data shape are out of scope here.

---

## 1. Toolkit

Installed at user/global scope on 2026-10-31. Skills are plain directories under each agent's
skill path; copying one in or removing it is the whole install or uninstall. Pins are the commit
each was taken from, so an update is a deliberate re-pull, never a silent drift.

| Tool | Job | Agents that discover it | Licence | Install / reference |
| --- | --- | --- | --- | --- |
| **impeccable** (skill + `impeccable` CLI) | Detects frontend slop in source and in a rendered page; polish/audit/critique commands. | Claude Code, Gemini, Hermes, OpenClaw (file-present for Codex) | Apache-2.0 | Skill dir from `pbakaus/impeccable@4f95649` (`.claude/skills/impeccable`). Engine binary `0.1.18`, pinned by `scripts/engine-checksums.txt`; darwin-arm64 sha256 `543ee2f72036ad185dc9991ac3ba86b74d91f988f3d497776a088b8b65c8a9e1`, cached at `~/.impeccable/bin/0.1.18/`. CLI with no agent: `npx impeccable detect <path|url>`. |
| **Emil Kowalski skills** (`animate`, `animation-performance`, `animation-vocabulary`, `find-animation-opportunities`, `improve-animations`, `remove-animations`, `review-animations`, `apple-design`, `emil-design-eng`, `break-ui`, `ask-sonner`, `pick-ui-library`, `prototype`) | Motion decisions, interaction polish, web-app design-engineering judgement, worst-case stress of a component. | Claude Code, Gemini, Hermes, OpenClaw (file-present for Codex) | MIT | `emilkowalski/skills@a81dbca`. Native-only skills (`write-swift`, `mobile-native`, `animate-expo`) were left out: this product is web. |
| **ui-skills** (`baseline-ui`, `fixing-accessibility`, `fixing-motion-performance`) | Fast deslop pass, accessibility audit/fix, animation-performance audit/fix. | Claude Code, Gemini, Hermes, OpenClaw (file-present for Codex) | MIT | `ibelick/ui-skills@b88b130`, `skills/` subtree only. The rest of that repo is its website and is not installed. |
| **humanizer** | Removes AI-writing tells from prose while keeping the meaning. | Claude Code, Gemini, Hermes, OpenClaw (file-present for Codex) | MIT | `blader/humanizer@0ef9fe5`. Chosen over `avoid-ai-writing`: a single markdown skill that preserves meaning, versus a CLI/GitHub-Action/pre-commit detector that rewrites more aggressively and is a worse fit for keeping our exact required wording. |
| **frontend-design** | General frontend design guidance (already installed, pre-dates this toolkit). | all | no upstream LICENSE | Guidance only. Do not copy its code into the repo. |
| **playwright-cli** | Drives a real browser for the rendered checks below. | all | — | Already installed. |

Deferred, not installed: Superpowers, drawio, demo-gif. Rejected: UI UX Pro Max, anime.js,
img2threejs, Backlit, the SwiftUI skills, and any second motion library (`frontend.md` §1 already
fixes Motion and GSAP as the two systems; a third would break the one-system rule).

Uninstall: remove the matching directory from each agent skill path
(`~/.claude/skills`, `~/.agents/skills`, `~/.gemini/skills`, `~/.hermes/skills`) and, for
Impeccable's engine, `rm -rf ~/.impeccable`. See the toolkit PR report for the exact list.

### What the detector writes and reaches

The Impeccable launcher runs a self-contained engine. It reaches the network only to fetch its
pinned engine binary from the project's GitHub releases, and refuses any download whose sha256 is
not in `engine-checksums.txt`. It writes only under `~/.impeccable/`. It reads `HOME` and its own
`IMPECCABLE_*` variables; it does not read `.env` or other secrets. Its plugin ships Claude Code
hooks (`SessionStart`, `PostToolUse`, `Stop`) that call the detector on edited UI files. Those
hooks are **not** enabled globally here; the quality gates below run the detector explicitly at
PR time instead, so no project gets a silent on-every-edit scan. A project may opt into the hook.

---

## 2. Quality gates for a `web/` visual PR

All four, in order. The first three produce evidence; the fourth is a written judgement.

1. **Impeccable source scan.** `npx impeccable detect web/src/<changed paths>` (or `--json`).
   Resolve or justify every finding. A per-file waiver needs a reason comment; a rule waiver
   needs `impeccable ignores add-value ... --reason`.
2. **Impeccable rendered-page check.** Run the dev server, then
   `npx impeccable detect http://localhost:<port>/<route>`. This is where low contrast and tiny
   text are caught; the source scan cannot see them.
3. **Real browser check through `playwright-cli`**, at desktop (1440×900) and mobile (390×844),
   light and dark. Say what you saw, not just that it ran.
4. **Human visual review note** in the PR: the three weakest things you found and what you did
   about them.

Passing the detector is never "done" on its own, and none of these four replaces the
authorization, scope and interaction tests that `frontend.md` §6 and the feature contracts
require. A visual PR still needs `npm --prefix web run build`, `npm run check`, and the relevant
web regressions to pass.

---

## 3. Anti-slop: every effect states its job

There is no blanket ban on gradients, glows, color or motion. The rule is that each one names its
job in the PR: **hierarchy**, **state**, **feedback**, or **orientation**. An effect that cannot
name its job is decoration and comes out.

Defaults to flag on sight, because they almost never pass the job test:

- emoji used as icons (use the real icon family)
- generic hero copy ("Welcome to the future of…")
- a purple-to-blue gradient with no reason
- centered-everything layouts
- filler stats and invented metrics
- lorem or placeholder text left in a reviewed screen
- motion that plays on load and explains nothing

A deliberate brand choice is allowed when its job is stated — FridgeGraph's indigo primary and
small coral accents are brand, used for one job each (see §6), not slop.

---

## 4. Motion

Follows `frontend.md` §1 and Emil's skills. Build motion with the `animate` skill; audit with
`review-animations` / `improve-animations`; subtract with `remove-animations`; keep it inside the
frame budget with `animation-performance` and `fixing-motion-performance`.

- **One animation system per component.** Motion (`motion/react`) for state, layout, enter/exit
  and gestures; GSAP only for multi-step timed choreography, and only with a written reason in the
  PR (`frontend.md` §1). Never both on one element.
- **Purpose test.** Animate only what explains a state change, a spatial relationship, or
  feedback. Touch and keyboard interactions stay immediate.
- **Duration and easing scale** (starting ranges; tune by watching the rendered result):
  feedback 100–160 ms; panels and navigation 180–260 ms. For the signature Village only, establish the child in 280 ms, then reveal surrounding relationships with 360 ms opacity/transform entrances staggered 45 ms after a 120 ms lead (up to 705 ms total). This is orientation, never sequential outreach; all controls work immediately. The explicit signature brief supersedes the old blanket 320 ms scene limit.
  Ease-out for enter, ease-in for exit, a standard ease for moves. No spring bounce on a serious
  or destructive action; no continuous rotation; no stagger that makes a control wait to be used.
- **`prefers-reduced-motion`** removes spatial movement and decorative pulses and keeps the state
  change readable. The reduced-motion build of any character art is still.
- No new GSAP/Lenis/Vanta/Spline in product routes; no smooth-scroll controller on chat, a
  calendar, or a feed.

---

## 5. Corners

Two mechanisms, both driven by shared CSS variables, no library.

- **Squircles** are a progressive enhancement. Apply `corner-shape: squircle` through a utility
  class guarded by `@supports (corner-shape: squircle)`. `border-radius` is the finished
  fallback; Safari and Firefox render the rounded-rect version and that is acceptable. Never rely
  on `corner-shape` for clipping, a focus ring, or layout. Review the squircle-enhanced corners in
  a browser — the concentric formula below sizes a circular radius and does not guarantee a
  matching squircle contour.
- **Concentric corners** for closely nested rounded surfaces: inner radius = outer radius − total
  inset, where total inset includes padding and border, clamped at 0. Express it with shared
  variables, e.g. `--radius-device: 48px` with an 8px inset giving `--radius-screen: 40px`. Apply
  to the phone frame and its screen, and to nested panels where the nesting is visible.

---

## 6. Apple HIG reference points

Reference, not a reskin.

- **Type**: one scale with a small, deliberate set of sizes, weights and line-heights; Geist
  Variable for app UI; tabular figures for times and counts.
- **Spacing**: an 8-pt rhythm with 4-pt microspacing used on purpose.
- **Hierarchy**: one dominant action per step; the primary action carries the indigo, secondary
  controls stay quiet.
- **Touch targets** ≥ 44 CSS px for a principal control; visible keyboard focus; labels on
  controls.
- **Color is calm**: a warm paper canvas, dark ink, one indigo primary, small coral brand
  details. Brand color and semantic/status color are separate systems and never borrow each
  other's meaning. State is always carried by text or icon as well as color.
- **Depth is restrained**: hairlines and soft shadows, not glass on every card.

---

## 7. Copy

Plain, specific language. Say the real thing. Run the `humanizer` skill over UI strings and any
README prose, and remove AI tells (not-X-but-Y contrasts, one-line closers, forced triads,
dash-everywhere rhythm, inflated claims, stock words, filler). Humanizer keeps the meaning; it
must never rewrite one of the exact required strings below.

Required wording, carried verbatim (from the HANDOFF and the Rosina/Orbit contracts):

- Recorded FREE availability reads **"free time recorded"** — never "available to watch" or "can
  pick up."
- An authorized empty result reads **"No records are available to this view."** — never "there is
  nothing" or an implication that the family is empty.
- A `SIMULATED` notification is **simulated, not delivered**. Say "simulated as notified" or
  "notified (simulated)"; never "they received it" or "delivered." `TEST_RESPONDER` →
  "Test responder"; `REAL_CONSENTED` → "Real call (consented)", styled distinctly from "Simulated"
  and never read as a real send (`frontend-data.md` §1.4).
- A scope refusal reads **"I can only help with children shared with you."** and never names,
  counts, or hints at anyone out of scope.

---

## 8. Phone showcase and embed mode (requirements the design task implements)

- **390×844** is the primary viewport. There is an **embed mode** that drops standalone app chrome
  for use inside a frame.
- The device frame is **our own**, drawn in CSS/SVG. No Apple device artwork. Its corners use the
  concentric variables from §5. Decorative frame chrome is never interactive, and the decorative
  status-bar time never feeds token-expiry logic.
- Embed params may select an **allowlisted persona/view only**. They never carry a token,
  credential or grant; they trigger the ordinary demo login and confer no authority.
  `frame-ancestors` permits the Framer domain (finalized in Task H).
- **Three frames**: "Kendra" (parent view), "Kendra · Ask Rosina" (Rosina on **Kendra's** session),
  "Loretta" (her own session). Rosina is an assistant on a persona's session; she is **never** a
  persona. Desktop shows three phones; mobile shows one phone with perspective tabs.
- **Independent per-frame state must be proven**: persona selection, renewal, reset behavior, and
  isolation across all three frames. Kendra's two frames **may legitimately share** the same cached
  server token; do not assert three distinct tokens or invent per-visitor sessions. Each frame
  makes its own authorized requests and keeps its UI/session state in memory.
- **Cross-frame updates**: bounded, visibility-aware polling only while a workflow is active —
  start around 2 s and tune by test, back off on errors, one request in flight, pause a hidden
  frame, stop when the workflow ends. Refetch with the existing bearer; never re-login to refresh
  data. Audience discovery needs a delivered authorized read or the existing refresh path — an
  idle view cannot learn about a new alert by polling a thing it does not know exists yet; if no
  discovery read is delivered, that is a backend dependency to report, not an invented API.
  Realtime is optional and only if polling cannot carry the demo.
- Reuse the real app routes and components. No second mock app.

---

## 9. Rosina character

- **Bryan's signature-art direction (2026-10-31) supersedes the earlier character restrictions.** Use the supplied approved blue-metal, stainless-silver, maid-inspired Rosina production character consistently; do not redesign her, remove her approved silhouette, or substitute a new robot. The concept board remains reference-only and never ships. A standalone approved production asset is required; until supplied, keep the existing honest avatar slot rather than crop the board.
- Use the 16 supplied **fictional, ChatGPT-generated** portraits wherever the fixture person-ID mapping has been verified. These are production assets, distinct from the mood-board screenshots. Record ChatGPT image-generation provenance accurately; never call them Muse Image output. Monograms apply only to unmapped identities or missing assets. An asset mapping supplies appearance, never permission or a new identity. Reference screenshots remain outside the repository.
- **States are real**: `ready`; `listening` only while a microphone is actually capturing;
  `thinking` only while a request is pending; `speaking` only while real audio plays; a calm,
  attentive state during Orbit. No fake waveform, no human-emotion or memory claim, no success
  gesture that implies a child is safe. The art stays consistent and legible at 32–48 px, with no
  continuous bobbing or sparkle, and a still reduced-motion version.

---

## 10. Orbit and Rosina surface rules (for the next rollout)

- Rosina reads as a capable assistant: identity, the grounded answer, the sources this answer
  returned, and the next action are each easy to tell apart. Source chips reflect **this** answer's
  real returned provenance — never a chip for a system that merely exists, never an invented
  citation. Transcript or waveform UI appears only for a real voice/audio state.
- Orbit keeps its sequence and never shortcuts it: a relevant recorded check-in → conversational
  gathering → prepare the action → the exact server preview → explicit parent activation →
  persisted responses → explicit verified-parent closure. The exact preview message is shown
  verbatim in the confirmation surface; editing it invalidates the preview and the stale-confirm
  protection stays intact. Guidance text and the "Simulated notification" label stay legible
  throughout. `ON_WAY` is a response in progress; `WITH_ME` is a reported response and never a
  closure or a verification. Orbit stays composed — no flashing red, siren, looping pulse,
  confetti, or celebratory resolution; emergency guidance stays readable without a giant red banner.
- A scope refusal never looks like an empty family, and no card return or rerender replays a
  mutation.
