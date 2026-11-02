# 72 — Add a Villager live proof: BLOCKED (found, root-caused, not fixed)

Run inside the AGENT PROOF SLOT posted on PR #78 at `2026-11-02T02:32:37Z` ("SLOT RE-OPENED
(corrected repost)"), slot window `2026-11-02T02:32:00Z` → `2026-11-02T04:02:00Z`, window N+1
close-out `2026-11-02T04:35:00Z`. Verified myself before any live call: the comment exists
verbatim as quoted (fetched directly via `gh api repos/Pettybytes/fridgegraph/issues/78/comments
--paginate`; an unpaginated fetch earlier had silently truncated at GitHub's 30-comment default
page size and missed it — noted here since it cost real time), and PR #78 is actually `MERGED`
(`state: MERGED`, `headRefOid c0ccc19c41e025fde4a0ec5abf7770ebca3f1a46`, `mergedAt
2026-11-02T02:35:28Z`), matching the slot's own "FROZEN at `c0ccc19`" line.

My assigned role per the slot: `feat/teacher-persona` — proof owner. `feat/web-graphql-adapter`
is the mounted-confirm-card participant; no comment from them had posted on #78 as of this
writing, so this report is posted first so they do not spend slot time on a call that is
guaranteed to fail for the same reason documented below.

## Served revisions (measured myself, not copied from the slot comment)

| process | claimed (slot comment) | measured | match |
|---|---|---|---|
| graph + demo/API 4001–4008 | pid `48261`, `c0ccc19` | pid alive (`ps -p 48261`), cwd `fridgegraph-village-backend` | pid confirmed; the checkout's own `git rev-parse HEAD` currently reads `d894416` (later #87 work) but `tsx` without watch mode does not hot-reload already-imported modules, so this does not change what a still-running process actually serves — noted, not assumed |
| MCP 5051 | pid `99019`, "generated from committed YAML at `c0ccc19`" | pid alive; actual loaded file is `/tmp/fridgegraph-mcp-c5d8e79.yaml` | **label mismatch** — the running config is tagged `c5d8e79`, not `c0ccc19`. Checked whether this matters: `git log --oneline c5d8e79..c0ccc19 -- .apollo/mcp.local.yaml ops/` is empty, so the operation list is unchanged between those two revisions and the mismatch is cosmetic, not functional |
| Rosina 4200 | pid `99547`, `c0ccc19` | pid alive, cwd `fridgegraph-village-backend` | pid confirmed |
| routers 4010 / 4012 | `c806f46` supergraph | pids `16254`/`16282` alive, cwd `fridgegraph-deploy-238f719`, both loading `.runs/supergraph-alt.graphql` | pid confirmed; see Finding below for what this file actually contains |
| UI 5189 | pid `1468`, main `16d6cb5` | **no process found** (`ps -p 1468` empty; `ops/stack-health.mjs` fails `ECONNREFUSED 127.0.0.1:5189`) | **stale** — not relied on for this proof per instruction ("record the mounted preview separately from 5189"); the mounted confirm card runs on its own preview port owned by `feat/web-graphql-adapter`, not 5189 |

`GET /api/demo/health` at the time of this run: 12/12 personas `ready: true`, including `dana`,
`loretta`, `priya`, `whitfield`.

## FINDING — root-caused, not a guess

**The composed supergraph served by both routers (4010 and 4012) does not include
`proposeAddVillager` / `confirmAddVillager`, even though migration `0074` is applied and the
`access` subgraph serves both mutations correctly on its own port.**

Verified in order:

1. **Schema in force claim (0074, 13 MCP ops) — confirmed.** `cat
   /tmp/fridgegraph-mcp-c5d8e79.yaml` lists exactly 13 operation paths, including
   `./ops/ProposeAddVillager.graphql`, with `endpoint: http://127.0.0.1:4010/`.
2. **Router introspection — the mutation is absent.** `Mutation` type fields returned by
   `POST http://127.0.0.1:4010/` (authenticated as Kendra) are: `grantAccess`, `revokeGrant`,
   `requestPickup`, `acceptPickup`, `approvePickup`, `orbitDraft`, `orbitPreview`, `orbitActivate`,
   `orbitRespond`, `orbitClose`, `approveConsent`, `reportSchoolDay`, `proposeSchoolDayReport`,
   `confirmSchoolDayReport`, `approveRelationship` — **no `proposeAddVillager`,
   no `confirmAddVillager`.** Router 4012 (Rosina's own `ROSINA_GRAPHQL_URL`) returns the
   identical list.
3. **Access subgraph — the mutation is present, directly.** `POST http://127.0.0.1:4002/`
   (no auth needed for introspection) returns `Mutation` fields `grantAccess`, `revokeGrant`,
   `proposeAddVillager`, `confirmAddVillager` — confirming `src/subgraphs/access.ts` is serving
   the real, current code.
4. **Exact router error, captured live, as Kendra:**
   ```
   mutation { proposeAddVillager(childId: "p_nora", personName: "Dana Coleman",
     scopes: ["pickup.request"]) { id } }
   → {"errors":[{"message":"Cannot query field \"proposeAddVillager\" on type
     \"Mutation\".","extensions":{"code":"GRAPHQL_VALIDATION_FAILED"}}]}
   ```
   Identical on both 4010 and 4012. This fails at validation, before any resolver runs — **no
   database write of any kind occurred**, so no cleanup is owed from this attempt.
5. **Live chat, as Kendra, through Rosina (the real integration path):** "Can you add Dana
   Coleman as a backup pickup for Nora?" →
   ```json
   {"reply":"I couldn't prepare that backup pickup for Nora just now.\n\nThe add request
     didn't go through, so nothing was staged for review.","actions":[],
     "schoolReportProposal":null,"addVillagerProposal":null}
   ```
   This is `src/rosina/server.ts`'s graceful-failure path (the MCP tool call errored, Rosina
   relayed a plain "didn't go through" message, never claimed success) — the same honest-failure
   shape evidence 65 found for the forward-headers gap, this time for a different root cause.
