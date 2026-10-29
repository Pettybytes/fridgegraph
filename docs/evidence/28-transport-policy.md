# 28 — Transportation policy: an estimate exists only on the paid-ride path

**Date:** 2026-10-29
**Branch:** `fix/transport-policy` (PR #14)
**Migrations:** `0019_transport_policy.sql` (applied), `0020_transport_reply_cost.sql` (applied)
**Database:** shared Supabase, seeded after both migrations

---

## 1. The model

1. A caregiver with their own usable transport is **never** cost-checked. Drivers rank on distance,
   the documented proxy for arrival feasibility (no pickup-deadline column this release).
2. A willing caregiver **without** usable transport is `AVAILABLE_NO_TRANSPORT` and carries **no
   cost** while any driver can do the pickup.
3. A ride estimate is computed **only** on the paid-ride path — when no driver can do the pickup —
   and is compared with the household's paid-ride limit there. Over the limit it becomes a flagged
   option requiring `acceptOverLimit`; within the limit is out of scope this release.
4. A reply is **never** `OVER_POLICY` and **never** costs anyone. `accept_pickup_webhook` computes
   no estimate at all.

---

## 2. Dry run — both migrations in one rolled-back transaction

`node ops/0019-0020-dry-run.mjs`

```
hash before      : 9e1ab4267ba30d93b8becb929c36761f
hash after apply : 1ea8a6f5253e9b60762ed6b515171fed (changed)
PASS  0019 rank: no cost gate
PASS  0019 rank: null cost on driver
PASS  0019 rank: in-limit deferred
PASS  0019 rank: no-car restriction
PASS  0019 approve: ride guard
PASS  0019 approve: accept bit kept
PASS  0020 hook: no OVER_POLICY at reply
PASS  0020 hook: no estimate call anywhere
PASS  0020 hook: cost column written as null
PASS  0020 hook: dedupe intact
hash after rollback: 9e1ab4267ba30d93b8becb929c36761f (restored)
DRY RUN OK — nothing persisted
```

---

## 3. Applied

```
applied 0019_transport_policy.sql
applied 0020_transport_reply_cost.sql
hash before: 9e1ab4267ba30d93b8becb929c36761f
hash after : 1ea8a6f5253e9b60762ed6b515171fed (changed)
reply never OVER_POLICY  : true
no estimate on reply path: true
seeded 160 rows
```

A second run of the same file reports "UNCHANGED" by design — `create or replace` with identical
text is idempotent. The apply above is the one that changed the definitions.

---

## 4. Station 06 harness — 57/57

`FRIDGEGRAPH_ROUTER=http://127.0.0.1:4022/ npm run verify:station06`

```
SUMMARY 57/57 passed
```

55 assertions as they stood in PR #14, plus two added per Bryan's instruction (declining
candidates carry no cost; a driver is never costed).

| Assertion | Result |
|---|---|
| Loretta ends `AVAILABLE_NO_TRANSPORT` and is never costed | PASS |
| declining candidates carry no cost (`p_bryan`, `p_monique`) | PASS |
| a driver is never costed | PASS |
| a driver is never `OVER_POLICY` | PASS |
| Tasha recommended with no cost attached | PASS |
| the flagged option is a caregiver with no vehicle | PASS |
| the flagged option carries the ride estimate (`12.40`) | PASS |
| over-limit alternative never looks like `APPROVAL_PENDING` | PASS |
| approving an over-limit option implicitly is refused (`OVER_LIMIT_NOT_ACCEPTED`) | PASS |
| the explicit exception approves and is recorded | PASS |
| job state visible through GraphQL | PASS |

The router required `headers.all.request.propagate: authorization`; without it the subgraph
returned `UNAUTHENTICATED` and the GraphQL case failed. Config fixed, case passes.

---

## 5. Evidence suite — both clock modes

| Mode | Result |
|---|---|
| `DEMO_CLOCK=1` | **114 checks across 32 cases — PASS** (exit 0) |
| `DEMO_CLOCK=0` | **114 checks across 32 cases — PASS** (exit 0) |

Both: `ASSERTIONS: PASS — every case matched its expected status, code, count and disclosure rule.`

The suite regenerates every earlier evidence file as a side effect. Those rewrites were reverted so
this PR does not rewrite past results; only this file is added.

---

## 6. Demo walk

| Element | Observed |
|---|---|
| Loretta (driver available) | `AVAILABLE_NO_TRANSPORT`, **no cost** — `12.40` never appears at reply time |
| Declining drivers (Bryan, Monique) | no cost written |
| Tasha | `APPROVAL_PENDING`, **null** cost, ranked on distance |
| Loretta-only night (no driver) | estimate computed → flagged option at **$12.40**, never `APPROVAL_PENDING` |
| Implicit approval of the flagged option | refused (`OVER_LIMIT_NOT_ACCEPTED`), no confirmation |
| Explicit `acceptOverLimit` | approved, `over_limit_approved = true` |

---

## 7. Not done in this run

- No merge — PR #14 stays for Bryan.
- No GHL, n8n or tunnel work in this evidence file.
