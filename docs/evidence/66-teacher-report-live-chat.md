# 66 — Teacher school-day report, the Rosina CHAT leg (completing evidence 65)

Run inside the AGENT PROOF SLOT posted on PR #78 at `2026-11-02T00:28:25Z`, deadline
`2026-11-02T01:45:00Z` (verified myself via `date -u` and by confirming the claimed serving pids
were alive, running the claimed binaries, before any live call — see "Served revisions" below).
My assigned leg per that slot: "feat/teacher-persona — the Rosina chat leg of the teacher flow
(MCP works now)." Evidence 65 proved the backend contract directly over GraphQL but could not
prove the CHAT leg because the deployed MCP config was missing `forward_headers`; that has since
been repaired (PR #78 comment, `2026-11-02T00:23:20Z`). This evidence completes exactly that gap.

No restart, no migration, no reset, no seed change — read-only / write-only-to-the-feature's-own-
tables, inside the open window, as instructed.

## Served revisions (measured myself, not copied from the PR comment)

| process | revision | pid | verified |
|---|---|---|---|
| graph + demo/API 4001–4008 | `c231ba8` | 57746 | `ps -p 57746` — alive, `src/main.ts` |
| routers 4010/4012 | `c806f46` supergraph | 16254 / 16282 | `ps -p` — alive, `router-v2.18.0` |
| MCP 5051 | `cfbbb6a` config, 12 tools, forwarding ON | 45267 | `ps -p` alive; `/tmp/fridgegraph-mcp-cfbbb6a.yaml` read directly — `forward_headers: [authorization]` present |
| Rosina 4200 | `7fda69d` | 47139 | `ps -p` — alive, `src/rosina/server.ts` |
| main base | `a0ede9c` | — | matches the slot's posted value |

`GET /api/demo/health` at the time of this run: all personas `ready: true`, including `whitfield`.

## The chat leg, live, as Ms. Whitfield (`p_whitfield`)

**1. Teacher tells Rosina in chat — proposal staged via the real MCP tool call:**

> "Nora has a fever and is asking to go home, can someone pick her up?"

```json
{
  "reply": "Ready for your review — fever report for Nora stating \"Nora has a fever and is asking to go home.\"\n\nFrom the staged draft just prepared, nothing is filed, sent, or seen by a parent until you confirm that exact wording in the app. After it's confirmed, a parent can consider starting a pickup through the normal pickup flow as a separate action.",
  "actions": [],
  "schoolReportProposal": {
    "id": "srp_5d021ef2ef01", "version": 1, "childId": "p_nora", "kind": "fever",
    "text": "Nora has a fever and is asking to go home",
    "createdAt": "2026-11-02T00:36:38.511145+00:00", "expiresAt": "2026-11-02T00:51:38.511145+00:00"
  }
}
```

Rosina's own reply text, unprompted, already carries exactly the intended framing from
`systemPrompt.ts`'s SCHOOL-DAY REPORTING section: review-only language, pickup explicitly named as
a *separate*, parent-driven action, no claim that anything is filed.

**2. Her own deliberate, direct GraphQL confirm — never through Rosina/MCP:**

```graphql
mutation { confirmSchoolDayReport(proposalId: "srp_5d021ef2ef01", version: 1) {
  id child{id} kind text at reportedAt } }
→ { id: "sr_8d414c57375b", child: {id:"p_nora"}, kind:"fever",
    text:"Nora has a fever and is asking to go home", at:"2026-11-01",
    reportedAt:"2026-11-02T00:37:02.192805+00:00" }
```

**3. Kendra (the parent) reads it back, direct GraphQL:**

```
schoolReports(childId:"p_nora") → [{ id:"sr_8d414c57375b", kind:"fever",
  text:"Nora has a fever and is asking to go home", at:"2026-11-01",
  reportedAt:"2026-11-02T00:37:02.192805+00:00" }]
```
Byte-identical to the confirm response. Exactly one row.

**4. Repeat confirm — same proposalId+version — stays one row:**

```
confirmSchoolDayReport(proposalId:"srp_5d021ef2ef01", version:1) [again]
→ { id: "sr_8d414c57375b" }   — IDENTICAL id, no second row.
```

**5. Priya (no `school.report` grant on Nora) asks Rosina, in chat, to file one for Nora:**

> "Nora has a fever, please file a school report for her"

```json
{ "reply": "I can't file a school report for Nora from here.", "actions": [], "schoolReportProposal": null }
```
Plain refusal, no hint, no card — exactly as designed. (This is the ALLOWED_MCP_TOOL_NAMES +
pre-call scope gate in `model.ts` refusing before the tool is even called, since Priya holds no
`school.report` grant on Nora.)

**6. The structural guarantee, demonstrated live, not just inspected in source — Ms. Whitfield
asks Rosina to confirm it herself:**

> "Nora has a stomachache, go ahead and confirm and file that report for me right now"

```json
{
  "reply": "I've prepared your draft about Nora's stomachache — it's ready for your review.\n\nI can't confirm or file it for you — nothing is filed or sent until you confirm that exact card yourself in the app, from what you just told me.",
  "actions": [],
  "schoolReportProposal": {
    "id": "srp_b2e9ed44f953", "version": 1, "childId": "p_nora", "kind": "stomachache",
    "text": "Nora has a stomachache",
    "createdAt": "2026-11-02T00:37:44.234753+00:00", "expiresAt": "2026-11-02T00:52:44.234753+00:00"
  }
}
```
Explicitly asked to confirm, in exactly the words a real teacher might use, Rosina staged a new
draft and explicitly refused to confirm it — the model cannot reach `confirmSchoolDayReport` no
matter what it is asked, because no MCP operation file for it exists and it is not in
`ALLOWED_MCP_TOOL_NAMES`. This is the live demonstration of the structural guarantee evidence 65
and the PR could previously only show by reading source.

## Left in the shared database, on purpose (no reset was run, per instruction)

- `sr_8d414c57375b` — the confirmed fever report (plus its now-fully-confirmed proposal
  `srp_5d021ef2ef01`).
- `srp_b2e9ed44f953` — the stomachache proposal from step 6, deliberately left **unconfirmed** (I
  never called confirm on it — that would misrepresent what a real teacher did). Bentley's
  canonical reset at the window's close already has a scope-proof for exactly this
  (`ops/0073-reset-scope-proof.mjs`-equivalent for 0070–0072, per the PR #78 thread's
  "Reset gap found and fixed" note) — these are ordinary demo-identity rows for that reset.

## Summary

| Claim (from evidence 65's BLOCKED row) | Status now |
|---|---|
| Teacher tells Rosina in chat → proposal | **PASS** — real MCP tool call, real staged proposal |
| Teacher confirms via the authenticated mutation | **PASS** (already proven in #65, reconfirmed here) |
| Parent reads it | **PASS** |
| Repeat confirm stays one row | **PASS** |
| Priya / unrelated refused — now through chat, not just direct GraphQL | **PASS** |
| A model tool call can never confirm itself — demonstrated live, asked directly | **PASS** |

Evidence 65's one remaining open item (the `RPC_FAILED` vs. specific-code mapping) is addressed
separately in PR #101 (`fix(school): map school-report RPC errors by SQLSTATE...`), not re-tested
here since it was not part of this slot's assigned leg and no refusal occurred in this run.

## Addendum — re-verified after Bentley's Rosina restart (deadline extended to 02:00:00Z)

Rosina 4200 was restarted at `2026-11-02T00:40Z` (unrelated fix: `ROSINA_GRAPHQL_URL` was unset,
causing the notice-plan reader's 502s — not a defect in this feature). Same code revision
`7fda69d`, new pid `39469`. Verified health (`GET /api/demo/health`: all personas ready) and the
new pid alive before any further call.

Re-ran the teacher chat flow against the restarted process, as Ms. Whitfield:

> "Nora twisted her ankle at recess and the nurse thinks someone should pick her up"

Rosina correctly **reused and version-bumped** the earlier, deliberately-unconfirmed
`srp_b2e9ed44f953` from this same evidence's step 6 (version `1` → `2`) rather than creating a
third parallel draft — live confirmation of `propose_school_report`'s "re-proposing for the same
(proposer, child) replaces the prior unconfirmed draft" behavior, persisted correctly across the
Rosina process restart since only the database (not the process) holds that state.

Confirmed it directly (teacher's own deliberate action): `sr_fa2617d92e2a`, `reportedAt` real.
Kendra reads `schoolReports(childId:"p_nora")` and now sees **both** reports from this evidence —
the original fever report (`sr_8d414c57375b`) and this one — nothing lost across the restart.

No further refusal/structural checks were re-run: those are properties of the code (unchanged
between pids), already proven above. No restart or reset performed by me.
