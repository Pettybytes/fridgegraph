# Evidence 48 — MyChildren, per-child scopes

_Branch `feat/my-children`. **Stacks on #41** (Piece 3): merge #41 first and this diff becomes
MyChildren only._

## Contract

`myChildren: [ChildAccess!]!` returns each child the caller holds **something** for, with **exactly the
scopes held for that child**. `ChildAccess { child: Child!, scopes: [String!]! }`.

- Authority (parent/guardian membership in a household the child lives in) → the full read set.
- A grant → **only the scopes that grant names**, date-window filtered.
- Scopes are never unioned across children, and never inferred from one another.

MCP `MyChildren` is read-only and listed under **Rosina tools available**.

## The rule being proven

**`careplan.read` on Malik grants care facts and nothing else** — no calendar, no pickup request, no
approval authority. Priya's baseline Nora grant is separate and unchanged.

Data change: `g_priya_malik` scopes narrowed to `['careplan.read']` (was `careplan.read` + `schedule.read`).

## Proof — `node ops/my-children-proof.mjs` — 14/14 PASS

| # | Check | Result |
|---|---|---|
| 1 | Priya sees both children she holds anything for | `p_malik, p_nora` |
| 1 | Malik is one of them | ✓ |
| 2 | Malik carries **only** `careplan.read` | `["careplan.read"]` |
| 2 | the two children are **not** merged into one scope set | ✓ |
| 3 | care facts ARE readable with that scope | 3 facts |
| 4 | the calendar is **NOT** readable | `UNAUTHORIZED` |
| 5 | no approval authority from a care-plan scope | `false` |
| 6 | baseline Nora grant separate and intact | `["careplan.read","schedule.read","supervise.request"]` |
| 7 | a parent sees her own child | `p_jax` (Dana) |
| 7 | an adult with no authority and no grant sees `[]` | `0` (Oscar) |
| 8 | a parent sees her children with the full read set | `p_leo, p_max, p_nora` |
| 9 | MCP `MyChildren` matches GraphQL exactly | 2 children |

Two assertions were wrong in the first run and were corrected, not the implementation: Priya sees **two**
children (Malik by grant, Nora by her baseline grant), and Dana is Jax's **parent**, so she is not a
no-oracle control — Oscar is.
