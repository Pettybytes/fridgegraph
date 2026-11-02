# 65 — Teacher school-day report, live proof (direct GraphQL; Rosina/MCP leg blocked — found, not fixed)

Requested during Bentley's proof window (W-PROOFS-ONLY / the recovery-window follow-up). Run from
a read-only, offline-scoped session against the already-running shared stack — **no restart, no
migration, no reset, no code change to the live checkouts.**

## Served revisions at the time of this proof (measured, not assumed)

- Graph + demo/API (4001–4008, `src/main.ts`, pid `15628`): checkout `fridgegraph-village-backend`,
  log `/private/tmp/fg_main_c806f46.log` — revision **`c806f46`**.
- Routers 4010/4012: supergraph composed at **`c806f46`** (confirmed live: `{ __typename }` answers
  on both).
- MCP 5051 (pid `50957`, config `/tmp/fridgegraph-mcp-c806f46.yaml`): revision **`c806f46`**,
  `mutation_mode: explicit`. `tools/list` returns **12 tools**, including `ProposeSchoolDayReport`.
- Rosina 4200 (pid `47139`, log `/private/tmp/fg_rosina_7fda69d.log`): revision **`7fda69d`**
  (`feat/rosina-school-report` merged into `feat/village-map-backend`), `provider=meta`,
  `mcp=http://127.0.0.1:5051/mcp`.
- `GET /api/demo/health`: **12/12 personas READY**, including `whitfield`.

## FINDING — the deployed MCP config is missing `forward_headers: authorization`

`/tmp/fridgegraph-mcp-c806f46.yaml` (the file the running `apollo-mcp-server-v2.1.0` process,
pid `50957`, was actually started with) has no `forward_headers:` block at all. The committed
source (`.apollo/mcp.local.yaml`) has had `forward_headers: [authorization]` since #92 — this
generated/deployed file is missing it, **not my PR's own file.**

Effect, confirmed live: **every** MCP tool call — not just the new one — returns `UNAUTHENTICATED`
for a verifiably-valid, working bearer:

- `MyChildren` via MCP (as `p_whitfield`, same token that works against the router directly):
  `UNAUTHENTICATED` at `src/authz.ts:55` (`requireCaller`), raised from
  `src/subgraphs/access.ts:325`.
- `CareFacts` via MCP (same token, same session): identical `UNAUTHENTICATED`, from
  `src/subgraphs/coordination.ts:617`.
- The **same bearer**, same instant, called directly against the router (`POST http://127.0.0.1:4010/`)
  for the identical `myChildren` query: **200, real data** (`p_nora`, scopes
  `["school.read","school.report"]`).

This is why Rosina's own chat turn fails closed for every message, not just a school-report one —
`runRosinaTurn` always calls `MyChildren` first and fails the whole turn when that call errors
(`src/rosina/model.ts`): `fg_rosina_7fda69d.log` shows `tools=mcp:MyChildren!` for every attempt in
this session, including an unrelated "Hello" message.

**Diagnosis, not a fix:** this is a deployment-config generation gap (`/tmp/fridgegraph-mcp-*.yaml`
is assembled by tooling outside this task's scope, apparently without carrying the committed
`forward_headers` setting forward), not a defect in `.apollo/mcp.local.yaml`, `src/rosina/model.ts`,
or `src/subgraphs/school.ts`. Not fixed here: changing Bentley's running process/config is his
window, not an offline task. **Rosina's conversational leg of this proof (teacher tells Rosina in
chat) is therefore BLOCKED, not passed** — recorded as blocked, not silently skipped or claimed.

## What was provable anyway — the backend contract, direct GraphQL, bypassing the blocked MCP leg

