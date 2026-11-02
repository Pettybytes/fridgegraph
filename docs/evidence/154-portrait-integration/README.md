# Portrait integration — before / after captures

**Web-only change. Fresh branch `feat/portraits-integration` off `origin/main`. Never merged.**

## What changed

- Replaced the 16 placeholder files in `web/src/assets/portraits/` with the approved Muse portraits
  (384 px PNG, same filenames and format the consumers already import).
- Added 21 new files, one per previously unillustrated person.
- Updated `PORTRAIT_BY_PERSON` to **37 entries**, keyed by person ID only.
- Extended the exact full-name net to the same 37 names; behaviour unchanged — it is still used only
  when there is no person ID, never as a first-name match.
- Kept the unknown-person monogram fallback: an unmapped ID still returns `undefined`.
- Added `PROVENANCE.md` and `provenance.json` beside the assets: model `muse-image-1.0`, date
  `2026-11-02`, full prompt per file, prompt and image hashes.

No manifest or consumer outside `portraits.ts` was touched. No HANDOFF edit.

## Method

| | |
| --- | --- |
| Before | separate worktree at `origin/main` (`5c7f2e0`), served on `127.0.0.1:5311` |
| After | this branch's worktree, served on `127.0.0.1:5310` |
| Mode | `VITE_DEV_MOCK_AUTH=true` — fictional demo auth, sample data |
| Viewports | desktop 1440×900, phone 390×844 |
| Surfaces | picker, Today, Village map, Orbit, Activity, Mission Control |

Twelve captures per state (`before/` and `after/`), same routes, same persona (Kendra).

## Result

- The picker, Today, Village map pins, Orbit, Activity and Mission Control all render with the new
  portraits at both viewports.
- Previously unillustrated people (Rosa, Felicia, Simone, Dwayne, Ms. Whitfield and others) now show
  portraits instead of monograms.
- The map badge still reads "Sample data · no live locations", and the demo banner still reads
  "Demo village · calls and texts go to test responders" — these captures are demo states, not live
  authorization or production proof.

## Checks

| Check | Result |
| --- | --- |
| Web build (`npm run build` in `web/`) | **pass** |
| Web suite | **487 / 488 pass** |
| One failure | `Session.test.tsx > removes Kendra pickup data before Loretta renders` — timing-sensitive, **passes in isolation** |
| Pristine `origin/main` full suite | also fails different timing-sensitive tests (VillageV2), which also pass in isolation |

The single full-suite failure is intermittent and unrelated to portraits: no portrait import is
involved, the file passes on its own, and a clean `origin/main` full run fails different timing
tests. It is recorded here rather than hidden.
