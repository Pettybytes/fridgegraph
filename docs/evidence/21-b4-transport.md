# 21c — B4: transport on Postgres

Run: `node ops/b4-proof.mjs transport` at 2026-10-27T04:16:19.502Z. All calls go through the
composed graph (router + verified JWT) or PostgREST with the publishable key plus the same
caller's token. No key or database URL in this file.

**Result: ALL PASS** (8/8)

| Check | Result | Detail |
| --- | --- | --- |
| named row and expected original value | PASS | bus_rosters date=eq.2026-10-26&child_id=eq.p_nora route=Route 14 |
| graph reads the row before the edit | PASS | observed=Route 14 |
| edited exactly that row | PASS | HTTP 200 |
| edit is visible through the graph | PASS | observed=B4-TRANSPORT-1793074570432 |
| original value restored | PASS | matches baseline=true |
| paired RLS: allowed caller has rows, denied caller has none | PASS | p_holt=1 p_dana=0 on bus_rosters (HTTP 200/200) |
| baseline checksums match after reset | PASS | identical |
| owned mutation + restart | PASS | transport exposes no mutation in the graph (village.approveRelationship, access.grantAccess/revokeGrant are the only three) — nothing to persist, recorded as N/A |

## Test reality check

The harness above hits the RUNNING DB-backed service: it edits a real row through PostgREST
with the service role, then reads the change back through the composed graph as a signed-in
caller. A fixture path would not show that edit. After the edit the original value is restored
and `db:reset` must return identical per-table checksums to the pre-test baseline.

## Writes

`transport` writes only its own tables. Read-only in this step: no mutation is exposed, so
persistence-across-restart is N/A (recorded above, not silently skipped).
