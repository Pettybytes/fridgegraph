# Shared status chip, mock browser fixture

The self-contained chip was rendered beside Andre Ellison's existing portrait/name primitives with a fictional explicit status: `🍼 Changing a diaper · ETA: unknown`. The temporary fixture used **mock mode**. There was no status read or backend call; the fixture page was removed after capture.

| View | Capture |
| --- | --- |
| 1440 × 900, light | [desktop-light.png](desktop-light.png) |
| 1440 × 900, dark | [desktop-dark.png](desktop-dark.png) |
| 390 × 844, light | [mobile-light.png](mobile-light.png) |
| 390 × 844, dark | [mobile-dark.png](mobile-dark.png) |

Playwright CLI showed the supplied emoji, text and ETA, plus a separate Sample chip. The 390px view kept the whole status within the person card. The only browser console error was the temporary fixture's missing favicon.

visual review's source scan found no issue. Its rendered scan flagged only the app's existing cream canvas token; it remains under the design freeze.

Visual review, three weak points:

1. The chip uses the existing 12px primitive and is small on a phone. It remains readable at 390px; no new size scale was introduced.
2. Long statuses can wrap. The component adds only a width and wrapping rule, retaining the existing chip colors and spacing.
3. The mock status is not in the live Village yet. A separate Sample chip makes that boundary visible until the backend read is available and the adapter owner mounts it.
