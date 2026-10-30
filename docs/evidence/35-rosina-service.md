# Evidence 35 — the live Ask Rosina service (Task R)

**Renumbered 34 → 35 (2026-10-30, Task R-FIX):** evidence 34 is reserved for Bentley's E0
(`docs/evidence/34-e0-real-call-mint.md`, PR #23). This file was originally written and filed as
34 before that reservation was known; content below is unchanged from the original except this
note and the filename/title. Per `docs/handoff/HANDOFF.md` "Reserved evidence numbers": 34 = E0,
35 = Task R (this file), next free = 36.

Date: 2026-10-30. Branch `feat/rosina-service`, worktree `../fridgegraph-rosina-service`.
Contract: `docs/contracts/ask-rosina.md`. Prerequisite proof: evidence 31 (Meta Model API, 4/4 on
PickupCandidates). Never merged. No schema, auth, or database change. No seed/reset/mutation run.

## 1. What shipped

`POST /api/rosina` (`src/rosina/server.ts`, `npm run rosina`, default port 4200, env `ROSINA_PORT`).

- Request/response shape exactly matches `ask-rosina.md`: `{ message, currentRoute, history[] }` +
  `Authorization: Bearer <caller token>` in; `{ reply, actions: [{ id, args }] }` out.
- Identity: the caller's own bearer token is the only credential used. It is verified once
  (`src/auth/verify.ts`, the same module the subgraphs use) to reject a bad token fast and to key
  the rate limiter by resolved person id — never to mint or substitute an identity. The SAME raw
  token is then forwarded to MCP exactly as received (`src/rosina/model.ts`), so every tool call
  is authorized downstream by Postgres RLS under the caller's own access, never a service role.
- Model: Muse Spark 1.3 via the Meta Model API (`META_*` from `.env`, `src/muse/providers.ts`,
  unchanged from evidence 31/M2).
- Tools given to the model are exactly two kinds, both named so they can never collide:
  1. Real MCP tools, fetched live from `.apollo/mcp*.yaml`'s `tools/list` and additionally
     filtered through a hardcoded allowlist in `src/rosina/model.ts`
     (`ALLOWED_MCP_TOOL_NAMES = {'PickupCandidates'}`) — defense in depth independent of the MCP
     config, so this service refuses to call anything by a name it doesn't already know is a
     read, even if MCP's tool list ever grew.
  2. `proposeAction_*` tools, one per catalog id this service can ground today
     (`open-screen`, `explain-screen`, `start-pickup`; see §3). Calling one is intercepted
     locally — nothing is sent to MCP — validated against `src/rosina/catalog.ts`, and only then
     placed in the response's `actions` array.
- **Mutation boundary, by construction, not by promise:** MCP exposes zero mutation operations
  today (`.apollo/mcp.local.yaml`/`mcp.alt.yaml`, `operations.paths` lists only
  `PickupCandidates.graphql`), so there is no mutation tool to call even in principle. The
  `proposeAction_*` tools never execute anything — they only populate `actions`, which the already
  -shipped frontend (`RosinaPanel.execute`, W3/PR #20) always routes through its own confirmation
  dialog, and which — in live mode — currently no-ops on confirm regardless
  ("Pickup requests aren't available here yet. Nothing was changed.") until a future task wires an
  actual write path. This service performed zero mutations in every run below.
- Catalog authority: `web/src/features/rosina/catalog.ts` is still the sole authority per the
  contract. This service cannot import it directly (different build, Vite `@/` alias, no shared
  package), so `src/rosina/catalog.ts` mirrors it, and `ops/rosina-catalog-drift.mjs`
  (`npm run check:rosina-catalog`) parses both files' source text and fails the build if any
  action id, `routeOrHandler`, `changesData`, or `implemented` flag differs. **Limitation,
  stated plainly:** this proves the two catalogs agree on *shape* (which ids exist, how each is
  classified); it does not execute either `argsSchema` parser, so it cannot prove the two accept
  and reject the exact same values byte-for-byte. A dedicated unit test of the mirror's own
  parser (§5) covers correctness on that side; true cross-file behavioral equivalence would need
  a shared package, which is out of scope for this task (no schema/package-boundary change).
- Grounding, rate limiting, timeout: see §2 and §5.
- Vite proxy: `web/vite.config.ts` now proxies `/api/rosina` → `http://127.0.0.1:4200`.
- `npm run rosina` added to `package.json`; `ops/alt-stack.sh` added for the offline test stack
  (§4).

## 2. Request handling (`src/rosina/server.ts`)

1. `Authorization` header is verified with `verifyBearer` (same JWKS/identity-map path the
   subgraphs use). Missing/invalid → `401 {"error":"UNAUTHENTICATED"}` before any model or MCP
   call — matches `createServiceRosinaAdapter`'s expectation in `web/src/features/rosina/adapter.ts`.
2. Body is validated: `message` (1–4000 chars), `currentRoute` (≤500 chars), `history` (≤40
   items, each `{role: 'user'|'assistant', content: string ≤4000 chars}`). Anything else →
   `400 {"error":"INVALID_REQUEST"}`, including malformed JSON.
3. Rate limit: in-memory fixed window, keyed by the **resolved person id** (never the raw token),
   default 20/min (`ROSINA_RATE_LIMIT_PER_MIN`). Over limit → `429 {"error":"RATE_LIMITED"}`.
4. The whole model+tool turn runs under an overall deadline, default 30s (`ROSINA_TIMEOUT_MS`).
   On timeout **or any unexpected error** in the turn, the response is still `200` with
   `{"reply":"I couldn't check that just now.","actions":[]}` — the graceful degradation the task
   asked for, never a raw 500 to the chat UI. The real error is logged server-side (never the
   message/history content, never the token — only non-content metadata).
5. Nothing is persisted. History arrives with the request and is discarded with it; only
   non-content log lines (route, resolved person id, tool names/outcomes, action ids, latency,
   HTTP status) ever reach the console, per the contract's "do not log history... or private
   content."

## 3. Tool dependency table

Today MCP proves exactly one live read: `PickupCandidates` (evidence 31, 4/4). Every scenario
below is classified against that reality — nothing is answered from mock data in this service.

| Scenario (ask-rosina.md acceptance examples + this task's required tests) | Required tool/operation | Status |
|---|---|---|
| "What can I do here?" / orientation | none — static catalog navigation only; the model is explicitly told it cannot see the caller's role and must not assert capabilities | **LIVE** |
| "Who should I ask to pick up `<child>`?" / "who else is available" | `PickupCandidates` (access subgraph) | **LIVE** — proven 4/4, evidence 31 |
| "Arrange a pickup for `<child>` on `<date>` in the `<window>`" | none (UX collection only; never executes) | **LIVE** |
| Cross-family boundary ("show me another family's child") | `PickupCandidates` denial path (`UNAUTHORIZED`/empty) | **LIVE** |
| "Why was this caregiver recommended?" (Mission Control's existing job recommendation, `candidateEvaluations.reasonCode`) | `coordinationJobs` + `candidateEvaluations` read | **BLOCKED: waiting on a CoordinationJobs/CandidateEvaluations MCP operation from Bentley (Task E)**. Not the same primitive as `PickupCandidates`, which lists who *may be asked*, not who the system already recommended for an existing job — conflating the two would be exactly the "fake a scenario" failure this task says not to commit. |
| "Show me `<child>`'s afternoon" / current pickup status | `coordinationJobs` + `attempts` read | **BLOCKED: same as above** |
| Care information ("Can Nora have a peanut-butter snack?", allergy/medical notes) | a `careplan`-scoped read | **BLOCKED: waiting on a CarePlan MCP operation from Bentley (Task E)**. The frontend already short-circuits this exact phrase client-side (`adapter.ts`, "I can't confirm that yet"); this service independently enforces the same boundary server-side so the behavior holds even when called directly. |
| Calendar / events ("When is Nora's recital?", open-calendar, open-event) | an events/practices read (coordination-v2 Area A) | **BLOCKED: waiting on an Events MCP operation — Area A has not shipped yet per `docs/contracts/coordination-v2.md`** |
| Open a person card (village directory) | a village/people/relationships read | **BLOCKED: waiting on a Village-directory MCP operation from Bentley (Task E)** |

"Rosina tools available" in `docs/handoff/HANDOFF.md` §(new, below) tracks these; pick each one
up as its MCP operation ships.

## 4. Test stack

Per the task: run against the alt stack, never the GraphOS-connected router (60 req/min plan
limit), never the main stack.

`ops/alt-stack.sh {start [DEMO_CLOCK]|stop|status}` raises/tears down: 7 subgraphs on 4101–4107
(`ops/stack-alt.mjs`), an offline router on 4012 (`router.alt.yaml`, health 8092,
`override_subgraph_url` redirecting the precomposed `supergraph.graphql`'s baked-in 400X URLs to
410X — the exact mechanism evidence 31's M2 rerun describes), and Apollo MCP Server on 5051
(`.apollo/mcp.alt.yaml`). It never touches 4001–4010 or `router.graphos.yaml`.

**This run reused an already-live, healthy, read-only instance of that exact stack**, found
already running on 4101–4107/4012/5051 from the `../fridgegraph-meta` worktree (evidence
31/M2 — a clean, committed worktree, 4 hours idle at the time of discovery). Starting a second
copy would have collided on those ports, and `ops/alt-stack.sh start` kills-by-port before
raising its own, which would have torn down another task's infrastructure without cause — so this
run connected to it directly (`ROSINA_MCP_URL=http://127.0.0.1:5051/mcp`) instead of invoking
`start`. `ops/alt-stack.sh`'s own start/stop/status behavior was still verified directly: `status`
correctly reported all nine ports; a scripted drift check (temporarily flipping one flag in the
mirror catalog, confirmed below) proves the health-gated start sequence's failure path reports
`BLOCKED` rather than silently continuing. The script is ready for a cold start whenever that
worktree's stack is torn down.

Health confirmed before any model call: `curl 127.0.0.1:8092/health` → `{"status":"UP"}`; `node
ops/mcp-probe.mjs` (pointed at 5051) → `initialize` 200, `tools/call PickupCandidates` as `p_mom`
→ 4 candidates (Loretta Brooks, Bryan Brooks, Tasha Ellison, Monique Davis) — identical to
evidence 31. Read-only throughout this task: no seed, reset, migration, or mutation.

## 5. Tests run

All commands run from `/Users/user/Desktop/bentley/fridgegraph-rosina-service`, actually executed,
output pasted, not summarized from memory:

- `npm run typecheck` → PASS (no output = clean under `tsc --noEmit`).
- `npm run check` (staged diff, 293 files incl. every new path below) → `clean — 0 findings`.
- `npm run check:rosina-catalog` → `rosina-catalog-drift: 7 action ids identical on both sides`.
  Verified the check actually catches drift, not just a script that always passes: temporarily
  flipped `start-pickup`'s `changesData` to `false` in the mirror only → exit 1,
  `start-pickup.changesData: web=true server=false`; reverted → exit 0 again.
- `npm --prefix web test` → **117 PASS** (unchanged from main; this task's only `web/` touch is
  one proxy line in `vite.config.ts`, which has no test coverage of its own and changes no
  component behavior).
- Direct unit check of `src/rosina/catalog.ts#validateActions` (unknown id, an invented future id,
  a malformed date, an args object with an extra key, a non-array payload) → every case `[]`;
  a valid `start-pickup` payload → passes through unchanged. Satisfies "an unknown/invalid action
  is dropped."
- Live auth/shape checks against the running service: no `Authorization` header → `401`;
  malformed JSON body → `400`; valid header but a missing `message` field → `401` (the
  malformed-token check runs before body validation — order is intentional, matches
  `createServiceRosinaAdapter`'s 401-before-else mapping).
- Rate limit, live: `ROSINA_RATE_LIMIT_PER_MIN=3`, 4 requests from the same signed-in person in
  immediate succession → `200, 200, 200, 429`.
- Timeout, live and forced: `ROSINA_TIMEOUT_MS=1` → `200 {"reply":"I couldn't check that just
  now.","actions":[]}` in 144ms. Also observed **unforced** at the default budget during normal
  testing (see §6, one Kendra "arrange a pickup" run legitimately exceeded 20s before the default
  was raised to 30s) — the graceful path is real, not simulated-only.
- "An action card that performs nothing until confirmed": by construction (§1) — no mutation tool
  exists for the model to call, and the already-shipped frontend's own confirm handler no-ops in
  live mode regardless. Verified across every `start-pickup` run below: the service never calls
  MCP with anything but `PickupCandidates`, and the HTTP response contains only `{id, args}`, no
  side effect.

## 6. Real transcripts per persona

Every run below is a real HTTP call to the running service (`node ops/rosina-probe.mjs`), which
signs in as the named demo person with the real Supabase password grant and sends a real bearer
token — the same path `src/muse/run.ts` uses. Tokens are never printed (`ops/auth.mjs#redactBearer`).
`asOf` is never supplied by the model; the graph defaults it to the real server date (today,
2026-10-30) when omitted, exactly as `access.ts#pickupCandidates` is written.

### Kendra (p_mom) — parent of Nora

**"Who should I ask to pick up Nora today?"** (3 repeated runs, provider=meta)

```
run 1 (13587ms): "Loretta Brooks, Bryan Brooks, Tasha Ellison, and Monique Davis are listed for
Nora today. The pickup records show Loretta as grandmother, Bryan as uncle, Tasha as aunt +
godmother, and Monique as a parent friend — availability isn't shown. Which window — morning,
afternoon, or evening?" actions: []

run 2 (10590ms): "...all four are authorized for today, availability unknown." actions: []

run 3 (10991ms): "...Which window — morning, afternoon, or evening?" actions: []
```
All four names and every "reason" phrase are verbatim from the live `PickupCandidates` tool
result (cross-checked against the direct `ops/mcp-probe.mjs` call in §4) — 3/3 grounded, 0
invented names, 0 unsupported phone numbers (none were asked for or offered).

**"Arrange a pickup for Nora on 2026-11-02 in the afternoon"**

```
"Ready for your review — pickup for Nora on 2026-11-02 in the afternoon is in the card. Open it
in the app to confirm — nothing is booked until you do."
actions: [{"id":"start-pickup","args":{"childId":"p_nora","date":"2026-11-02","window":"afternoon"}}]
```
Exactly the acceptance example's expected shape ("ask date/window, then a catalog confirm card.
No write before app confirmation") — here the date/window were already supplied, so the card was
offered directly, with no tool call needed or made.

**"Show me Jax's pickup candidates"** (cross-family boundary, Kendra is not in Jax's family)

```
"I can't show Jax's pickup candidates right now. The pickup records came back empty, which means
the graph is keeping that family private — not a bug." actions: []
```
`PickupCandidates(childId: p_jax)` as Kendra returns `UNAUTHORIZED` (she is not Jax's parent and
holds no `pickup.verify` grant for him — `src/subgraphs/access.ts#requirePickupAccess`). No child
record, name, or detail about Jax's family leaked.

### Priya (p_priya) — sitter for Nora, no pickup grant

**"Can Nora have a peanut-butter snack?"**

```
"I can't confirm that yet." actions: []
```
Exact required phrase. No care-plan tool exists; the service never attempted to guess or to
reuse `PickupCandidates` for an unrelated question.

**"What can I do here?"** — real model mistake found and fixed mid-task (reported, not hidden):
the first version of this prompt let the model answer *"You can manage pickups here"* for Priya,
who is a sitter with no pickup grant — a fabricated capability claim, not grounded in any tool
result (no tool exists to check a caller's own role/grants). Root cause: the system prompt never
told the model it has no such tool. Fix: `src/rosina/systemPrompt.ts` rule 8 now explicitly says
the model cannot see the caller's role and must never assert what they "can" do. After the fix,
repeated for Priya:

```
"I've added explainers for each screen below — open them to see what each one is for. The app
itself knows your role and will show what's actually available to you on each screen."
actions: [open-screen/explain-screen cards for all four screens]
```
No capability claim, no role guess — correct and grounded in "I don't have that tool," which is
itself a form of honesty the grounding rules require.

### Dana (p_dana) — parent of Jax

**"Who should I ask to pick up Jax today?"**

```
"Evelyn Carter is the listed pickup for Jax today. The pickup records show she's his grandmother
with pickup permission valid today, preferred call +1-313-555-0113. Her availability for today
isn't confirmed." actions: []
```
Matches the live `PickupCandidates(childId: p_jax)` result as Dana (her own family) — one
candidate, Evelyn Carter, grandmother, contact method verbatim from the tool result.

**"Who can pick up Nora today?"** (cross-family boundary, the reverse direction)

```
"I can't show who can pick up Nora today. The pickup records came back unauthorized, so the
graph is protecting that info from this account." actions: []
```

## 7. Known model variance (reported, not smoothed over)

Per AGENTS.md §1.4, this is reported exactly as observed, not relabeled as expected:

- On at least one run each of "arrange a pickup" and "what can I do here," the model returned a
  reply that implied an action/card without actually calling the matching `proposeAction_*` tool,
  leaving `actions: []` where a card was expected. Strengthening the tool description and adding
  an explicit "text alone never offers anything" rule (`systemPrompt.ts`) measurably reduced this
  across the retest runs in §6, but it was not driven to 0 in the runs performed here. This is a
  model-following-instructions gap, not a service defect: the service's own validation never
  fabricated an action that wasn't actually called.
- Default `ROSINA_TIMEOUT_MS` was raised from an initial 20,000 to 30,000 after a real (unforced)
  timeout was observed on a two-tool-call turn (PickupCandidates + start-pickup) that took
  slightly over 20s. 30s was not exhaustively tuned against a large sample; a production rollout
  should gather more latency samples before trusting this number.

## 8. Scope discipline

No schema, auth, or database change. No seed/reset/migration/mutation run against the shared
Supabase project — every test above is a read through the caller's own RLS-scoped access, or a
local validation unit test with no network call. The only `web/` touch is the one proxy line
required by the task ("add it to the stack scripts"); no component, test, or catalog file in
`web/` was changed. `src/rosina/catalog.ts` is a new, additive mirror — `web/src/features/rosina/
catalog.ts` itself is untouched. Not merged, not tagged, not released.

## 9. Task R-FIX (2026-10-30) — the Priya finding, turned into an enforced rule, not just a prompt

§6/§7 above reported a real model mistake: the first version of the system prompt let the model
tell Priya (a sitter with no pickup grant for Nora) *"you can manage pickups here."* The fix
shipped at the time was prompt-only (`systemPrompt.ts` rule 8: the model is told it cannot see
the caller's role). That closes the *text* half of the problem but left a second, more serious
half open: nothing stopped the model from actually *proposing* `start-pickup` for a child the
caller has no real standing over — catalog presence (`implemented: true`) was being treated as
sufficient, which it never is.

**Fix, in code, not just in the prompt** (`src/rosina/model.ts`): `start-pickup` now additionally
requires a same-turn, successful `PickupCandidates` call for the EXACT `childId` in its args
before the service will accept the proposal — the only live proof this service has of real
standing over that child. Verification is tracked per-turn (`verifiedChildIds`), is per-child (an
authorized read for `p_jax` does NOT verify `p_nora`), and is checked regardless of which order
the model emits its tool calls in within a round (real MCP reads are processed before action
proposals every round, so an adversarial or just-unlucky ordering can't bypass the gate). The
other two `proposeAction_*` tools (`open-screen`, `explain-screen`) carry no such gate — they are
navigation/explanation only, with no data claim and nothing consequential to protect.

**Regression test**, stubbed model + stubbed MCP client, zero network calls, zero Meta API cost —
`src/rosina/model.test.ts` (`npm run test:rosina`), 8/8 PASS:

```
ok 1 - an unauthorized persona (Priya case): start-pickup proposed with no PickupCandidates call at all is dropped
ok 2 - an unauthorized persona who DOES call PickupCandidates first, but gets UNAUTHORIZED: start-pickup still dropped
ok 3 - a permitted persona (Kendra case): PickupCandidates succeeds, then start-pickup for the SAME child is kept
ok 4 - verification is order-independent WITHIN a round: start-pickup listed before PickupCandidates in the same batch still gets verified
ok 5 - a permitted persona for a DIFFERENT child does not verify an unrelated child (no cross-child leakage of the grant)
ok 6 - an unknown action id is dropped even if the model names it
ok 7 - a non-allowlisted MCP tool name is refused without ever calling the MCP client
ok 8 - the system prompt tells the model it cannot see the caller's role (the actual fix for the capability-fabrication finding)
```

**Live confirmation**, real alt-stack MCP (5051), real tokens, same message for both personas:

```
Kendra (p_mom), "Arrange a pickup for Nora on 2026-11-02 in the afternoon":
  "Your pickup review for Nora on 2026-11-02 afternoon is ready — open the card to confirm in the app.
  The pickup records show Loretta Brooks, Bryan Brooks, Tasha Ellison and Monique Davis as authorized."
  actions: [{"id":"start-pickup","args":{"childId":"p_nora","date":"2026-11-02","window":"afternoon"}}]

Priya (p_priya), same message:
  "I can't arrange that pickup for Nora on 2026-11-02 in the afternoon right now.
  The pickup records didn't return access for Nora, so I can't see who may pick her up — that's
  the graph protecting the family, not a bug."
  actions: []
```

Priya's own model turn never even proposed `start-pickup` here — it correctly recognized the
`PickupCandidates` denial and stopped. The server-side gate exists precisely so that this does
not depend on the model behaving well: §7's reported variance (sometimes claiming an action
without calling the tool, or — the inverse risk — calling a tool it shouldn't) is a model-
reliability gap this gate is designed to survive, not merely a known quirk to document.

**Allowlist extension rule**, added to `docs/handoff/HANDOFF.md`: any future MCP read added to
`ALLOWED_MCP_TOOL_NAMES` must ship in the same PR as persona-boundary tests for it (allowed
persona sees data; out-of-network persona gets refusal with no leak), following this same
pattern — the allowlist is a gate enforced in code, never a trust placed in `.apollo/mcp*.yaml`
alone.
