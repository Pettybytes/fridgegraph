# Signature readiness correction — 2026-10-31

Append-only follow-up to final-5189-review/RECEIPT.md. No shared-stack calls or new live verification. Original captures and failed receipts are unchanged.

Preparation-card replies now use app-owned pre-action copy instead of model-written claims that a preview already exists. Validated actions are retained until their dependencies settle; render/execution permissions are still checked against current scope. An authorized same-child Orbit offer reserves a disabled card with a loading state while authority/vocabulary reads are pending; read failure stays disabled with an honest failure message. Receiving the offer never drafts or previews.

The preview sheet says “Preparing…” while the request is pending and “Here's the exact preview” only when a successful current preview is confirmable. Edits invalidate it immediately. Returned draft ID/version must match the draft request and a message hash must exist; mismatches leave confirmation disabled. Explicit parent activation, current version/hash binding, session guards and no automatic mutation replay remain intact.

Regression evidence: two new tests first failed (early card missing; exact-preview/pending copy absent). Both now pass. A separate mismatched-version negative control failed with the guard temporarily removed and passes with it restored. Tests cover delayed vocabulary, false model preview claims, no mutation before click, stale in-flight input, current preview success, subsequent edit invalidation, and mismatched version rejection with a visible failure.

Targeted suite: 65/65 tests, 11 files, PASS (Orbit/controller/polling, Rosina, signature components). Web typecheck/build PASS. Catalog parity: 8 action IDs identical. No full-suite rerun requested or needed for this follow-up. No edits to Today, personas.css, picker, tokens or PhoneFrame; their previously recorded contents remain untouched. Shared ownership coordinated with Claude Code.

The prior live journey remains evidence for the composition and service integration; this correction is proven by controlled regression tests, not claimed as newly live-tested.
