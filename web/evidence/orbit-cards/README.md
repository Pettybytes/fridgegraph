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
| `provenance-prefix-run.txt` | last-seen provenance proof, pre-fix schema (0089 absent): the defect is served |
| `provenance-postfix-run.txt` | the same proof after 0089: unprovenanced time refused and withheld |
| `provenance-prefix-fresh-2026-11-03.txt` | **authoritative** independent re-run on a brand-new loopback container (0001–0086 from scratch): 14/14, defect served |
| `provenance-postfix-fresh-2026-11-03.txt` | 0089 applied to that same fresh container, proof re-run: 16/16, unprovenanced time refused at write and withheld at read |

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
in the task report. 0089 is **staged, not applied** to the project database.

### Capture notes (resumed run, 2026-11-03)

All images and the recording were regenerated against the final source. The capture asserts
`backendCalls === 0`, no clipped text, no sideways document overflow, every response/close target
≥ 44 px, two constellation rings on ACTIVE, one found-safe ring, and confetti particles present
(72 desktop / 36 phone).

One real defect was found and fixed in this run: the side confetti particles started at the 4%/96%
edges and were given an **outward** horizontal offset, so they left the viewport on the first frame
and only the 18 centre halo particles survived — the burst read as a thin diagonal streak. The
offset sign is now inward, and the stills/recording show particles spanning both edges of the card.

> Numbering note: this migration is **0089**, not 0087. It was renamed from `0087_orbit_last_seen_provenance.sql`
> because #187 independently reserves `0087_outreach_dispatch.sql`. The recorded runs in the `.txt` evidence
> files were produced from the same SQL under its former number and are left unedited as historical records.
