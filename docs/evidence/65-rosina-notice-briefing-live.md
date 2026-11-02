# Evidence 65 — Rosina Notice→Plan + Caregiver Briefing, live (AGENT PROOF SLOT)

Append-only. This records the live checks for `feat/rosina-service`'s leg of the AGENT PROOF SLOT on
PR #78. Failed/blocked results are preserved, not overwritten.

## Window & serving revisions (from the #78 slot comment, verified where possible)

- **Window:** AGENT PROOF SLOT opened `2026-11-02T00:28:25Z`, deadline `2026-11-02T01:45:00Z`.
- **Serving, per process** (as announced): graph + demo/API 4001–4008 `c231ba8` (pid 57746); routers
  4010/4012 `c806f46` supergraph (16254/16282); **MCP 5051 `cfbbb6a`, 12 tools, forwarding ON**
  (pid 45267); **Rosina 4200 `7fda69d`** (pid 47139); UI 5189 `dd14400` (unchanged); main base
  `a0ede9c`.
- **Self-verified:** `POST /api/rosina/notice-plan` unauthenticated → **401** (routes ON ⇒
  `ROSINA_PROPOSAL_SIGNING_KEY` present); `POST /api/rosina` → 401. Rosina SHA not independently
  probed (no version endpoint) — recorded as announced.
- My runs: ~`00:35Z`–`00:38Z`. No resets/restarts/seeds by me. I created no jobs.

## 1. Grant verification — PASS (live `myChildren` via router 4012, as each persona)

Different scopes, **not a hierarchy**:

| Persona | personId | `p_nora` effective scopes |
|---|---|---|
| Kendra (parent) | `p_mom` | `address.read, careplan.read, contacts.read, goals.read, pickup.request, pickup.verify, schedule.read, school.read, transport.read` |
| Loretta (grandmother) | `p_gma` | `goals.read, pickup.request, schedule.read` — **no `careplan.read`** |
| Priya (sitter) | `p_priya` | `careplan.read, schedule.read, supervise.request` (and `careplan.read` only on `p_malik`) |

## 2. Caregiver briefing — PASS (live, MCP tool path as the caller)

Prompt (as each persona): *"What do I need to know about Nora for today, 2026-10-26?"* → `POST /api/rosina` → 200.

**Loretta** (schedule, no care):
```
Scheduled for 2026-10-26:
  • 08:15 — School at Room 12, Lincoln Elementary

Not visible to you:
  • Nora Ellison's care notes
  • check-in status
```

**Priya** (schedule + care):
```
Scheduled for 2026-10-26:
  • 08:15 — School at Room 12, Lincoln Elementary

Care notes:
  • bedtime: Lights out 8:30pm on school nights (recorded, confirmed)
  • snack: Peanut-free snack only — no nuts, no shared utensils (recorded, confirmed)
  • tv: 30 minutes after homework; screens off by 8pm (recorded, confirmed)

Not visible to you:
  • check-in status
```

Both see the schedule; **Priya sees care notes, Loretta does not**; neither (non-parent) sees the
check-in. "scheduled" wording, "(recorded, confirmed)", and "Not visible to you" all as designed. The
trust boundary is a difference of scopes, shown on the same child and day. **MCP `forward_headers`
fix confirmed working** — the briefing reads run as the caller.

## 3. Notice samples (a/b/c) — BLOCKED (preserved failure), deploy config not logic

`POST /api/rosina/notice-plan` for each sample returned **502 `{"error":"NOTICE_ERROR"}`** (the
route-level catch — the prepare handler threw). Sample (c)'s follow-up confirm returned `400
INVALID_PROPOSAL` (no valid envelope, because prepare failed). These failed results are kept.

**Root cause (proven):** the handler's schedule read throws `SCHEDULE_READ_FAILED` because Rosina
4200's `ROSINA_GRAPHQL_URL` is unset, so it defaults (from `ROSINA_MCP_URL`) to the **MCP** port:

| endpoint (as Kendra) | result |
|---|---|
| `POST http://127.0.0.1:5051/graphql` (where Rosina's read goes) | **404** (MCP port, no GraphQL) |
| `POST http://127.0.0.1:5051/mcp` | 406 (MCP endpoint) |
| `POST http://127.0.0.1:4012/` (the router — where it SHOULD go) | **200**, `events(p_nora,2026-10-26)` = `School 08:15–15:00, Room 12, Lincoln Elementary`; `effectiveScheduleFor WEEKLY` |

The read the pipeline needs works at the router (the 15:00 end is exactly the conflict the 12:30
notice creates). **Fix:** set `ROSINA_GRAPHQL_URL=http://127.0.0.1:4012/` on Rosina 4200 (requires a
Rosina restart — Bentley's). This also blocks #90's single sample-(a) confirm, which routes through
the same Rosina notice endpoint.

**Sample-(a) job observation:** `coordinationJobs(p_nora)` showed **no `pickup:p_nora:2026-10-26:afternoon`**
job (expected — the pipeline is blocked for everyone). Other pickup jobs present belong to Bentley's
pricing proof (`proof-…`/`paid-proof-…`) and seeded fixtures (`job_nora_oct16`); untouched.

Reported on #78 (comment 6566313754). Bentley restarting Rosina with `ROSINA_GRAPHQL_URL` set.

## 4. Continuation — pending "agents resume"

After Rosina restarts with `ROSINA_GRAPHQL_URL`, this section will be appended with: samples (a)
prepare + observation of #90's single real confirm (job keyed `pickup:p_nora:<scenarioDate>:afternoon`,
idempotency = one key→one job), (b) clarification→resume (no confirm), (c) review-only→confirm 422,
each with the served model ID. The results above are not modified.
