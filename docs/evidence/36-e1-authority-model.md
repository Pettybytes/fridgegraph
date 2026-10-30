# Evidence 36 — E1: the four-fact authority model

_Group 2, branch `feat/e-group2` off `main` `275461e` (which includes #9 and #22). 2026-10-30._
_(35 is reserved for Task R — Claude Code's Rosina service. See HANDOFF.)_

## 1. What changed — the four direct edits

| # | Object | Before | After |
|---|---|---|---|
| 1 | `household_members.role` check | `in ('parent','child')` | `in ('parent','guardian','resident_adult','child')` |
| 2 | `is_parent_of(child)` | `caller_m.role = 'parent'` | `caller_m.role in ('parent','guardian')` |
| 3 | `parent_ids_of(child)` | `m.role = 'parent'` | `m.role in ('parent','guardian')` |
| 4 | `src/authz.ts` — `isParentOf`, `parentIdsOfChild` | `.eq('role','parent')` ×2 | `.in('role',['parent','guardian'])` ×2 |

Applied as `supabase/migrations/0024_authority_model.sql` (forward-only; 0001–0023 untouched).
`0023` is E0's promotion migration on #23; the contract's original `0023_authority_model` number was
re-checked and this work takes the next free number.

Everything that calls these functions inherits the widening — the 20 RLS policies that call
`is_parent_of`, `pickup_candidates_for`, `request_pickup`, `consume_real_call_authorization`, and the
13 TypeScript call sites — with **zero** further edits, as the contract listed.

## 2. Post-apply state (read back, not assumed)

```
role check: CHECK (role = ANY (ARRAY['parent','guardian','resident_adult','child']))
is_parent_of: role in ('parent','guardian')
parent_ids_of: role in ('parent','guardian')
```

## 3. Dry run — `node ops/0024-dry-run.mjs` — 12/12 PASS, rolled back

One transaction; the probe uses a real identity (queried at runtime, never hardcoded), inserted as a
member of Nora's household and rolled back afterwards.

| Check | Observed |
|---|---|
| check accepts `guardian` | yes |
| check accepts `resident_adult` | yes |
| unknown role (`cousin`) | rejected by `household_members_role_check` |
| claims resolve to the probe person | yes (`current_person()` = the member under test) |
| `resident_adult` is **not** a parent | `is_parent_of` = **false** |
| `resident_adult` not in `parent_ids_of` | `[]` |
| `guardian` **is** a parent | `is_parent_of` = **true** |
| `guardian` appears in `parent_ids_of` | includes the probe person |
| both function bodies carry the widened list | yes |
| rollback | household_members 10→10, people 23→23 |

**`resident_adult` grants nothing by residence**, exactly as specified: authority still has to come
from ordinary `grants` rows.

## 4. Suites

- Graph suite: **114 checks / 32 cases PASS** — the pickup assertions are unchanged by the widening
  (this branch does not carry #23's extra 14b data assertion; on #23 the count is 115).
- `ops/voice-turn-check.mjs`: **15/15**.
- `npm run typecheck`: clean.
- `npm run check`: **0 findings**.

## 5. What did not change

`relationships.type` stays descriptive and grants nothing. No existing fixture, seed row or evidence
file changed — this is a widening, and every existing `role: 'parent'` row already satisfied the new
constraint.

## 6. Rosina tools

None added by E1. No new read; the widening changes authorization for existing reads only.
