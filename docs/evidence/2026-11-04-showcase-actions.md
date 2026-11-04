# Demo guide action grant probes

These probes use disposable local PostgreSQL. They do not connect to the shared database.

Before the action migration, `node --import tsx ops/guide-write-proof.mjs --before-showcase` fails on the first guide authority assertion: expected true for Nora, received false. This preserves the old denied-write behavior as the regression baseline.

With the action migration, the write proof passed 12 authority decisions and 12 calendar writes/refusals across the guide, Kendra and Dana. Additional probes passed care/Fridge writes and cross-family refusal, pickup approval attributed to `p_demo_guide`, and refusal after 120 writes in a minute. Further grant and reset checks are included in the executable proof.

`node --import tsx ops/guide-reset-proof.mjs` passed canonical care restoration, byte-for-byte preservation of other-family and unmarked rows, idempotent replay and refusal of a different reset actor.

The browser map refusal was reproduced on the public build before changes. The live adapter now handles a guide even when the optional map feature flag is off. A separate served-build failure exposed Apollo reusing an aborted request across the guide capability remount. The request-lifetime regression fails without independent request ownership and passes with it. The production map reader retains server authorization and no synthetic fallback is granted to other children.

These are local receipts. They do not establish public deployment, live Muse generation, SMS delivery, or independent release signoff.
