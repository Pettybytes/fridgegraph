# Add a Villager review component, offline visual check

2026-11-02. Temporary Vite fixture rendered the unmounted `ReviewCard` with a fictional Dana Coleman proposal in **mock mode**. No live mutation was called. The fixture page was removed after capture; the component remains unmounted until the adapter owner integrates it after migration 0074 is applied and verified.

| View | Capture |
| --- | --- |
| 1440 × 900, light | [desktop-light.png](desktop-light.png) |
| 1440 × 900, dark | [desktop-dark.png](desktop-dark.png) |
| 390 × 844, light | [mobile-light.png](mobile-light.png) |
| 390 × 844, dark | [mobile-dark.png](mobile-dark.png) |

Playwright CLI snapshots showed the person, exact `pickup.request` scope, validity dates, review expiry, unknowns, sample notice, and confirm control. The phone view had no horizontal overflow. The only browser console error was the temporary fixture's missing favicon.

visual review source scan reported no findings. The rendered scan initially flagged a nested bordered box and a one-word final line; the box was flattened to a top divider and the paragraph was given `text-wrap: pretty`. Its remaining `cream-palette` finding is the existing app canvas token from `web/src/index.css`, preserved under the design freeze.

Visual review, three weakest points:

1. `friend_parent` reads like a data value. Kept the exact recorded relationship type to avoid paraphrasing a permission; the integrating owner can add an authorized display label later.
2. The unknowns sentence takes three lines on the phone. Applied `text-wrap: pretty`; it is still readable without truncation.
3. The card has no surrounding Rosina thread in these captures. A temporary fixture was used because this PR deliberately leaves `RosinaPanel` to the adapter owner.
