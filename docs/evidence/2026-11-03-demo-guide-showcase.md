# Demo guide fictional showcase read grant

Base: `8f4215d` (PR #237). Branch: `fix/demo-guide-scope`.

## Before

The deployed guide returned all ten children from `myChildren` and 236 coordination jobs. This rules out a missing guide session marker as the sole cause. Browser navigation reproduced Mission Control refusal, Activity refusal, village loading failure, map refusal, Orbit's not-shared state and incomplete care information.

History identifies several independent exclusions rather than one recent session regression: Mission Control's parent-only gate in `c8915e7` (PR #156), Activity in `93d648d` (PR #91), the map's explicit guide refusal in `0a158595` (PR #87), and older household/relationship/goals gates in `f1cb43a`. PR #226 added a blanket guide refusal to preference reads. The investigated reset/session path still issues the guide marker.

The new resolver tests initially reported 8 failures and 43 passes. At the original base, the disposable PostgreSQL proof without the showcase migration failed because the guide could not read the fixture's Jax fridge note. The later Fridge PR independently restored that read with stricter fictional-note provenance.

## Authorization contract

The showcase grant requires verified `app_metadata.demo_guide`, mapped identity `p_demo_guide`, and a child in a household marked `sandbox=true`. Client view selection grants nothing. Reads continue through the caller's RLS client. The SQL predicate and resolver helper enforce fictional provenance; action scopes receive no showcase grant. Existing parent and ordinary grant predicates remain in force.

Migration 0098 adds the missing SELECT policies and read-function branches. GraphQL mutations retain their early guide refusal and database write restrictions remain. Guide route reads no longer persist route-cache writes. No shared database was changed during this work.

Invitation preparation remains disabled. The product does not persist prepared invitation cards, so the guide view lists actual invitation coordination records and separately labeled calendar gatherings. It never presents a scheduled event as evidence of an invitation being sent.

## Local proof

The expanded focused suite passed 114 tests. A disposable PostgreSQL 16 instance with all migrations passed 24 read checks across guide, Kendra, Dana and a parent carrying a forged guide marker, three refused writes, and non-fictional household exclusion. The exclusion fixture was asserted to exist before testing visibility.

The served-build harness uses the production web bundle, actual subgraph resolver bodies and PostgreSQL RLS. It substitutes a local session issuer and a PostgreSQL adapter for PostgREST. It does not prove production JWT verification, router federation wiring, external services or deployment. Production browser reproduction was performed separately.

## Release

Bentley must apply migration 0098 and deploy the matching application revision together. Claude's post-deploy verification must use Demo guide, Kendra and Dana. Local tests are not evidence of a production deploy.

Integration: PRs #239, #241, #242 and #243 landed during verification. The showcase migration is now 0098. The existing 0097 Fridge policies remain in force, including fictional-note provenance; this change does not grant visibility to unmarked parent posts. Reset CI jobs are retained.

The integrated browser test also caught the guide-reset exception introduced by #239. The server eligibility helper and frontend control now refuse guide reset, as required by this task. Parent/guardian reset, receipt recovery and transaction tests remain.
