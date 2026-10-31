# W-RESET browser acceptance — 2026-10-31

Base `c499e217a1455e8053646beb0d554d11b76e0f1c`; branch `feat/web-demo-reset`; UI PR #51. Backend dependency #52 moves reset to 4008 (serving `dd84886`, equivalent code `1a51273`). Existing proxy, no backend changes in this PR.

Bentley opened the restored W-RESET window until 04:54 EDT after nonempty named Kendra MyChildren proofs through router 4012 and MCP 5051. Processes 4008/28366, 4012/18859, 4200/34734 and 5051/28180 remained unchanged. Browser completion and release were explicitly sent to Bentley at about 04:33 EDT. No stack restart, seed, db:reset or real notification was performed by the web agent.

## Actual live run

`web/evidence/reset-demo/live-07.json`: **32/32 checks PASS**, **one reset POST**, no replay. Actual App, picker, GraphQL, Rosina, media and reset services; no session injection or fixture responses. Orbit uses scenario time; authentication uses the real clock.

- Kendra clicked Rosina's preparation card, reviewed the message, uploaded a real authenticated fictional PNG and explicitly activated Orbit. Two tabs saw the same persisted alert.
- Opening the shared confirmation sent no reset. One confirmation sent one POST. Observed order: reset request, successful response, seeded verification read, successful verification, success picker.
- Private UI and Rosina conversation disappeared; every image rendering handle was revoked. No session was persisted in browser storage.
- The second tab explicitly refetched the seeded no-alert state. Its bearer and login count were unchanged; it stayed in Kendra's perspective with no logout, renewal or re-mint.
- Kendra chose her perspective again and saw the original seeded child set, no alert and no old conversation. The guide had no reset button and retained its read-only explanation.

**Token/media scan PASS.** The harness held observed credentials and media handles in process memory, checked working files/evidence/Playwright output for them and token prefixes, and allowed no new generic JWT-marker matches. The receipt lists filenames and pass/fail only; unchanged generic-marker baseline matches are retained. Credential stores, dependencies and git internals were excluded rather than read. No trace, HAR, video, storage state or request-header logging. No tokens, fragments or photo URLs in evidence.

Twelve real desktop/mobile screenshots: `web/evidence/reset-demo/live-07/` (active, confirmation, picker, second tab, returned Kendra, guide). The separate design captures are explicitly labeled offline fixtures.

## Preserved failures and corrections

Receipts 01–06 remain unchanged, all with zero resets; none counts as successful integration evidence.

- The landing screen does not request MyChildren. The corrected harness explicitly reads the seeded baseline with the real picker bearer held in memory.
- Initial assertions conflated historical/pending drafts with an ACTIVE alert. The precondition now requires a completed status read and no ACTIVE alert. After reset, the requirement remains no alert at all.
- Photo interaction initially preceded the actual draft/preview ready state; no upload request occurred. The corrected harness waits for enabled editing. Run 07 records upload/read HTTP 200 and real rendering-handle revocation.
- A reservation-source interruption blocked one attempt before requests. The guard was never bypassed; Bentley restored the canonical row and reconfirmed unchanged processes before retrying.

An unrelated `WebVillage` read returned `UNAUTHORIZED`; reset verification succeeded. Village v2 live integration and broader W4 dependencies remain separate.

Offline final checks: **255/255 web tests**, web typecheck/build, root typecheck, secret scan **0 findings**, reservation guard test. Added actual Rosina/photo/controller reset-disposal coverage and a cooldown test proving expiry never sends another request. Final-head CI is recorded in the PR.