6. **Root cause located, not inferred:** both router processes (pids `16254`/`16282`, cwd
   `fridgegraph-deploy-238f719`) load `.runs/supergraph-alt.graphql`, dated `Nov 1 18:44` —
   **zero occurrences of `proposeAddVillager`** (`grep -c` confirms). Checked every other
   `supergraph*.graphql` file reachable from `/Users/user/Desktop/bentley/*` (60+ checkouts): none
   contain it either. **No already-composed file anywhere has the current `access` schema** — this
   is not a "point the router at a different file" fix, it needs an actual recompose from the
   current subgraph schemas, the same gap Bentley's own slot comment already named for #87's
   `pickupRideEstimate` ("not reachable via `/graphql` — the supergraph has not been recomposed
   this window").

## What this blocks

Every item in the required proof depends on the mutation being reachable through the router,
because that is the real integration path (Rosina's MCP tool → router; the mounted confirm card →
router; a fresh Dana session reading her own grants is unaffected, but there is nothing for her to
read since nothing can be proposed or confirmed):

- Kendra asks Rosina to add Dana → **BLOCKED** (step 5 above).
- Rosina proposes only, never confirms → not reachable, same cause.
- Kendra's explicit confirm through the mounted card (`feat/web-graphql-adapter`) → would hit the
  identical `GRAPHQL_VALIDATION_FAILED` on `confirmAddVillager`; not attempted live since the
  result is already known and attempting it would waste their slot time for no new information.
- Dana's fresh session discovering Nora with exactly the granted scopes → nothing to discover;
  not run, since running it now would only confirm the (expected, correct) absence of any grant.
- Loretta / Priya / Ms. Whitfield refused → not run; refusal of a call that cannot succeed for
  anyone proves nothing about authorization specifically.
- Concurrent duplicate confirms collapsing to one row → not reachable.
- No outreach → trivially true (nothing ran), not meaningful evidence.

**No workaround was attempted.** Calling `proposeAddVillager`/`confirmAddVillager` directly against
the access subgraph (port 4002, bypassing the router) was considered and rejected: it would not
exercise Rosina's MCP tool transport or the mounted confirm card, which are exactly what this
proof exists to verify, and would misrepresent a subgraph-level check as an integration proof.

## What IS confirmed, for the record

- Migration `0074` (`villager_proposals`) is live and the `access` subgraph's resolvers are the
  current, correct code (step 3).
- The MCP config correctly lists `ProposeAddVillager.graphql` among its 13 operations with
  `forward_headers: [authorization]` present (confirmed by reading
  `/tmp/fridgegraph-mcp-c5d8e79.yaml` directly) — the MCP *configuration* is not the blocker here,
  unlike the earlier `forward_headers` gap in evidence 65.
- 12/12 demo personas ready, including every persona this proof needs (`dana`, `loretta`,
  `priya`, `whitfield`, `kendra`).
- No restart, reset, or recompose was performed or requested by me. No database write occurred
  (every failure was pre-resolver validation). Nothing needs to be cleaned up from this run.

## Summary

| Required step | Status |
|---|---|
| Serving migration/tool contract verified before confirming | **Checked — contract NOT met**: subgraph has it, router does not |
| Kendra asks Rosina to add Dana (chat) | **BLOCKED** — router lacks the field |
| Rosina proposes only | not reachable |
| Kendra's explicit confirm (mounted card) | not reachable (same cause); not attempted, to avoid wasting `feat/web-graphql-adapter`'s slot time |
| Dana's fresh session sees exactly the granted scopes | not run — nothing to grant |
| Loretta / Priya / Ms. Whitfield refused | not run — not meaningful while the call cannot succeed for anyone |
| Concurrent duplicate confirms → one row | not reachable |
| No outreach | trivially true, not meaningful evidence |

**Precise dependency for Bentley:** recompose the supergraph from the current subgraph schemas
(the `access` subgraph already serves the correct code on port 4002) and restart both router
processes (pids `16254`, `16282`) onto the new composed file. No code change is needed in
`feat/add-villager`'s merged work (#104) — the gap is entirely in supergraph composition /
deployment, the same class of gap already named for #87's `pickupRideEstimate` in this same slot.

Receipt posted to #78; slot released explicitly below. Reservation for evidence `72` stands;
re-run is the very next thing this branch does once the recompose is confirmed served.
