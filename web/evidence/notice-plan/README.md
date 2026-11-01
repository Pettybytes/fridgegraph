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

## Mock confirm continuation — PR #90 draft, 2026-11-01

The earlier review-only receipt and files remain intact. PR #89 current head was verified
at `67c7314c1db7056dbfaa112aae2a6cb822e7a578`. Its handler accepts the envelope's
`{ claims, signature }` and returns `{ job: { id, status } }`; §5 of the contract still
shows a stale flat request example, reported on #89.

`mock-confirm/` contains an explicit sample (a) → review → confirm viewport recording
and light/dark desktop/mobile screenshots. Playwright CLI used the local 5200 mock-auth
server, Kendra, and no real backend request. The result is visibly **Mock** and says no
record was created or pickup arranged. The source review, coarse afternoon window and
Mission Control link remain visible. The mock adapter is idempotent by child/date/window;
an explicit repeat returns the same mock job. Field-trip review has no confirm action.

The focused notice suite passed 27/27. The first full suite exposed one new assertion
mistake: it expected the rate-limited confirm control to stay disabled, although manual
retry is allowed. The assertion now checks that the control stays enabled while the
confirm call count remains exactly one; 27/27 focused tests passed afterward. The first
browser capture clipped the review heading because the nested scroll had a 405px cap;
the focus-mode cap and scroll margin were adjusted before the later captures. A first
"dark" screenshot used browser color-scheme emulation only; this app uses a `.dark`
class, so the dark captures were repeated with that class set. Superseded screenshot
bytes have no bearing on the earlier review-only evidence.

**Live verification: PENDING.** #89 must merge, its endpoint must be verified deployed,
and a Bentley window must be reserved before connecting and exercising the real transport.
The mock recording is never presented as live proof.

Final offline checks after this continuation: 369/369 web tests in 62 files,
root typecheck and web typecheck/build PASS; staged secret scan 856 files,
0 findings. Full-suite first pass was 368/369 because the new 429 assertion
incorrectly expected the button to remain disabled; the corrected explicit
manual-retry assertion passed in the final 369/369 run.

## Merged-service transport continuation — PR #90 draft

`origin/main` at `29887dd` includes #89. Merge commit `8507a43` preserves both HANDOFF
workstreams and takes #89's canonical sample PDF. Its bytes changed, so the mock content
digest was updated and tested against the merged asset. The merged handler requires
`notice` even on clarification resume; confirm sends `{ claims, signature }` verbatim;
success is `{ job: { id, status } }`. Exact differences from the contract examples were
posted on #89 for a docs correction.

The real adapter is implemented and tested with controlled responses. It stays behind
`VITE_NOTICE_PLAN_LIVE`; the default remains **Mock**. No live request or pickup write
has been made, and the prior mock capture does not prove the endpoint is deployed.
The first canonical-PDF test used a URL form that Vite did not expose as a file URL;
the test now reads the published asset from the web test root without changing its
content assertion. Targeted notice suite then passed 41/41.
Final merged-code offline check: 386/386 web tests in 64 files, root typecheck,
web typecheck/build and staged secret scan (884 files, 0 findings) PASS.
