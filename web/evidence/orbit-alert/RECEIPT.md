# Orbit Alert offline review — 2026-11-01

Base: 80700a3d77414be6538066fe85c6415bc0e0bb12. Source is the accompanying Orbit Alert UI commit. Backend: none contacted. Schema: not queried. Real sessions: none. All people/records in these captures are controlled fixture data, labeled on screen. Photo suggestions are an injected mock of #69's shape, not live vision. No alerts were created in the shared stack.

- offline-01: original capture retained. Functional checks passed, visual review found pale red, wrong green hue from OKLCH interpolation, and underlying content in full-page recipient captures. Not accepted as final visual evidence.
- offline-02: darker shared-token red, OKLab green mixing, viewport recipient layout and all phone actions/guidance visible. Photo-review and exact-preview captures added from the actual Rosina panel.
- offline-03: final source after recipient CLOSED ledger hardening. Capture results record 1440/390, 1 Hz single flash layer, static reduced motion, parent-only explicit Found safe, persisted controlled response and no payoff replay. Compose results verify manual review and time-change invalidation. Closed-link results verify stale payload suppression at both widths/themes and no cold-load confetti. Zero backend requests in each harness.

Regression history: the added late-ACTIVE-after-CLOSED test failed before the ledger fix (Found safe missing, recipient details restored). The first fix caused four outcome tests to fail by preserving an incomplete close outcome. The corrected ledger retains closure while accepting newly recorded outcome/thank-you. Final suite: 310 tests, 52 files PASS. Root typecheck and web typecheck/build PASS. Existing bundle-size warning remains.

Pending live gate: Bentley's closed-recipient GraphQL/photo read gate, real #69 descriptor endpoint, and a separately reserved live capture. These screenshots do not prove those integrations.
