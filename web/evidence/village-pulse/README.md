# Village pulse visual review

These captures show the controlled fictional fixture in `web/src/features/mission-control/pulse/preview.tsx`. The preview makes **no live reads**. Its two pickup jobs and active Orbit status exist only to inspect layout and copy; the numbers do not describe the shared sandbox.

| Theme | 1440 px | 390 px |
| --- | --- | --- |
| Light | [fixture-light-1440.png](fixture-light-1440.png) | [fixture-light-390.png](fixture-light-390.png) |
| Dark | [fixture-dark-1440.png](fixture-dark-1440.png) | [fixture-dark-390.png](fixture-dark-390.png) |

Reviewed with `playwright-cli` at both widths. The phone page had `scrollWidth === innerWidth === 390`; text remained readable without horizontal clipping. The only browser console error was the dev server's missing favicon. The preview entry is not included in `web/dist/` by the production Vite build.

Impeccable's source scan reported no source findings. Its rendered scan flagged the cream page background. That color is the existing `--fg-canvas` token from the frozen design contract, so it was retained. Visual review found three weak points: year was absent from the window, “Open record” suggested a direct record link that the route does not support, and the mobile request rows placed links close to status text. The first two were corrected; the rows wrap the links onto their own line at phone width.

The live component reads only the selected signed-in perspective's existing Mission Control data and Orbit controller status. No live graph or shared database call was made for this review. Query and calculation limits are documented in [READ-INVENTORY.md](READ-INVENTORY.md).
