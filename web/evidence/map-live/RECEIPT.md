# Village map — SLOT B read-only browser receipt

Run: 2026-11-02 05:55–06:12 UTC, inside Bentley's #78 reservation (05:35–06:40 UTC). Real picker-issued demo sessions. No writes, jobs, confirms, resets, seeds, shared-service restarts, HAR, traces, videos, storage snapshots, or request-header logs.

## Served revisions

- Isolated Vite preview: `feat/web-map-live-adapter` on port 5210, `VITE_VILLAGE_MAP_LIVE=true`. Initial UI `41307de`; route/day correction `18c8444`; final guide boundary `f57bfa4266be35379a62b3c8ba8ff84fe83174b0`. HMR served each committed revision after its commit. Shared 5189 was untouched.
- Graph/demo 4001–4008: main `e99be47`, pid 47998. Routers 4010/4012: pids 50674/50708, composed artifact `93506905e3310283a16987e3…` from 4001–4007. MCP 5051: pid 56537, 13 operations, authorization forwarding. Rosina 4200: main `e99be47` with #118, pid 54300. Shared UI 5189: pid 64228, GraphQL proxy to 4012.
- Bentley's preflight: migration 0081 applied, cast checksum `f022ccf8311e7561`, stack HEALTHY. No database change during this UI run.

## Browser results

| Picker perspective | Live map read | Route and cost | Capture pair |
| --- | --- | --- | --- |
| Kendra — READY | Nora's Sep 1 School day links to Lincoln Elementary School by exact recorded place ID `rp_cf07653bee9c`, distinct from another place with the same label. Nov 4 Parent-teacher conference has no linked place; the UI says so. Five authorized places have coordinates. People have no returned person-place association and remain list-only with “No location provided for this person in this map.” | Authorized Maple Grove Park → the linked school: Drive 4.47 mi / 11 min; Walk 4.07 mi / 79 min; Bike 4.61 mi / 26 min. Each says “Estimated — not live traffic”; no route was linked to a person or pickup. No paid-ride estimate is recorded for Nora after reset, so stored amount, basis and cap are **untestable** without creating a job, which this slot forbids. | `kendra-desktop-map.png`, `kendra-phone-map.png` |
| Loretta — READY | Same five place labels, coordinates withheld; no pins. School day label remains visible. | Zero enabled route origins, no route card, no amount/basis/cap section. | `loretta-desktop.png`, `loretta-phone.png` |
| Priya — READY | Same five place labels, coordinates withheld; no pins. School day label remains visible. | Zero enabled route origins, no route card, no amount/basis/cap section. | `priya-desktop.png`, `priya-phone.png` |
| Dana — READY | Today lists only Jax after the canonical reset. Her authorized Jax map renders. Nora is absent from “Children shared with you,” so a Dana → Nora map refusal cannot be triggered through the browser's child focus. Backend reset receipt says the Dana/Nora relationship is DISCOVERED with zero grants; this UI does not substitute Nora or grant a route. | No recorded Jax paid-ride amount. Nora cost and map refusal remain **pending**. | `dana-jax-desktop.png`, `dana-jax-phone.png` |
| Demo guide — READY | The final UI refuses Nora's child-specific geographic map before rendering a world. The refusal is generic: “This isn't shared with you.” No other perspective's map is substituted. | No route or cost. | `guide-refusal-desktop.png`, `guide-refusal-phone.png` |

Extra captures: `kendra-people-desktop.png` shows unlocated people; `kendra-unlinked-desktop.png` shows the unlinked event. Earlier exploratory captures remain in this directory and are superseded by the named final pairs. `WITHHELD` place coordinates were exercised by Loretta/Priya; no seeded event with event `placeState=WITHHELD` was found, so that event-state variant remains an offline test only.

## Checks and status

- Focused village-map tests: **26/26 PASS** on final source. Root typecheck PASS; web build PASS; root `npm run check` **0 findings**. A filename-only scan for JWT marker, bearer, token field, or authorization text in this evidence directory and Playwright's temporary output returned no matches.
- Full web suite on final source: **451/452 passed, 1 failed**. The unrelated `personaCalendar.test.tsx` test “switches Kendra to Rosa without old calendar records or details surviving” cannot find the “Autumn music recital” button after switching. The same test fails alone. Its assertion was not edited or weakened.
- PR #87 remains **DRAFT**. Browser integration is partial: the seeded cost is absent, Dana cannot focus Nora after reset, and the full test gate is red. No ready claim is made.
