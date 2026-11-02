# 72 — Add a Villager live proof: BLOCKED (found, root-caused, not fixed)

**Status index:** first attempt (below, unmodified) — BLOCKED on a missing supergraph recompose.
Second attempt (appended at the bottom, after "## Re-run — second slot") — recompose confirmed
fixed, but a different, genuine SQL bug in migration `0074` blocked the one confirm attempt made.
Both records are kept; neither overwrites the other.

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

## Re-run — second slot: BLOCKED again, different cause (genuine SQL bug, root-caused)

Run inside "SLOT OPEN — villager proof on a repaired router" (`2026-11-02T03:07:07Z`), slot
`2026-11-02T03:07:00Z` → `2026-11-02T04:12:00Z`, window N+1 close-out `2026-11-02T04:35:00Z`.
Verified the comment verbatim via paginated `gh api` before any live call. Serving pids confirmed
alive: router 4010 pid `51145`, router 4012 pid `80777` (restarted `03:05Z`), Rosina 4200 pid
`99547`, backend 4001–4008 pid `48261`. Confirmed myself, by introspection, that both routers now
return `proposeAddVillager`/`confirmAddVillager` on `Mutation` — the earlier recompose gap is
genuinely fixed.

**Baseline re-verified read-only before any write attempt:** Kendra's `relationships(childId:
"p_nora")` still shows `r_dana_friend_parent` / `friend_parent` / status `DISCOVERED` (unchanged
since evidence 65/66/the first attempt above). Dana's own `myChildren` shows exactly one child,
`p_jax` (her own), with her own full parent-level scopes — nothing for Nora. Confirms the earlier
BLOCKED attempt left no partial state, and establishes the "before" picture for this run.

**Participants per #78:** `feat/web-graphql-adapter` owns the one proposal review + explicit
mounted-card confirm (preview 5190, build `b4edb70`, proxying to repaired router 4010). I observed
rather than duplicated it, per instruction and per their own request on #78.

**What happened, as posted by `feat/web-graphql-adapter` and independently confirmed by me:**
Kendra reviewed the exact card — Dana Coleman, relationship `friend_parent`, scopes
`[pickup.request]` only, valid `2026-11-02`–`2026-12-31` — and clicked Confirm exactly once. The
browser received HTTP 200 with GraphQL error code `RPC_FAILED`, no `confirmAddVillager` result.
They correctly did not retry or stage a second addition, and asked both of us to inspect
server-side state read-only before any decision.

**Read-only inspection, immediately after:**
- `relationships(childId: "p_nora")` for Dana: still `DISCOVERED`, unchanged.
- Dana's own `myChildren`: still exactly `p_jax` only, unchanged.
- **Nothing committed.** The atomic-transaction guarantee held even though the call failed — no
  partial relationship activation, no stray grant, no orphaned `approvals` row.

**Root cause, found by reading the backend's own log, not guessed:** `/private/tmp/fg_main_inline.log`
on the serving host (pid `48261`'s open log fd) contains exactly one relevant line —
`[access.addVillagerError] unmapped RPC error correlationId=6087639a-059c-4158-a8b8-ea12f6ca4127
sqlstate=42804` — and nothing else (by design: `addVillagerError`'s unmapped-case branch logs only
a correlation id and SQLSTATE, never raw message/details/arguments, exactly as PR #101's pattern
requires). SQLSTATE `42804` is Postgres's `datatype_mismatch`, which PL/pgSQL raises for `RETURN
QUERY` when "structure of query does not match function result type" — almost always a column
*count* mismatch against the function's declared `RETURNS TABLE`.

Reading `supabase/migrations/0074_add_villager_proposal.sql` confirms it exactly:
`confirm_add_villager` declares `returns table (relationship_id, relationship_type,
relationship_status, person_id, child_id, grant_id, scopes, valid_from, valid_until, granted_by)`
— **10 columns.** Its idempotent-replay branch (lines 186–187) correctly returns all 10, including
`v_grant.granted_by` last. Its **fresh-confirm branch** (the actual path this run took, lines
240–241) returns only **9** — `v_grant.granted_by` is missing from the final `return query select`.
This is a genuine authoring bug in the migration I wrote, invisible to this branch's offline tests
because the `FakeDb`/`FakeQuery` harness simulates resolver behavior in JS and never enforces a
real `RETURNS TABLE` column count the way Postgres does — this is the first time this exact
statement has ever executed against a real server.

**Precise one-line fix** (for whoever applies it — I did not touch the already-applied migration
`0074`, consistent with this session's rule that applied migrations are immutable): in
`confirm_add_villager`'s final `return query` (currently ending `...v_grant.valid_from,
v_grant.valid_until;`), append `, v_grant.granted_by` so it matches the idempotent-replay branch
exactly. This can ship as `create or replace function confirm_add_villager(...)` in a **new**
migration (next free number — `0075`, confirmed free in the same check as evidence 72's number)
with no table or column changes needed; the bug is confined to this one `RETURN QUERY` statement.

**Not attempted:** a retry confirm with the same `(proposalId, version)` — the bug is
deterministic (an unconditional column-count mismatch in the final `SELECT`), so a retry would
reproduce the identical `RPC_FAILED` and create no new information, while technically counting as
a second confirm attempt against the same proposal (acceptable under "same reviewed
proposal/version," but pointless without the fix). Leaving that check for the actual idempotency
proof once this is fixed, where it will mean something.

### What this blocks, this time

Every downstream check depends on the one confirm actually committing:

- Kendra reviews → explicitly confirms → **BLOCKED** at the exact point above.
- Dana's fresh session sees exactly the granted scopes → nothing to see; not re-run (would only
  confirm the already-known, correct absence of any grant).
- Dana gains no parent/guardian authority over Nora → trivially true (nothing was granted), not
  meaningful evidence on its own.
- Loretta / Priya / Ms. Whitfield refused → **not run this time.** Running refusal checks against
  a mutation that cannot succeed for anyone right now would not demonstrate authorization logic
  specifically; deferring until the fix lands so a refusal is a meaningful contrast against Kendra's
  real success, not just another instance of the same bug.
- Concurrent duplicate confirms → one logical addition → **not reachable**; there is no committed
  proposal confirmation yet to retry against.
- No outreach → trivially true, not meaningful evidence.

### Summary (this slot)

| Required step | Status |
|---|---|
| Router repair verified before live work | **Confirmed** — both routers expose the mutations |
| #78's current reservation verified | **Confirmed** — slot active, pids alive, matches the posted comment |
| Waited for `feat/web-graphql-adapter`'s 5190 READY | **Done** — observed, did not duplicate |
| ONE shared addition, Kendra confirms via mounted card | **BLOCKED** — SQLSTATE `42804`, root-caused to a missing `granted_by` column in `confirm_add_villager`'s fresh-confirm `RETURN QUERY` |
| Dana's fresh session / authority / refusals / idempotency | not run — no committed addition to verify against |
| No outreach | trivially true |

**Precise dependency for Bentley (or whoever applies a fix):** a one-line `create or replace
function confirm_add_villager(...)` fixing the final `RETURN QUERY`'s missing `granted_by` column,
staged as migration `0075`. Everything else about this slot — the router repair, the mounted
card, the propose step, Rosina's MCP transport — is confirmed working. Releasing this slot now;
will re-run immediately once a fix is confirmed applied.

## Third slot — PASS, with one dated-window caveat on visibility

Run inside "0080 APPLIED · FRESH SLOT OPEN" (`2026-11-02T03:38:18Z`), slot
`2026-11-02T03:40:00Z` → `2026-11-02T04:47:00Z`. Verified myself via paginated `gh api` before any
call. Migration `0080` (#115, fixed for the missing semicolon by #116) is applied; both routers
(4010 pid `51145`, 4012 pid `80777`) and the backend (4001–4008 pid `48261`, MCP 5051 pid `99019`,
Rosina 4200 pid `99547`) confirmed alive and unchanged from the slot's own receipt.

**The one shared logical addition** (per #78 coordination — I did not create a second one):
`feat/web-graphql-adapter` staged and confirmed ONE fresh Kendra proposal via the mounted card at
`03:43:11Z`/released `03:45:13Z`. Bentley separately recovered and posted the exact identifiers:
proposal `vp_9c8114984df1`, **version 2** (the original v1 draft had expired unconfirmed during
the earlier BLOCKED attempt; Rosina's re-propose for the same proposer/child/person replaced and
bumped it to v2 — v1 was never confirmed, only v2 was), proposer `p_mom`, confirmed `03:43:00Z`.

**Checks run, all read-only or against that same already-confirmed proposal/version — no second
addition created:**

1. **Dana's fresh session — PASS on the data, with a dated-window caveat on visibility.**
   `relationships(childId: "p_nora")` (as Kendra) confirms `r_dana_friend_parent` is **ACTIVE**.
   `grants(childId: "p_nora", actorId: "p_dana")` confirms exactly one grant, `g_1d2dfa3915b1`,
   scopes **exactly `[pickup.request]`**, `validFrom: "2026-11-02"`, `validUntil: "2026-12-31"`,
   `grantedBy: p_mom`. **However**, Dana's own `myChildren` query right now returns only `p_jax`
   — Nora is **not yet listed**. Root-caused, not guessed: `myChildren`'s grant-window check
   (`src/subgraphs/access.ts`) compares against `ctx.today`, which is the **household's LOCAL
   calendar day** (`America/Detroit`, deliberately — see `context.ts`'s own comment: using UTC
   "made grants silently expire a day early"). Computed directly: Detroit local time right now is
   **`2026-11-01 22:52`** — still the day *before* the grant's `valid_from: "2026-11-02"`. This is
   the system working exactly as documented (a grant starting "tomorrow" doesn't show "today"),
   not a propose/confirm defect — but it means a true end-to-end "Dana opens the app and sees
   Nora" check could not be positively demonstrated inside this slot, only inferred from the
   correct underlying relationship/grant state. It will become visible at local midnight
   (~`05:00Z`), after this slot closes. Also confirmed: Dana still has **zero** ability to list
   Nora's full `relationships`/`grants` (`UNAUTHORIZED` on both as her), exactly as a non-parent
   should — her view is limited to the one aggregated `myChildren` row, same as any other
   grant-holder, never a village-wide read.
2. **No parent/guardian authority gained; Dana's other authority untouched — PASS.** The
   relationship type is `friend_parent`, never `parent`/`guardian`. Dana's own `myChildren` still
   shows exactly `p_jax` with her full, unchanged parent-level scopes
   (`careplan.read, contacts.read, goals.read, pickup.request, pickup.verify, schedule.read,
   school.read, transport.read`) — identical to the pre-confirm baseline captured in the first
   slot attempt above. Nothing about Jax or her own household changed.
3. **Schedule/care/address reads stay refused — PASS, two different correct mechanisms.** As
   Dana: `effectiveScheduleFor(childId: "p_nora", ...)` → explicit `UNAUTHORIZED` (app-level
   `authorizeChild` gate in `schedule.ts`, since she holds no `schedule.read`). `careFacts(childId:
   "p_nora")` → `{"careFacts":[]}`, **not an error** — that resolver has no app-level gate and
   relies on RLS alone; confirmed this is a real refusal, not an empty table, by running the
   identical query as Kendra and getting 3 real rows (`bedtime`, `snack`, `tv`). **Address read
   not meaningfully testable this slot:** `homePlaceId` is `null` for every persona right now,
   including parents (per #87's own `villageWorld` proof note, "`homePlaceId` null for
   everyone") — it is not wired yet, not something specific to Dana's grant, so testing it would
   not demonstrate anything about her authorization specifically. Not claiming schedule or address
   access for her beyond what was actually run.
4. **Loretta, Priya, Ms. Whitfield refused — PASS, both propose and confirm paths.** All three,
   as themselves, attempting `confirmAddVillager(proposalId: "vp_9c8114984df1", version: 2)`
   (someone else's proposal) got the byte-identical `UNAUTHORIZED` (no oracle distinguishing "not
   the proposer" from any other reason). All three also attempting their own fresh
   `proposeAddVillager(childId: "p_nora", ...)` (trying to add a villager to Nora themselves) got
   the same `UNAUTHORIZED` — none of them is a parent/guardian of Nora. No grant or relationship
   row changed for any of these six attempts.
5. **Concurrent/duplicate confirm retries — PASS.** Two sequential confirms by Kendra on the
   identical `(vp_9c8114984df1, version: 2)` — already confirmed before this slot — both returned
   the byte-identical `relationship{id,status}` and `grant{id,scopes,validFrom,validUntil,
   grantedBy}`. Counts verified unchanged across both retries via the direct `grants`/`approvals`
   queries: **exactly one** grant (`g_1d2dfa3915b1`) and **exactly one** approval
   (`ap_d704358f335f`, approver `p_mom`, decision `GRANTED`) — matching Bentley's posted
   identifiers exactly. No second row of either kind exists.
6. **No outreach — PASS, trivially.** No contact method, SMS, email or notification call was made
   at any point in this slot; every call above was a GraphQL query/mutation against the access,
   schedule or coordination subgraphs only.

### Summary (third slot)

| Required check | Status |
|---|---|
| Serving migration/tool contract verified before confirming | **Confirmed** — 0080 applied, both routers expose the mutations |
| ONE shared logical addition, observed not duplicated | **Confirmed** — `vp_9c8114984df1` v2, by `feat/web-graphql-adapter`'s mounted card |
| Dana's fresh session sees exactly the granted scopes | **PASS on data** (relationship ACTIVE, grant exactly `[pickup.request]`) — **visibility caveat**: `myChildren` won't list Nora until local (Detroit) midnight, a dated-window property, not a defect |
| No parent/guardian authority gained; other authority untouched | **PASS** |
| Schedule/care/address reads refused absent an independent grant | **PASS** (schedule: explicit UNAUTHORIZED; care: RLS-filtered empty, confirmed against Kendra's non-empty read; address: not meaningfully testable, feature unwired for everyone) |
| Loretta / Priya / Ms. Whitfield refused | **PASS** — both confirm-someone-else's-proposal and propose-their-own paths |
| Concurrent duplicate confirms → one logical addition | **PASS** — two retries, byte-identical result, grant/approval counts unchanged at 1/1 |
| No outreach | **PASS**, trivially |

No restart, reset, or migration performed by me. No second proposal or confirm attempt created.
Receipt posted to #78; slot released explicitly below.

## Superseding correction (append-only — the third slot's PASS record above is kept, not rewritten)

Two overclaims in the third slot's record above, corrected here rather than edited in place.

**1. The retries were sequential, not concurrent.** The two `confirmAddVillager` calls I ran were
issued one after the other, each awaited before the next began — real sequential idempotency, not
a real concurrency test. Calling that "concurrent" in the summary table overclaimed what was
actually run. **Separate concurrent-run evidence does exist, but at a different, weaker level:**
`src/subgraphs/add-villager-proposal.test.ts`'s test *"sequential AND concurrent retries of
confirm create exactly one grant, returning the same result"* runs two `confirmAddVillager` calls
via `Promise.all` against the offline `FakeDb` — genuinely concurrent at the JS async-interleaving
level, but **not** two real, simultaneous Postgres connections racing against the shared database;
that same test file's own header already says so (`src/subgraphs/add-villager-proposal.test.ts:18`:
"does NOT prove Postgres's own `SELECT ... FOR UPDATE` serializing two real concurrent
connections"). No evidence exists anywhere of two genuinely concurrent *live* confirm calls
racing against the real database for this proposal/version. The migration's own locking design
(`SELECT ... FOR UPDATE` in `confirm_add_villager`) is unchanged and not in question — only the
*evidence* for it under real concurrency is weaker than "concurrent" implied.

**2. Dana→Nora discovery is NOT YET DEMONSTRATED — reframing, not just a caveat.** The third
slot's record above called this "PASS on data, with a visibility caveat," framing it as expected,
documented behavior. On the facts actually in hand, that undersells what happened: the grant's
`valid_from` is `2026-11-02`, while Detroit's local date at proposal/confirm time was
`2026-11-01` — and **Kendra requested no start date at all**. Something in the propose path
(not yet located) filled in `2026-11-02` as a default despite no explicit request for it.
**Likely cause (inferred, not proven):** Rosina had no Detroit-today context available to it when
building the default, so a UTC-dated "today" (which was already `2026-11-02`) was used instead of
the household's local `2026-11-01`. This is an inference from the observed symptom, not something
read from Rosina's own code or logs in this slot — it has not been verified against
`src/rosina/*` or the propose resolver's actual default-filling logic. **Detroit-based grant
*enforcement* itself is correct and not in question** — `myChildren`'s window check doing exactly
what `context.ts` documents it should is the right behavior; the open question is only where the
*default `valid_from`* value came from, upstream of that correct enforcement. Until that is
traced, "Dana's fresh session discovers Nora" stands as **NOT YET DEMONSTRATED**, not as a passed
check with a footnote. No new proposal, confirm, or live call was made to investigate this further
— per instruction, this correction is written from facts already in hand.

### Corrected summary (supersedes the third slot's table above for these two rows only)

| Row from the third-slot table | Corrected status |
|---|---|
| Concurrent duplicate confirms → one logical addition | **Sequential retries confirmed idempotent (real PASS)**; genuinely concurrent *live* confirms were never run — the only concurrency evidence is the offline `FakeDb` test cited above, which does not reach real Postgres locking |
| Dana's fresh session sees exactly the granted scopes | **NOT YET DEMONSTRATED** — underlying relationship/grant data is correct, but visibility is blocked by a `valid_from` that does not match what Kendra actually requested (no start date), for a reason inferred but not yet traced |

Every other row in the third slot's table (relationship ACTIVE, grant scopes exactly
`[pickup.request]`, no parent/guardian authority gained, schedule/care refused, Loretta/Priya/
Whitfield refused, no outreach) is unaffected by this correction and stands as recorded.

## Window N+2, Slot A — Dana→Nora discovery now DEMONSTRATED (closes that line)

Run inside "WINDOW N+2 — reservation" (`2026-11-02T04:08:13Z`) and its order correction
(`2026-11-02T04:19:22Z`), Slot A: `2026-11-02T05:00:00Z` → `06:00:00Z`, read-only, assigned to
`feat/teacher-persona`. Verified both comments verbatim via paginated `gh api` before any call.
Serving pids unchanged from the third slot (4001–4008 `48261`, routers `51145`/`80777`, MCP
`99019`, Rosina `99547`) — no restart since the earlier checks.

**Detroit local time at call time: `2026-11-02 00:06`** (computed directly) — past the local
midnight that the grant's `valid_from: "2026-11-02"` requires, confirming the slot was correctly
timed to this exact boundary.

**1. Dana's fresh session (new login, not a carried token) now lists Nora — PASS.**
`myChildren`, queried immediately after a brand-new `/api/demo/login` as `dana`:
```json
{"myChildren":[
  {"child":{"id":"p_jax", ...}, "scopes":["careplan.read","contacts.read","goals.read",
    "pickup.request","pickup.verify","schedule.read","school.read","transport.read"]},
  {"child":{"id":"p_nora","person":{"displayName":"Nora Ellison"}}, "scopes":["pickup.request"]}
]}
```
Nora is listed with **exactly** `["pickup.request"]` — no superset, nothing implied. Jax's row is
byte-identical to every earlier baseline in this evidence file; her own authority is untouched.

**2. Schedule, care, address reads for Nora stay refused — PASS, with one scope still untestable
(unchanged from the earlier finding, re-confirmed, not re-litigated):**
- `effectiveScheduleFor(childId: "p_nora", ...)` → explicit `UNAUTHORIZED` (`authorizeChild` gate,
  `src/subgraphs/schedule.ts`).
- `careFacts(childId: "p_nora")` → `{"careFacts":[]}`, RLS-filtered (real refusal, not absent
  data — already proven against Kendra's non-empty 3-row read in the third slot's checks above;
  nothing about that mechanism changed, so not re-run against Kendra a second time here).
- **Address read: still not independently testable**, for a sharper reason than "feature
  unwired" stated in the earlier slot: the only address-gated query, `villageWorld`, is **not yet
  composed into the router's schema at all** (`Cannot query field "villageWorld" on type
  "Query"`) — the recompose step is still pending (per Window N+2's own posted order, step 4,
  not yet reached). Even once composed, `villageWorld`'s own first gate requires
  `schedule.read` for the *whole* query (`src/subgraphs/village.ts:261`,
  `authorizeChild(ctx, childId, SCOPE.schedule)`) before ever reaching the
  address-vs-coordinates distinction inside it — so for someone in Dana's exact position
  (`pickup.request` only), it would never isolate "address" as a distinct signal from "schedule"
  regardless. Not claiming schedule or address access for her beyond what was actually run, and
  not claiming this gap is resolved.

**What this closes, and what it does not:** Requirement 1 from the third slot's corrected table —
"Dana's fresh session sees exactly the granted scopes" — is now **DEMONSTRATED (PASS)**, closing
that line. **Not closed, and not investigated in this read-only slot:** the separate causal
question from the correction above — why the grant's `valid_from` landed on `2026-11-02` when
Kendra requested no start date at all. That remains open; nothing in this check traces
`src/rosina/*`'s defaulting logic, and none was attempted (read-only, per instruction).

No writes were made. No restart, reset, or migration performed. Receipt posted to #78; slot
released explicitly below.

## Append-only follow-up — the causal question above is answered (#118, merged)

The open causal question left above — why the grant's `valid_from` landed on `2026-11-02` when
Kendra requested no start date at all — is answered by PR #118 (merged to `main`), not by
anything run in this evidence file. Root cause, per #118's own commit message: at the time of the
original proposal, Rosina (the model) had **no current date in its prompt at all**, and the
backend's own `validFrom` default fell back to a UTC calendar day — which, at `22:42` Detroit on
Nov 1, was already `2026-11-02` in UTC. The model itself supplied `validFrom: "2026-11-02"` in
the structured tool call despite the parent naming no date, because nothing told it what
"today" actually was in the household's own timezone. Fixed by #118: a `TODAY'S DATE` block
(the real Detroit date, never the demo scenario date) is now always in Rosina's system prompt,
and `resolveVillagerValidFrom` deterministically resolves an unspecified/malformed/past date to
Detroit-today before the proposal is ever staged — a parent-named today-or-future date is still
preserved verbatim.

**Residual limit, explicitly left open by #118, not closed by it:** this fixes the *default*
when no date is named, but Rosina is still a model relaying whatever date it believes the parent
named. A parent-named date is passed through, not independently re-verified against anything —
so a model that misreads or invents a future date a parent never actually said would still be
recorded as if the parent named it, same as any other model-transcription error this system
already relies on human review (the proposal review step) to catch, not a server-side guarantee.
Recorded here because evidence 72 is the record that found this class of defect in the first
place.

### Corrected summary (final)

| Required check | Status |
|---|---|
| Relationship ACTIVE, grant exactly `[pickup.request]`, one grant + one approval | **PASS** (third slot) |
| No parent/guardian authority gained; other authority untouched | **PASS** (third slot; re-confirmed here for Jax) |
| Schedule read refused | **PASS** (third slot; re-confirmed here) |
| Care-fact read refused (RLS) | **PASS** (third slot; re-confirmed here) |
| Address read refused | **Not independently testable** — gating query not yet composed into the router, and structurally cannot isolate "address" from "schedule" for this caller even once it is |
| Loretta / Priya / Ms. Whitfield refused | **PASS** (third slot) |
| Sequential confirm retries idempotent | **PASS** (third slot) |
| Genuinely concurrent *live* confirm retries | **No evidence exists** — only sequential live calls were made; offline `FakeDb` concurrency evidence exists separately (linked above) but does not reach real Postgres locking |
| Dana's fresh session discovers Nora with exactly the granted scopes | **PASS — DEMONSTRATED** (this slot, Window N+2 Slot A) |
| No outreach | **PASS** (third slot) |
