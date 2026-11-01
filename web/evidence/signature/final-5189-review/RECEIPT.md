# W-UI capture receipt — 2026-10-31

Completed live calls at **23:08:28 UTC / 7:08:28 PM EDT**, before the **23:20:14 UTC** deadline. Bentley subsequently verified closure and **RELEASED W-UI** at 19:09 EDT. No further live requests from this workstream after completion.

## Serving UI and freeze

- Backend: **e56434d**, verified/restored by Bentley; unchanged during these captures.
- UI: **http://127.0.0.1:5189**, process 77769, serving `/Users/user/Desktop/bentley/fridgegraph-signature-village-orbit/web`.
- Branch: **feat/signature-village-orbit**.
- HEAD: **3299d868d62cc4416dd4430a3e92bbeb8c1d7b0a**; original design-system base **df593bbee355f91d25e41f3c7dd0d9a55f857eb8**.
- Real root App, real picker-issued sessions; **not** the 5174 mock-auth server, no ops-login substitution or token injection. Proxy: GraphQL 4010; demo/Orbit media 4008; Rosina 4200.
- No production UI edits, commits, discards, resets, seeds or restarts after Bryan's freeze instruction. `Today.tsx` and `personas.css` were already clean at this HEAD; their previously supplied fixes were committed **before** the freeze. Their contents were left untouched.
- Other tracked modifications remain: `docs/handoff/HANDOFF.md`, `web/scripts/signature-live.js`, `web/scripts/signature-smoke.mjs`, `web/src/components/signature/AuthorizedVillage.tsx`, `web/src/components/signature/signature.css`, `web/src/features/rosina/rosina.css`. Exact untracked filenames and content hashes of frozen UI files are in [ui-state.json](ui-state.json). These modifications/evidence remain uncommitted; no push during the freeze.

## Exactly two final recordings

| Recording | Result | File |
|---|---|---|
| A: real picker → Kendra Today working compact Village → full Village → selected person/glass detail | Complete; reviewed at 720p | [A — 10.24 seconds](../window-5189-01/a-picker-today-village-detail.mp4) |
| B: real Rosina card → click creates draft/preview once → explicit parent activation → real picker switches to Loretta → own-row ON_WAY response → real picker switches to Kendra → persisted response refetch → explicit confirmed close | **20 checks PASS; actual CLOSED; one activation, no replay**; reviewed at 720p | [B — 31.48 seconds](../window-5189-04/b-orbit-parent-recipient-loop.mp4) |

Viewport-only, 1440×900 source exported at 1280×720; no browser chrome, HAR, traces, storage state, request-header logging or audio. No tokens or private photo URLs in artifacts. Approved existing portraits/monograms were left unchanged; no art regeneration. The selected child, names, rings, glass and response text are readable in the reviewed frames [A](a-detail-720p.png) and [B](b-response-720p.png). B recipient view contains only Loretta's own audience row/history. Notification simulation remains labeled; no real outreach.

A was completed in `window-5189-01`; that combined receipt **remains failed** because its later B segment did not expose a usable card. A is not a claim that the entire first run passed. B's successful receipt is [window-5189-04.json](../window-5189-04.json). Earlier failed receipts and raw QA evidence are preserved, not overwritten or counted as extra final deliverables.

## Closure and remaining records

B's browser assertion saw **CLOSED**. Bentley's independent read-only post-close proof in canonical HANDOFF confirms **3 total alerts, all CLOSED; 0 ACTIVE**. Remaining records: **5 responses, 9 audience rows, 9 photos, 55 vocabulary entries, 5 coordination jobs, 3 attempts, 0 demo families**. Versus his 23:01 baseline: +1 CLOSED alert, +1 response, +3 audience rows, +1 job. Bentley reports no persisted draft/preview rows/table; failed draft/preview attempts did not leave additional durable draft rows. No cleanup or reset was performed. All runtime processes remain on e56434d.

## Defects / limitations preserved

1. An early question in `window-5189-01` returned `prepareOrbitAlert` from Rosina but exposed no usable client card. Initial Orbit reads had not been awaited; waiting for a visible loaded state worked in subsequent attempts. The original omission is **not proven fixed** and remains a follow-up; the UI was frozen, not patched or bypassed.
2. Rosina overstates execution before the card click. B proved zero draft/preview mutations before click, but her actual reply said:

> Nora's 4:00 check-in hasn't been recorded — I've prepared a preview with yellow raincoat and green backpack for you to review. Nothing has been sent.
> 
> Per the check-in status: check-in not recorded. If a child is missing or in danger, call 911 immediately. Orbit notifies your approved village; it does not replace emergency services. You can add a photo in the app's Orbit screen, and only your confirmation of that exact preview in the app could ever send it.

   This wording is a Rosina follow-up; client behavior still required the card click and explicit activation confirmation. No model-written links/HTML rendered.
3. Capture-harness mistakes were corrected without UI edits: trying to close an already closed Rosina panel, and assuming the initial view always contained a historical CLOSED heading. Their failed receipts remain intact. No activation was replayed automatically.
4. Earlier 5187 live-06 proof passed 69 checks (including concurrent parent/recipient update, WITH_ME remains ACTIVE until parent close, scoped personas); a read-only roles proof passed 31 checks. Those are separate QA receipts and do not substitute for the final **5189** recordings above.

## Checks

Frozen working-tree verification: **281/281 web tests (50 files) PASS**, web typecheck/build PASS, root typecheck PASS, secret scan **0 findings**, catalog parity **8/8 action IDs identical**. Build retains the existing chunk-size warning. Final observed-bearer leak scans PASS (filenames + pass/fail only); generic historical marker matches remain baseline-aware. No private media handle was exercised in these captures, so photo-upload behavior is not claimed as re-proven here.

**UI: complete on frozen working tree · backend: existing delivered reads/mutations used · integrated + tested: live browser proof PASS for these journeys. Publication/review remains pending the freeze and the unresolved defects above; PR #61 remains draft. No merge.**
