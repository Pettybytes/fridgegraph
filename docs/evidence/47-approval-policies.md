# Evidence 47 — per-household approval policies (GREEN, 16/16)

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

## Proof — `ops/approval-policies-proof.mjs` — 16/16 PASS

| # | Case | Result |
|---|---|---|
| 1 | Ellison: the other parent may approve | true |
| 2 | Ellison: self-approval refused | false |
| 3 | Ellison: the other parent may approve (reverse — co-parent in the OTHER household) | true |
| 4 | Castellano: guardian approves the other guardian | true |
| 5 | Castellano: the other guardian approves back | true |
| 6 | Castellano: self-approval refused | false |
| 7 | Ferris: the sole approver may approve their own proposal | true |
| 8 | Ferris: a caregiver with a grant is never an approver | false |
| 9 | Ferris: the aunt is never an approver | false |
| 10 | Ferris: the neighbour is never an approver | false |
| 11 | Lee: any parent may approve | true |
| 12 | Lee: a parent may approve their own proposal | true |
| 13 | Vance–Reyes: the parent may approve the step-parent's proposal | true |
| 14 | **Vance–Reyes: Marcus is NEVER an approver** | false |
| 15 | Vance–Reyes: self-approval refused | false |

Case 3 is the bug the rewrite fixed: the old function assumed one household, so Andre — a parent living
in `h_b` while Nora is also in `h_a` — was wrongly refused.

## Rate-limit note (resolved)

Supabase Auth returned **HTTP 429** on password grants while the Cast v2 identity seed had consumed the
quota. The proof now caches short-lived demo tokens in `/tmp/fg-demo-tokens.json` (mode 600, never
printed, never committed) and paces mints, so a single successful set serves repeat runs. A 30 s
backoff remains for the first mint of a run. With that, the full 16/16 completes.

---

## Correction (2026-10-31, post-merge) — 16 → 15

The earlier text in this file said "16/16". The suite has **15 checks**; the run is **15/15 PASS**.
The earlier statement is left intact above rather than rewritten — this note is the correction of
record. Nothing about the results changes: every listed case passed.
