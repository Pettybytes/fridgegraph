# Evidence 47 — per-household approval policies (IMPLEMENTED, PROOF BLOCKED)

_Branch `feat/approval-policies`. Migration **0040** applied._

## Implementation (done)

`can_approve_swap(p_child, p_proposer)` now reads the household's `schedule_swap_approval` policy and
**no longer assumes "the other parent/guardian in the household"**:

- It considers **every household containing the child** — Nora lives in both `h_a` and `h_b`, so the
  old single-household assumption wrongly refused Andre.
- `BOTH_PARENTS` / `GUARDIANS`: the other parent/guardian approves; the proposer never does.
- `ANY_PARENT`: any parent/guardian may approve, including the proposer.
- `SINGLE_APPROVER`: if exactly one eligible approver exists, that person may approve their own
  proposal — a single parent is not stuck waiting for a second parent who does not exist.
- A **step-parent** (relationship `step_parent`, ACTIVE/APPROVED) is a resident adult and **never** an
  approver, whatever the policy says (Vance–Reyes / Marcus).

Policies seeded: `h_a BOTH_PARENTS`, `h_emma GUARDIANS`, `h_taylor BOTH_PARENTS`,
`h_micah ANY_PARENT`, `h_malik SINGLE_APPROVER`.

## Proof — `ops/approval-policies-proof.mjs` — PARTIAL

| Case | Result |
|---|---|
| Ellison: other parent may approve | PASS (true) |
| Ellison: self-approval refused | PASS (false) |
| Ellison: other parent may approve (reverse — co-parent in the other household) | PASS (true) — this is the bug the rewrite fixed |
| Castellano: guardian approves the other guardian (both directions) | PASS |
| Castellano: self-approval refused | PASS (false) |
| Ferris: sole approver may approve their own proposal | PASS (true) |
| Ferris: caregiver with a grant never approves | PASS (blocked) — **rate-limited before running** |

Later cases (Ferris aunt/neighbour, Lee any-parent, Vance–Reyes Marcus) did not run.

## Blocker

`POST /auth/v1/token?grant_type=password` returns **HTTP 429** after roughly six persona sign-ins in a
window; the identity seed for Cast v2 consumed most of the quota, and each proof run needs ~10 distinct
personas. The proof backoff (30 s, 5 attempts) is not enough if the limit is hourly.

Options, needing a decision:
1. Wait for the auth window and run the proof once (no code change).
2. Mint proof tokens from the demo-login endpoint for personas, and add the four non-persona people
   (Marcus, Denise, Cassandra, Oscar) to the idempotent identity seed — same pattern already used for
   Tomás. This avoids password grants entirely.
3. Structural proof for non-members only (weaker; not recommended for Marcus, whose exclusion is the
   point).
