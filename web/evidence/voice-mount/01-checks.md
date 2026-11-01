# Voice mount — initial offline checks

Base: 6df927be1fcb711c114a7ba3b5d3118cf30d6e8a (#80 and #81 merged).
Branch/worktree: feat/web-voice-mount / fridgegraph-voice-mount.
Input method: controlled callback fixture in unit tests; no recorded/live audio and no backend call.

Focused suite: 11 tests / 3 files PASS (voice transport's existing tests plus 3 mount tests).
Full suite: 335 PASS, 4 FAIL / 339 tests. The four failures are:
- livePanel: `shows Live without a probe, loading, plain text and only client-validated allowed cards`
- MissionControlV2: `replays a complete normal job with independent lanes and an unskippable app confirm`
- MissionControlV2: `requires explicit over-limit acceptance in the distinct no-driver night without fabricating timestamps`
- MissionControlV2: `auto replay stops at the recommendation and never automatically records approval`

Exact error: `TestingLibraryElementError: Found multiple elements with the role "status"`.
The mounted voice control adds its own legitimate status region; these selectors were page-wide.
Approval requested under AGENTS.md §1.4 to scope selectors while retaining every assertion.
No assertion has been weakened or changed. This failed receipt is preserved.

Root typecheck PASS. Web build initially caught a TypeScript options error in the new test:
`'exact' does not exist in type 'ByRoleOptions'`; replaced with an exact-name regular expression.
Web typecheck/build then PASS. No live voice integration or recording is claimed.
