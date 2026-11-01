# Notice → Plan UI checkpoint (mock, review-only)

Base 573e6689d8996a7716b1f15ca4c02dbbee4e5baf; branch feat/web-notice-plan.
Contract b0ce3aa (stable §§2/4/4b); sample kit 9103559 on Claude Code's PR #89.
This checkpoint does NOT claim the full confirm flow or a deployed endpoint.

## Evidence
- shell/: initial contract-independent input shell, light/dark, 390×844 and 1440×900.
- review-only/: exact sample(a) PNG → mock review, light/dark at the same sizes.
- review-only/sample-a-review.webm: mock sample selection → review → scroll through fields.
  Confirmation is unavailable and no pickup is claimed. This is not the requested final
  sample→confirm recording; that awaits the missing stable action mapping.

Playwright CLI, local 5200 with explicit mock auth, Kendra. No real session, token, notice
endpoint, model call, pickup/consent write, reset or shared-stack request. Only local UI/sample
assets are fetched. Files/text remain in memory and clear on persona/child switch and close.
Review samples are recognized by exact content, not filenames; arbitrary uploads are never
assigned Nora's sample schedule facts.

## Checks
358 web tests / 62 files PASS; root typecheck PASS; web typecheck/build PASS.
Notice-specific suite: 16 PASS. No existing assertion deleted, skipped or loosened.
Initial shell stage: 347 full tests PASS (before adding stable review tests).
Initial review build exposed erasableSyntaxOnly TS1294 on a parameter property; replaced with
an ordinary field assignment. Sample/drop parity test then caught Blob→File cross-realm
stringification; changed loader to ArrayBuffer bytes. Strict payload equality assertion kept,
and the same test passed. These failures remain recorded here.

Source Impeccable scan reports no regex findings, and explicitly does not run parsed-element
rules. Separate rendered scan opens the picker and reports the existing cream-palette finding
plus picker contrast/text-wrap advisories; shared palette/picker remain frozen. Authenticated
notice UI reviewed in Playwright in both themes, using shared surface/ink/primary/on-primary
tokens and the existing Button primitive, with 44px controls. Three layout concerns addressed:
collapse input when unused; bound the open input/review scroller to preserve the chat composer;
scroll the returned review into view without animation.

## Pending contract details
The available=true onConfirm envelope is not defined (only its separate confirm request).
Exact error JSON/429 retry-delay shape and unreadPages placement are also missing.
Questions posted to PR #89. Pending actions have no confirm button, even if available:true
appears in a controlled test envelope. Unsupported field-trip actions remain review-only.
No live transport is implemented; merge alone will not enable one.

## Asset provenance
PNG/PDF copied byte-for-byte from Claude Code's 9103559 web/public/samples/notice-plan/.
Text copied exactly from src/rosina/samples/notice-a-early-dismissal.txt in that commit to
the frontend sample directory. Fictional notice rendered from exact HTML, not generated notice
text. School/scenario references follow the published kit, not a similarly named map fixture.
No source/backend file was changed.

Final source scan (stable review added) reports one side-tab finding on the blockquote's
2px source marker. Retained with a source comment: it denotes the quoted passage, not a
decorative card stripe. The earlier no-finding source result applies to the shell stage.
Final staged secret scan: 855 files, 0 findings; diff whitespace check PASS.
