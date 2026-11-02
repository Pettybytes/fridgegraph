# Evidence 66 — MCP forwarded no token: every tool answered UNAUTHENTICATED

**Window:** MCP repair, 2026-11-02 ~00:19–00:23Z (timestamps from `date -u`).
**Serving:** graph + 4001–4008 `cfbbb6a` (pid 57746) · routers `c806f46` · MCP `cfbbb6a` config (pid 45267) · Rosina `7fda69d` (47139) · main base `a0ede9c`.

## The failure (preserved, not overwritten)

The MCP server was running a config that had been **hand-assembled** during the cutover window instead of generated from `.apollo/mcp.local.yaml`. It lacked:

- `forward_headers: [authorization]`
- `search`, `validate` (also dropped from the same hand-written file)

With no header forwarded, the router received anonymous requests. A valid Kendra session produced:

```json
{"data":null,"errors":[{"message":"UNAUTHENTICATED","path":["myChildren"],"extensions":{"code":"UNAUTHENTICATED"}}]}
```

and Rosina returned `200` with `"I couldn't check that just now."` for every turn, including "Hello".

**Why the earlier HEALTHY receipt was insufficient:** it asserted `status 200` and "a payload". The payload *was* the error. A transport-level check cannot distinguish a working tool path from a fail-closed one.

## Root cause, stated exactly

`ops/alt-stack.sh` did generate from the committed file, but the window's config was written by hand at `/tmp/fridgegraph-mcp-c806f46.yaml`. Nothing regenerated it, and nothing compared it to the committed file. The committed file was correct the whole time.

## The fix

1. **`ops/gen-mcp-config.mjs`** — generates ONLY from `.apollo/mcp.local.yaml`, rewriting the endpoint, the port, the schema path and the operation paths. It parses both files and **refuses to write** when any top-level key from the committed file is missing, when `forward_headers` does not carry `authorization`, or when `mutation_mode` is not `explicit`. `ops/gen-mcp-config.test.mjs` asserts those properties on the **generated output** (5/5), including the two refusal cases.
2. **`ops/alt-stack.sh`** — `gen_mcp_config` now calls that generator and exits on refusal; the hard-coded "11 operations" and the inline re-assembly are gone.
3. **`ops/stack-health.mjs`** — parses the MCP result envelope **and** the nested GraphQL body: fails on tool errors, GraphQL errors, `UNAUTHENTICATED`, or fewer than one child; the expected child set comes from the authoritative `myChildren` read, never a guess. Anonymous MCP callers must be refused. The Rosina turn now asks **"Who are my children?"** and must name the children — a greeting or a fluent reply is not proof.

## Verification (this window)

| check | result |
|---|---|
| tools listed | **12**, includes `ProposeSchoolDayReport` |
| `confirmSchoolDayReport` through MCP | **absent by design** (no operation file) |
| `MyChildren` as Kendra | **3 children**, no GraphQL codes |
| anonymous `MyChildren` | **UNAUTHENTICATED** (refused, not empty) |
| Rosina "Who are my children?" | `200`, names **3/3** (Leo, Max, Nora) |
| `stack-health` | **HEALTHY (0 failing)**, cast `f022ccf8311e7561` |

## Reset gap found by the same check

The canonical reset left `srp_9d5f73043fcc` (proposal) and `sr_6fb1555f27d0` (report) behind: neither table carries a `sandbox` column, so `resetDatabase()` never touched them.

**`0073_reset_demo_school_reports.sql`** (applied) deletes proposals whose `actor_id` is a demo identity, plus the reports those proposals confirmed. Running it removed **2 proposals and 2 reports**; both named ids are gone (0 rows).

**Limitation, stated rather than guessed:** a report filed directly through `reportSchoolDay` (0070) has no provenance column, so it cannot be scoped safely and is **not** covered. The follow-up is to give that write path a demo/provenance marker — not to delete rows by id prefix or time window.
