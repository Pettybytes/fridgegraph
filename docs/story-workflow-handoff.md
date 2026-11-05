# Story and workflow documentation handoff

BRANCH: docs/story-workflow-village
WORKTREE: /workspace/scratch/f4714ac851bb/fridgegraph-story-workflow
TASK: Make the original hackathon build, enterprise-to-family design, and human-to-graph workflow visible in the README.
LAYER: docs
TOUCHED: README.md; PROVENANCE.md; docs/readme-workflow.md; docs/assets/readme/schedule-workflow.svg; docs/assets/readme/hero-light.svg; docs/assets/readme/hero-dark.svg; docs/assets/provenance/muse-account-2026-11-04.png; this handoff.
DONE WHEN: npm run typecheck; npm run check; git diff --cached --check; SVG XML parses; relative documentation links resolve; static diagram is visually inspected.
NOT DOING: Runtime changes, migrations, deployments, provider calls, live contact outreach, submission-form edits, historical receipt rewrites.
BLOCKERS: Browser animation verification could not run because Chromium startup failed with socket Operation not permitted. Static SVG was rendered and visually inspected; CSS motion/reduced-motion rules were inspected only.

## Integration

Based on main c32f5f5185a762aa99d2e32e5a3955a17afce942. Incorporates the complete documentation/assets diff from draft #291 at 33da68ec4703c5d5085f46979c5c5ea597879926, then expands the story, GraphOS naming and communication branch. This replacement PR should be considered instead of merging #291 independently; #291 is left open for the owner to manage.

Bryan confirmed on November 5 that SMS and calls work, and live tests deliberately avoid contacting real integrated contacts. Documentation attributes that confirmation to him. It does not claim a new provider receipt. The voice status now distinguishes the merged #293 browser transport from historical sequential-path latency.

The animated asset preserves #291's Rosina avatar and colors. Current Nora and Tori images remain untouched. The inherited Muse account screenshot remains a snapshot, not proof of exhausted spend.

## Validation

- npm run typecheck: passed after the documentation changes.
- npm run check: passed; staged-file scan is repeated before commit.
- SVG XML parsed; static CairoSVG render inspected at 900 x 1605.
- Browser render attempt failed at Chromium launch; no browser animation or GitHub rendering result is claimed.
- No application test suite or live services were invoked for this documentation-only update.

Next owner: Bryan/Claude reviews and merges the replacement documentation PR. Bentley has no deployment task for these Markdown/SVG changes. Any future operational claims should reference a named served-build/provider receipt.

## Follow-up: origin, SMS readiness, and screenshot scale

Bryan supplied the fuller Tori origin story: her distress about single motherhood prompted him to call and offer help, and he recognized the same strain in his family. README now reflects that account. Tori’s screenshot displays at 320 px instead of 540 px, linking to the unchanged full original. Bryan also confirmed A2P registration is covered and live SMS can be enabled with a switch; testing deliberately avoids his real contacts. No switch was changed and no message or call was sent.
