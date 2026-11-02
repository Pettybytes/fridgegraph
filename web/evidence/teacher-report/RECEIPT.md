# Teacher report card — offline mock receipt

Branch `feat/web-teacher-report`; base `a0ede9cfa3b3817b27f8cc851107a7cc6fc7b608`.

The first full web run after adding Ms. Whitfield failed: 368 passed, 1 failed. `Session.test.tsx` expected 11 picker personas; the approved teacher makes 12. This failure was reported before the expectation was changed. Bryan explicitly approved a narrow correction: 12 plus an exact list preserving all 11 original IDs and an assertion that `whitfield` maps to `p_whitfield`, Nora, and `school.read`/`school.report`.

The corrected full run passed: 369 tests across 65 files. Root typecheck, web build/typecheck, and the tracked-file secret scan passed with zero findings. The local browser used `VITE_DEV_MOCK_AUTH=true` and port 5208. It did not call the shared stack or create a school record. The card displayed the exact sample proposal; clicking Confirm reported that no school record was filed.

Initial `review-*-dark.png` captures used only the browser color-scheme setting, which does not switch this app's class-based theme; they show the light theme. They are retained as the initial capture. The `*-v2.png` captures use the app's `.dark` class and are the reviewed light/dark evidence at 1440×900 and 390×844. The mobile `v2` screenshots scroll the conversation to show the confirm control. `confirmed-desktop-light.png` shows the explicit mock confirmation result.

Live browser verification is pending Bentley's reserved window and deployment of the #96 GraphQL schema, migrations 0071/0072, recomposed router, and Rosina/MCP serving revisions. The existing port 4200 service was not probed. Text chat carries `schoolReportProposal`; the existing voice callback currently carries reply and catalog actions only, so a voice-proposed school report cannot surface this card until that callback contract carries the structured proposal.

## Final offline check — 23:55 UTC

After adding an explicit session-expiry state and the post-expiry idempotent-retry test, the final full run passed **371/371 web tests across 65 files**. Root typecheck, web build/typecheck, and the staged-diff secret scan passed; the scan reported **0 findings across 888 files**. The earlier 369/369 result above remains the preceding run, not the final count.

## Post-review check — 23:56 UTC

A review removed the technical report ID from visible success copy and added a response-match guard so a report with different text cannot be claimed as the reviewed report. The subsequent full run passed **372/372 web tests across 65 files**; web build/typecheck and root typecheck passed. This supersedes the 371-test count for the final source revision.
