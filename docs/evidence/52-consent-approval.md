# 52 — Group 5 Piece 3: one consent decision per slip (`approveConsent`)

- endpoint: `http://127.0.0.1:4315/` (school subgraph, spare port; the demo stack was untouched)
- identity: verified Supabase JWTs per caller; tokens held in memory only, never written
- schema: `approvals` one-decision index (0047) + decision visibility / demo-sandbox policy (0048)
- fixtures: four fictional slips + one `consent_approval` policy row, removed after the run

| # | Assertion | Result | Detail |
|---|---|---|---|
| 1 | default (no rule): parent approves | PASS | rows=1 {"approveConsent":{"slip":{"id":"ps_proof_nora"},"approver":{"id":"p_mom"},"decision":"APPROVED","at":"2026-10-31"}} |
| 2 | default: the recorded approver is the caller | PASS | p_mom |
| 3 | same approver repeats: still 1 row | PASS | rows=1 |
| 4 | same approver repeats: the existing decision is returned | PASS |  |
| 5 | second parent after decision: still 1 row | PASS | rows=1 |
| 6 | second parent gets the EXISTING decision and who made it | PASS | {"slip":{"id":"ps_proof_nora"},"approver":{"id":"p_mom"},"decision":"APPROVED","at":"2026-10-31"} |
| 7 | second parent changed nothing | PASS |  |
| 8 | Marcus (resident_adult) refused | PASS | UNAUTHORIZED |
| 9 | Marcus wrote no row | PASS |  |
| 10 | Priya (care-plan grant) refused | PASS | UNAUTHORIZED |
| 11 | Priya wrote no row | PASS |  |
| 12 | Demo guide refused (read-only) | PASS | DEMO_GUIDE_READ_ONLY |
| 13 | Demo guide wrote no row | PASS |  |
| 14 | named-approver household: the other parent is refused | PASS | UNAUTHORIZED |
| 15 | named-approver household: refusal wrote no row | PASS |  |
| 16 | named-approver household: the named person approves | PASS | {"slip":{"id":"ps_proof_emma"},"approver":{"id":"p_rosa"},"decision":"APPROVED","at":"2026-10-31"} |
| 17 | hidden / nonexistent / malformed slipIds: identical refusal | PASS | UNAUTHORIZED · UNAUTHORIZED · UNAUTHORIZED |
| 18 | no existence oracle wrote any row | PASS |  |
| 19 | decision appears in the slip history | PASS | {"id":"ps_proof_nora","signed":false,"history":[{"approver":{"id":"p_mom"},"decision":"APPROVED","at":"2026-10-31"}]} |
| 20 | the other parent sees the same single decision in history | PASS |  |

**20/20 PASS**