Since `proposeSchoolDayReport`/`confirmSchoolDayReport` are real GraphQL mutations (the MCP leg is
only how *Rosina* reaches propose — the mutations themselves don't depend on MCP at all), the
underlying contract was provable directly against the router. All calls below hit
`POST http://127.0.0.1:4010/` with the caller's own bearer from `POST /api/demo/login`.

### 1. Ms. Whitfield proposes, then confirms

```
mutation proposeSchoolDayReport(childId:"p_nora", kind:"health",
  text:"Nora has a fever and is asking to go home — can someone pick her up?")
→ { id: "srp_9d5f73043fcc", version: 1,
    createdAt: "2026-11-02T00:09:49.203964+00:00",
    expiresAt: "2026-11-02T00:24:49.203964+00:00" }

mutation confirmSchoolDayReport(proposalId:"srp_9d5f73043fcc", version:1)
→ { id: "sr_6fb1555f27d0", kind:"health",
    text:"Nora has a fever and is asking to go home — can someone pick her up?",
    at:"2026-11-01", reportedAt:"2026-11-02T00:09:56.719143+00:00" }
```

`reportedAt` is real and server-generated (0072's trigger, live). `at` is `local_today()` — note it
reads 2026-11-01, one day behind the UTC wall-clock date (2026-11-02T00:09Z), confirming the
America/Detroit local-day computation is in effect exactly as designed, not a UTC date.

### 2. Kendra (the parent) reads it back

```
Kendra: { schoolReports(childId:"p_nora") { id kind text at reportedAt } }
→ [{ id:"sr_6fb1555f27d0", kind:"health", text:"...", at:"2026-11-01",
     reportedAt:"2026-11-02T00:09:56.719143+00:00" }]
```

Byte-identical to what Whitfield's confirm returned.

### 3. Repeat confirm — same proposal, same version — stays one row

```
confirmSchoolDayReport(proposalId:"srp_9d5f73043fcc", version:1) [again]
→ { id: "sr_6fb1555f27d0", reportedAt:"2026-11-02T00:09:56.719143+00:00" }  [IDENTICAL]

Kendra re-reads: schoolReports(childId:"p_nora") → still exactly 1 row, same id.
```

True idempotent replay, live: the second confirm returned the exact same report and timestamp; no
second row was created.

### 4. Priya (no `school.report` grant on Nora) is refused — both propose and confirm

```
Priya: proposeSchoolDayReport(childId:"p_nora", ...) → GraphQLError, no data. REFUSED.
Priya: confirmSchoolDayReport(proposalId:"srp_9d5f73043fcc", version:1) [Whitfield's own proposal]
  → GraphQLError, no data. REFUSED.
```

Both correctly refuse — no report was created or altered either time, and Priya received no data
in either response. **Caveat on the error code, found live and not fixed here:** both responses
(and a third case — Whitfield herself proposing with blank text, which should raise
`SCHOOL_REPORT_TEXT_REQUIRED`) surfaced as the generic `extensions.code: "RPC_FAILED"` rather than
the specific `UNAUTHORIZED` / `SCHOOL_REPORT_TEXT_REQUIRED` `schoolReportProposalError` in
`src/subgraphs/school.ts` is supposed to map to. The *security outcome* (refused, zero rows
created/changed) is proven; the *exact error code reaching the client* is not — something in how
this PostgREST/supabase-js deployment surfaces this function's `RAISE EXCEPTION` message doesn't
match what the offline test suite (`school-report-proposal.test.ts`'s fake RPC) modeled. No
server-side log exists for this path to see the raw message (no `console.error` on this branch of
`schoolReportProposalError` today) and this offline-scoped session did not add one to a live
checkout. **Flagging as an open question for whoever owns the next window with log access, not
claiming a fix.**

## Not done, on purpose

- No demo reset was run (not this session's window to run one). Artifacts left in the shared
  database: proposal `srp_9d5f73043fcc` (confirmed), report `sr_6fb1555f27d0`, and one blank-text
  proposal attempt from Whitfield that raised before creating any row. Bentley's own reset covers
  these like any other sandbox test row.
- The `forward_headers` deployment gap was not patched. Not this task's checkout, not this task's
  window.
- The `RPC_FAILED` error-code question above was not debugged further (would need server-side log
  access to `src/subgraphs/school.ts`'s request handling that this offline session doesn't have on
  someone else's running process).

## Summary

| Claim | Status |
|---|---|
| Teacher tells Rosina in chat → proposal | **BLOCKED** — MCP deployment config missing `forward_headers`, affects every MCP tool, not this feature |
| Teacher confirms via the authenticated mutation | **PASS** (direct GraphQL) |
| Parent reads it | **PASS** |
| Repeat confirm stays one row | **PASS** |
| Priya / unrelated refused | **PASS** (refused; exact error code not as specified — open question, not fixed) |
