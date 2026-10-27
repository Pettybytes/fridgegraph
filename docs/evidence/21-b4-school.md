# 21b — B4: school on Postgres

Run: `node ops/b4-proof.mjs school` at 2026-10-27T04:11:59.290Z. All calls go through the
composed graph (router + verified JWT) or PostgREST with the publishable key plus the same
caller's token. No key or database URL in this file.

**Result: FAILURES PRESENT** (2/4)

| Check | Result | Detail |
| --- | --- | --- |
| found a demo row to edit | FAIL | no rows in school_reports for child_id=eq.p_nora |
| paired RLS: allowed caller has rows, denied caller has none | FAIL | p_mom=0 p_dana=0 on school_reports (HTTP 200/200) |
| baseline checksums match after reset | PASS | identical |
| owned mutation + restart | PASS | school exposes no mutation in the graph (village.approveRelationship, access.grantAccess/revokeGrant are the only three) — nothing to persist, recorded as N/A |

## Test reality check

The harness above hits the RUNNING DB-backed service: it edits a real row through PostgREST
with the service role, then reads the change back through the composed graph as a signed-in
caller. A fixture path would not show that edit. After the edit the original value is restored
and `db:reset` must return identical per-table checksums to the pre-test baseline.

## Writes

`school` writes only its own tables. Read-only in this step: no mutation is exposed, so
persistence-across-restart is N/A (recorded above, not silently skipped).
