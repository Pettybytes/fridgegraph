# Voice mount — approved locator correction

Supersedes the failed full-suite result in 01-checks.md; that receipt is unchanged.
Bryan approved scope-only changes to the four named tests. Every previous content and
confirmation assertion remains unchanged; the voice component and its status are unchanged.

Full web suite: 340 tests / 59 files PASS.
Focused mount/live-panel/Mission-Control suite: 20 tests / 3 files PASS.
Root typecheck PASS; web typecheck/build PASS (existing bundle-size warning).
Added regression: voice and text-progress statuses are independently visible while waiting;
completion removes only text progress and preserves voice status.
Mount tests also prove no duplicate turn, validated text-only cards and explicit confirmation,
and suppression of callbacks after perspective switch.

desktop.png (1440×900) and mobile.png (390×844): Playwright CLI, local 5198,
mock Kendra, typed navigation; no recorded audio, no live backend. Composer reviewed:
microphone alongside Send, voice playback control/credit below, canonical thread once.
This is offline mounting evidence, not a claim of merged-and-serving voice integration.

Staged secret scan: 826 files, 0 findings. Diff whitespace check PASS.
