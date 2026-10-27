# 22 — practices_read: caller-relative, and the guard actually fires

Run: `node ops/practices-authz.mjs` at 2026-10-27T04:22:06.100Z.
All reads are direct PostgREST with the publishable key plus the caller's own token.

**Result: PASS** (9/9)

| Check | Result | Detail |
| --- | --- | --- |
| every non-zero row traces to a player in that group | PASS | kendra=1 dana=1 evelyn=1 (each authorized for a player) |
| callers with no authorization see zero on the same table | PASS | angela=0 gary=0 chris=0 — same table, HTTP 200 |
| Jax is a Tigers player before the test | PASS | memberships p_jax/g_tigers = 1 (player) |
| withdrew Jax (the departing player) | PASS | HTTP 200 |
| Dana moves 1 -> 0 (her access came through Jax) | PASS | dana before=1 after=0 — the guard FIRED |
| Kendra stays 1 (no-op: Nora is still a player) | PASS | kendra before=1 after=1 — access never depended on Jax |
| membership restored, exactly one row | PASS | restored HTTP 201; rows=1 role=player |
| results back to baseline | PASS | dana=1 (baseline 1) |
| reset leaves the baseline intact | PASS | dana after reset=1 |

## The reported "gap" was a bad test premise

B4 activities reported `p_dana` reading 1 row of `practices` as a gap in `practices_read`.
It is not. Jax is a **player in g_tigers** (`memberships: p_jax / g_tigers / player`), and the policy
asks:

```sql
exists (select 1 from memberships m
        where m.group_id = practices.group_id and m.role = 'player'
          and (is_parent_of(m.person_id) or has_scope(m.person_id, 'schedule.read')))
```

`is_parent_of()` and `has_scope()` are SECURITY DEFINER helpers that read `current_person()`
internally, so the predicate is already evaluated for the CALLER against a player in that
group. Dana is Jax's parent; her one row is correct access through her own child. The policy
was **not** changed, because changing it would have broken correct behaviour to satisfy a wrong
expectation. Recorded callers and their reasons:

```json
{
  "p_mom": "parent of Nora (player)",
  "p_dana": "parent of Jax (player)",
  "p_evelyn": "schedule.read grant for Jax (player)",
  "p_price": "no schedule.read, not a parent",
  "p_holt": "transport.read only",
  "p_chris": "careplan grant expired 2026-09-30"
}
```

## Why the withdrawal test exists

An assertion that nothing changes cannot tell "correctly unchanged" from "guard never ran".
Withdrawing Jax moves Dana 1 -> 0, which is how we know the predicate is really evaluated per
caller per membership rather than optimistically returning rows. Kendra staying at 1 is the
genuine no-op, and the reason is stated: Nora is still a player, so Kendra's access never
depended on Jax.

## Follow-up worth flagging (not a security fix)

`practices_read` authorizes on *any* group the player belongs to, while the `activities`
resolver only surfaces team groups. A parent with `schedule.read` for a player therefore reads
practices for that player's non-team groups too. Nothing sensitive is in that table today;
it is a scoping question, not a leak, and it is left as the policy is.
