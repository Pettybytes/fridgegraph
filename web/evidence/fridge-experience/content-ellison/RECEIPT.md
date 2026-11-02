# Content revision and approved Ellison pack — offline mounted evidence

2026-11-02. **Mock data · visual preview**, not a live integration proof. No deployment, shared-stack requests, backend changes or HANDOFF edits.

Final capture UI: `79f8b01200bf0a38b98028c4938428579864e00c`, branch `feat/fridge-experience`, own worktree `fridgegraph-fridge-experience`, local Vite port 5238. UI frozen during the final captures. The final evidence commit adds files only. Accepted App/Shell routing at `99840a1` is unchanged.

The feature-local AppPreview mounts the actual App → Session → ChildAccess → ConnectedFridge route. Picker sessions are mock; the explicit evidence-only reader supplies controlled care/goals outcomes. Both routes to API/GraphQL are blocked; request observation confirms zero API/GraphQL and third-party font requests during the family capture passes. No tokens or live sessions were used. Harness HTML and visual fixture strings are absent from production dist.

## Final captures

`final/`: 32 screenshots at 1440×900 and 390×844.

- Kendra / recorded child p_nora: approved Ellison pack, populated and empty care/goals, overview and both doors. Phone collage has upper/lower scroll frames.
- Dana / p_jax: original generic sample collage, populated and empty care/goals, overview and both doors; no Ellison dog or Nora care text.
- Demo guide: mounted read-only label, refused and failed care states at both widths, manual Retry preserves explicit failure.
- Desktop screenshots include the mounted shell; mobile frames scroll the real app container rather than changing shell CSS. The sticky mock banner remains visible.

## Results

- Web: **502/502**, 84 files. Focused fridge: **21/21**.
- Web build/typecheck and root typecheck pass. Secret scan: **0 findings** before UI commits; rerun with staged evidence before publishing.
- Chromium: photo tap opens enlarged dialog; actual touch input through CDP moves layout without opening; Alt+arrow movement; Tidy up; clipped-door Tab exclusion; Escape/URL synchronization; reduced-motion emulation; guide refusal and explicit retry all pass.
- Twelve source images and twelve prompt hashes match PR154 head `fb91e9cbbe04adfe8f3a2dc880d40287527baf64`. Twelve PNG originals plus 36 proportional WebP sizes; full prompts and hashes retained. Seven art images displayed for balance. Muse attribution applies only to `packs/ellison/`; background/generic samples remain Higgsfield.
- No fridge-specific alert imports, reads, subscriptions or feedback remain. Only caller-authorized care/goals reads. No decorative content is supplied to Rosina.

## Preserved failures and corrections

1. `web-suite-first-failure.txt`: one existing Village persona test timed out; 500 passed. Its unchanged isolated suite passed 7/7 (`village-isolation-pass.txt`), then the full unchanged suite passed 501/501. After adding the guide regression, final full suite passed 502/502. No expectation or timeout was weakened.
2. `first-capture-failure.txt`: six initial desktop frames were saved; changing only the hash retained the picker session. The corrected harness reloads before choosing a new mock session. Original frames retained; run-2 passed both families.
3. `run-2/interaction-first-failure.txt`: guide correctly landed on Village, not Fridge. Harness now follows the existing Fridge nav link.
4. `run-2/guide-label-failure.txt`: actual missing mock guide read-only label. Fixed ConnectedFridge to recognize the canonical demo-guide persona as well as live marks, matching existing Session behavior; added a mounted regression. No mutation controls existed or were added. Recaptured every final view at 79f8b01.

Existing warnings: jsdom canvas implementation messages and Vite bundle-size warning. No dependency changes.

Goal editing, unsupported school-notice/proposal listings and live care/goals proof remain outside this slice. Bryan's capture review remains pending; #153 stays draft.
