# 21b — B4: school on Postgres

Run: `node ops/b4-proof.mjs school` at 2026-10-27T04:14:59.375Z. All calls go through the
composed graph (router + verified JWT) or PostgREST with the publishable key plus the same
caller's token. No key or database URL in this file.

**Result: ALL PASS** (10/10)

| Check | Result | Detail |
| --- | --- | --- |
| seeded one fictional row (table empty by design) | PASS | school_reports insert HTTP 201 |
| named row and expected original value | PASS | school_reports id=eq.sr_b4_proof text=fictional report for the B4 school proof |
| graph reads the row before the edit | PASS | observed=fictional report for the B4 school proof |
| edited exactly that row | PASS | HTTP 200 |
| edit is visible through the graph | PASS | observed=B4-SCHOOL-1793074489950 |
| original value restored | PASS | matches baseline=true |
| paired RLS: allowed caller has rows, denied caller has none | PASS | p_mom=1 p_dana=0 on school_reports (HTTP 200/200) |
| fictional row removed again | PASS | delete HTTP 204 |
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
