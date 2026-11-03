# Village pulse visual review

These captures show the controlled fictional fixture in `web/src/features/mission-control/pulse/preview.tsx`. The preview makes **no live reads**. Its two pickup jobs and active Orbit status exist only to inspect layout and copy; the numbers do not describe the shared sandbox.

| Theme | 1440 px | 390 px |
| --- | --- | --- |
| Light | [fixture-light-1440.png](fixture-light-1440.png) | [fixture-light-390.png](fixture-light-390.png) |
| Dark | [fixture-dark-1440.png](fixture-dark-1440.png) | [fixture-dark-390.png](fixture-dark-390.png) |

The [open calculation disclosure on phone](fixture-help-390.png) shows the detailed limitations without clipping.

Reviewed with `playwright-cli` at both widths. The phone page had `scrollWidth === innerWidth === 390`; text remained readable without horizontal clipping. The only browser console error was the dev server's missing favicon. The preview entry is not included in `web/dist/` by the production Vite build.

Impeccable's source scan reported no source findings. Its first rendered scan flagged nested count cards and the cream background. The count tiles were flattened into the containing surface, clearing the nested-card finding. The remaining cream color is the existing `--fg-canvas` token from the frozen design contract. Visual review found three weak points: nested tile depth, a phone-width header that could crowd the calculation control, and long explanations ahead of the records. The tiles were flattened, the disclosure moves below the header copy on phone, and detailed limits now live inside the disclosure and read inventory.

The live component reads only the selected signed-in perspective's existing Mission Control data and Orbit controller status. No live graph or shared database call was made for this review. Query and calculation limits are documented in [READ-INVENTORY.md](READ-INVENTORY.md).

The default parallel web suite previously hit seven 5-second timeouts across Mission Control, Rosina, Today, and Village Rings. That run was a failure, not a passing check. The same suite passed with one worker; this limitation remains in the PR report.
