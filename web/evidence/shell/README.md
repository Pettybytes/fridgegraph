# Shell review evidence

Captured with Playwright CLI against the local Vite server.
Browser viewports: 1440 × 1000 and 390 × 844. Five full-page screenshots.

## Interaction sequence

1. [Desktop shell](01-desktop-shell-1440.png): default Mission Control route and Fictional demo label.
2. Click Living Village: [desktop village route slot](02-desktop-village-slot-1440.png), current navigation item marked.
3. Click Parent chat: [desktop chat route slot](03-desktop-parent-chat-slot-1440.png).
4. Browser Back returns to Living Village; reload preserves its direct hash route.
5. At 390px, click Mission Control: [mobile shell](04-mobile-shell-390.png), no horizontal overflow.
6. Click Living Village: [mobile village slot](05-mobile-village-slot-390.png).

Mission Control and parent chat are route slots only in this PR. No feature implementation.

## Adapter and polling investigation

Apollo Client's installed `core/ObservableQuery.js` defers `updatePolling` after subscription
and uses a recurring `setTimeout` scheduled from `poll()`. The original test switched to fake
timers after the query subscribed and the real timer was scheduled, so advancing the fake
clock could not execute that timer. Installing fake timers before render, flushing the
initial zero-delay setup, then advancing exactly 2500ms passes the unchanged assertion:
`expect(read).toHaveBeenCalledTimes(2)`.

Production polling code was not changed during the resumed investigation.

The browser probe independently mounted the same DataProvider and hook with the mock adapter,
then unmounted it after two reads. Observed interval: **2508ms**.
It verified four recorded candidates, PENDING as waiting, and the approved cost label and
uniform $1.40/mile synthetic estimate, including drivers. No live graph or credentials used.

[Browser result](browser-result.json): **14 checks passed**, two reads, zero page errors.
Playwright console inspection: **0 errors, 0 warnings**. The probe's Vite module imports use
its CommonJS default export wrapper; this browser-harness correction changed no application code.

To reproduce, start `npm --prefix web run dev -- --host 127.0.0.1 --port 4173 --strictPort`,
then from the repository root run `playwright-cli open http://127.0.0.1:4173/` and
`playwright-cli run-code --filename=web/evidence/shell/verify-browser.js`.
The script injects a temporary hidden adapter probe into the local page only, cleans it up,
and writes screenshots. It does not add a product feature or contact any caregiver.

## Automated validation

- Full Vitest suite: **3 files passed, 15 tests passed** (shell 4, adapter 9, bridge 2).
- `npm run typecheck`: passed.
- `npm run check`: clean; repeated with staged new files before commit.
- `npm --prefix web run build`: passed (TypeScript + Vite).
- `git diff --check`: clean.

Regression evidence: the original polling test failed with one read instead of two; it passes
after the timer-harness fix. The new travel-cost regression was also run red before the
approved field/label update (missing Estimated travel cost label), then green afterward.

No server, database or live GraphQL probes were run for this frontend-only shell task.
The integrated caregiver/approval Playwright smoke test belongs to the subsequent feature PR.
