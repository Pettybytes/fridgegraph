# Map live adapter preparation — offline only

Base 376d662274887498a4f357639f29c7dfb6808000.
Backend contract/source reference: 10bc43a on feat/village-map-backend.
No live requests or tokens; controlled unit responses only. No stack reservation needed.

355 tests / 60 files PASS before final date-caption derivation; focused map suite 31 PASS.
Root typecheck and web typecheck/build PASS (existing bundle-size advisory).
Contracts covered: exact ID-only proxy request; bearer renewed between requests; unsupported
Walk/Bike with zero network calls; distinct per-profile in-flight keys/results via controlled
transport; withheld coordinates; labels/IDs unchanged; malformed geometry refusal without
straight-line fallback; 401/403/404/409/429/503 outcomes; no automatic retry; late route/world
discard on generation/child switch; abort disposal; pending mode-switch race; mock/live labels
and selected child in calendar links; live proposals disabled, no synthetic ride price.

The world-reader callback is an internal frontend port awaiting a delivered transport/shape,
not an invented endpoint. Runtime still selects createMockMapAdapter. No live integration,
stored road-cost parity, mode-aware server cache or backend acceptance is claimed.

Final date-caption derivation: focused map suite 31 PASS; web typecheck/build PASS.
First staged scan found one generic-assignment match in the test's synthetic renewed bearer.
Changed all new fake bearer strings to the scanner's explicit test-only convention (no scanner
change, no assertion weakened); no real credential was involved. Failed finding retained here.

Final full suite after date caption and explicit test-only strings: 355 tests / 60 files PASS.
Final staged secret scan: 841 files, 0 findings. Diff whitespace check PASS.

## Map and perspective controls after merging current main — 2026-11-02

Offline mock browser on this branch, port 5212. The map now starts below the
measured perspective chip. At 1440×900 the chip ended and the map began at
82 px; Rosina's dock began at 148 px. At 390×844 the chip ended and the map
began at 100 px; the open Rosina sheet began at 176 px. The Switch person
button was the hit-tested element at both widths, and clicking it from the
mobile map with Rosina open returned to the picker. The frozen 5189 UI and
shared backend were untouched. Screenshots:
`switch-chip-desktop-after.png` and `switch-chip-mobile-after.png`.

Merged-code checks: 440/440 web tests across 70 files, root typecheck, web
build and secret scan (0 findings) passed. The live world and stored ride
estimate remain pending their served transport; runtime still labels the
fixture map Sample data. PR #87 remains draft.
