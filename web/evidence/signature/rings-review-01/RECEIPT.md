# Recording-review correction — offline only

PR #61 returned to draft. No live requests, reset, seed, restart, or shared-stack changes. The earlier recordings and their receipts remain unchanged. These screenshots are explicitly controlled fixtures; they do not replace the requested live focus-mode journeys.

## Integration

Fetched and verified design-system `021328759715a5d3ebe3adce0eb24d4eee0a58f7`, merged as `e475c00`. The sole Today conflict retained the existing connected Village preview and brought in Claude's surrounding Today changes. Subsequently fetched and merged `8a38dbaf8290574a9403451cf0677e64b414d5df` as merge commit `920625ff702d7ac625509f51d347942a27d566df`. No rebase or force push. No new edits to picker, PhoneFrame, shared tokens, or Today beyond that merge resolution.

## Rendered review and corrections

Playwright CLI against local 5189, controlled scripts only. App review intercepts graph/API requests; standalone ring review has no backend requests. Screenshots are at 1440×900, 390×844, and native 1280×720 focus composition. The App fixture's initial unsupported WebVillage response caused Apollo missing-field diagnostics; the review harness now returns a controlled authorization refusal for unsupported reads instead of an incomplete successful response. This was fixture coverage, not evidence about the backend.

Three largest weaknesses observed and corrected:

1. Orbit's top response label collided with the child portrait. Increased vertical ring spacing while retaining readable portraits and response type. `orbit-720p-final-controlled.png` shows the resulting composition. Every recorded state has text and an icon; color is supplemental. Activation marks the entire frozen audience simultaneously, with no staged outreach. Recipient views remain their own row only.
2. An overflow chip covered a household portrait. Moved every category's +N control alongside the legend, outside the scene. Each opens the remaining authorized identities in an accessible list; Escape closes the list. Desktop uses concentric ellipses; phone layouts show concentric arcs below the child with one readable portrait per category and explicit overflow. `village-focus-final-controlled.png` and `village-mobile-anchor-controlled.png` show the correction. Person details dock below the scene, measured not to overlap it.
3. Focus-mode's inherited text-page zoom narrowed the network enough to select the phone layout on desktop. A component-scoped override gives Village/Orbit the full recording width without modifying shell/tokens. Rosina's open panel remains full-width, uses shared glass (computed blur 18px), and has one conversation surface; the closed view retains a working reopen control. `rosina-focus-720p-refined-controlled.png` shows the conversation surface.

Intermediate screenshots are preserved, including the collisions and an early screenshot taken before the dark color transition settled. Later reviewed screenshots supersede those visual findings; none is relabeled as a live pass. A fullPage image does not bypass the app's internal scroll viewport; the mobile anchor screenshot is the actual reviewed viewport.

## Behavior and boundaries

- Actual successful matching preview/version/hash controls exact-preview wording and confirmation. Changed/stale inputs still invalidate it; card rendering never mutates; no automatic preview/activation replay.
- Household grouping comes from returned household membership. Relationship categories never imply authority; the person card omits authority unless explicitly supplied by a trusted read.
- Persisted responses update their corresponding portraits once through the existing session ledger. Refetch/remount does not replay baseline responses. WITH_ME remains a report.
- A named closure is shown only following the current perspective's acknowledged close mutation. The delivered alert lacks a closing actor; a freshly fetched closed record cannot invent one and remains unnamed.
- The Rosina service has no streamed tool-progress contract. The UI reports actual transport lifecycle (sending, awaiting response, reading response) plus elapsed waiting time. It does not invent check-in/village tool steps. The first message remains the first request; no readiness probes.
- Recorded FREE, eligibility, willingness, missing information and attempt outcome semantics remain unchanged.

## Checks

Targeted 82/82 tests across 13 files passed before the final simulation-label placement; final recheck is recorded in HANDOFF. Includes signature geometry/overflow/scope, Orbit preview/readiness/closure, polling, Rosina lifecycle/validation/cancellation, and merged display-copy coverage. Root typecheck and web typecheck/build passed. Existing large-bundle warning remains.

Impeccable source scan: one pre-existing care-information border finding in rosina.css, outside this surface change; retained rather than changing another owned surface. Rendered fixture scan: warm-paper palette finding, intentional shared art direction (design.md §6). No palette fork. Both scans are heuristics, not accessibility or live-service proof.

## Remaining gate

Bryan directed Claude's read-only Today capture first. Codex must report “ready for live captures” after offline completion, then wait for Bentley's dedicated confirmed window. Freeze UI during the two real picker-issued focus-mode recordings, verify actual closure, scan observed tokens in-process, and append new evidence. PR #61 remains draft until that acceptance passes.

Final recheck after simulation-label placement: **82/82 tests, 13 files PASS**; root typecheck, web typecheck/build, catalog parity PASS; staged secret scan **662 files, zero findings**; diff whitespace check clean. No live request was made.

Final visual refinement: ON_WAY, WITH_ME and CANNOT_HELP also color the corresponding portrait border using the existing semantic tokens, alongside their text/icon. `orbit-response-color-controlled.png` records the fixture after HMR reset (no response applied); `orbit-response-color-applied-controlled.png` records the explicitly reapplied controlled response. Neither is a live response.
