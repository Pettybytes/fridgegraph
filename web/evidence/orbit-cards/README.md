# Orbit alert cards — evidence

Two cards, one component tree: the red **ACTIVE** takeover and the green **FOUND SAFE** payoff.
Both are rendered by the production components (`web/src/features/orbit/AlertTakeover.tsx`,
`OrbitResolution.tsx`, `OrbitConstellation.tsx`, `OrbitConfetti.tsx`) through the existing
controlled offline harness `web/scripts/orbit-alert-review.html?mode=recipient`.

**What these images are.** A controlled, fictional fixture driven by the real `OrbitController`
and the real `OrbitView`. The harness mocks the adapter, so no auth, graph or photo endpoint is
contacted — the capture script asserts `backendCalls === 0`. They prove layout, contrast, the
state transition and the confetti against the real component code. They are **not** a capture of an
authenticated live alert; the app's demo login points at the shared project database, which this
task was not allowed to touch.

## Files

| File | What it shows |
| --- | --- |
| `desktop-active.png` | ACTIVE card, 1440×900, light |
| `desktop-active-dark.png` | ACTIVE card, 1440×900, dark |
| `desktop-active-detail.png` | ACTIVE card scrolled to the child, place/time and response actions |
| `desktop-found-safe-confetti.png` | FOUND SAFE while the one-shot confetti is in flight |
| `desktop-found-safe.png` | FOUND SAFE settled |
| `desktop-found-safe-dark.png` | FOUND SAFE, dark |
| `phone-active.png` | ACTIVE card, 390×844 |
| `phone-active-dark.png` | ACTIVE card, 390×844, dark |
| `phone-found-safe-confetti.png` | FOUND SAFE with confetti, 390×844 |
| `phone-found-safe.png` | FOUND SAFE settled, 390×844 |
| `phone-found-safe-dark.png` | FOUND SAFE, 390×844, dark |
| `active-to-found-safe.webm` | ACTIVE → recorded FOUND_SAFE close: red layer fades into green, the check draws, confetti releases |
| `provenance-prefix-run.txt` | last-seen provenance proof, pre-fix schema (0087 absent): the defect is served |
| `provenance-postfix-run.txt` | the same proof after 0087: unprovenanced time refused and withheld |

`capture.mjs` writes every image and the recording; `node web/evidence/orbit-cards/capture.mjs`
against `web` dev server on port 5199. It also asserts, per viewport and state: no horizontal text
spill, no sideways document overflow, every response/close target ≥ 44 px, two constellation
status rings on ACTIVE and one found-safe ring, and zero backend requests.

## The provenance runs

`ops/orbit-provenance-proof.mjs` connects only to a loopback disposable Postgres
(`postgres://postgres@127.0.0.1:55437/postgres`, `postgres:16-alpine`, trust auth, container
`fg-orbit-ts-proof`) and refuses any non-loopback host. It calls the real SQL functions as
`authenticated` with JWT claims: `draft_orbit_share`, `preview_orbit_share`,
`activate_orbit_alert`, `respond_to_orbit_alert`, `close_orbit_alert`, `orbit_share_for`,
`orbit_place_for`, `orbit_thankyou_for`.

A stock Postgres proves SQL semantics only. It does **not** reproduce Supabase RLS, PostgREST
argument coercion, JWT verification or the router; those remain unproven here and are named as such
in the task report. 0087 is **staged, not applied** to the project database.
