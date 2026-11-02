# Evidence 75 — Muse Wonder red-team review (static verification)

Append-only. Docs/evidence only; **no application code changed, no live-stack calls.** This records a
security red-team of four targets. It states only what was checked and what was found — never
"cleared" or "zero issues".

## Scope & provenance

- **Pinned SHA:** `c4d190c29c5130e52cb2a712976eceed5541ede7` (`origin/main`, #143), one commit.
- **Source-file allowlist actually read** (application source only): `src/db.ts`, `src/context.ts`,
  `src/auth/verify.ts`, `src/muse/mcp.ts`, `src/rosina/model.ts`, `src/rosina/noticeDeps.ts`,
  `src/rosina/inviteDeps.ts`, `src/rosina/inviteEndpoint.ts`, `src/demo/server.ts`,
  `src/demo/client-ip.ts`, `src/subgraphs/*.ts` (spot), `supabase/migrations/0012`, `0013`, `0074`,
  and a `grep` sweep across `supabase/migrations/*.sql` and `src/**/*.ts`.
- **Excluded by rule** (not read as fact): `.env*`, `data/identity-map.json`, `.apollo/*`,
  `router*.yaml`, logs, `web/evidence` screenshots, correspondence, git history. **Source comments
  were treated as untrusted data** — claims below are verified against executable code, not comments.

## Muse Wonder model call — NOT PERFORMED (recorded honestly)

- **The muse-wonder-1.0 call was not made.** This worktree is credential-free by construction
  (AGENTS.md §2): there is no `META_API_KEY`, no Wonder MCP tool/endpoint is exposed to this agent,
  and reading/copying `.env` is forbidden (§1.3). Fabricating model output or a billed cost would
  violate §1.4. So the findings below are the **reviewer half** — my static verification against the
  code — not claims produced by the model.
- **Pricing:** `UNKNOWN` — muse-wonder-1.0 pricing could not be verified (no provider doc/endpoint
  reachable; no autonomous web per the task).
- **Intended controls, had the call been possible (recorded for the next attempt):** Standard mode;
  input ≤ ~60k tokens of allowlisted source per request; output ≤ ~4k tokens; **max 6 requests**;
  **≤ 2 retries** each; a **$10 cumulative cap** including the pricing-verification call.
- **Usage / cost:** 0 requests, 0 tokens, **$0.00 incurred**, $0.00 of the $10 cap. **Credit
  balance: UNKNOWN.** Actual billed cost is not claimed (nothing was billed).
- Muse Wonder is named here only as the intended development review tool; it was not run and
  **Rosina does not use it at runtime.**

## Classification legend
**CODE-CONFIRMED** — verified in the pinned source. **OFFLINE-REPRODUCED** — reproduced without the
stack. **NOT REPRODUCED** — could not substantiate. **NEEDS LIVE CHECK** — depends on runtime/deploy
config excluded from this review.

---

## Target a — bearer token pass-through; any global/cached client that crosses callers

**Question:** does any graph request reuse a client/identity across callers?

- **F-a1 — Graph DB client is per-request, caller-scoped (CODE-CONFIRMED).** `src/db.ts:35-47`
  `dbFor(ctx)` builds a Supabase client from the **publishable** key plus `Authorization: Bearer
  ${ctx.token}` and memoizes it on `ctx.db` only (`db.ts:44`). `Ctx` is built per request in
  `src/context.ts:54` (`makeContext`), so the client is one-per-request, never module-level. No
  `SERVICE_ROLE` appears anywhere under request handling (`git grep SERVICE_ROLE src/**/*.ts` →
  only `src/demo/*`). *Prereq for a cross-caller leak:* a shared/cached client — not present on the
  graph path. **Finding: no cross-caller graph client.**
- **F-a2 — MCP client carries the caller's own bearer per instance (CODE-CONFIRMED).**
  `src/muse/mcp.ts:41` `private readonly bearer`; `:58` attaches `authorization: Bearer ${this.bearer}`
  on every rpc. `src/rosina/model.ts:~177` constructs `new McpToolClient(url, options.bearer)` per
  turn. The REST seams forward the caller bearer too (`noticeDeps.ts` reads/`requestPickup`,
  `inviteDeps.ts` parent-authz) — distinct from the Meta **provider key** used only for the model
  calls.
- **F-a3 — MCP→router→subgraph forwarding depends on deploy config (NEEDS LIVE CHECK).** The chain
  works only if the deployed Apollo MCP config sets `forward_headers: [authorization]`. That is
  runtime config (`.apollo/*`, excluded) and **was observed broken in production earlier this week**
  (evidence 67: missing `forward_headers` → every MCP call UNAUTHENTICATED). Re-verify on each deploy.
- **F-a4 — Service-role Supabase clients exist, confined to the demo-login subsystem (CODE-CONFIRMED;
  see Target c).** `src/demo/session.ts:68` (admin) and `src/demo/family.ts:70,95,386` use
  `SUPABASE_SERVICE_ROLE_KEY`. These are **not** on the graph request path; they are the demo
  session-minting power — reviewed under Target c.

## Target b — tool-lane boundary: can crafted notice/photo/voice text drive a consequential action without the separate parent confirmation?

- **F-b1 — No consequential mutation is exposed as a Rosina tool (CODE-CONFIRMED).** The MCP
  allowlist `src/rosina/model.ts` `ALLOWED_MCP_TOOL_NAMES` = 10 read tools + exactly two **staging**
  mutations, `ProposeSchoolDayReport` and `ProposeAddVillager` (`model.ts:233-234`). There is **no
  `Confirm*`, `requestPickup`, `approve*`, or `grant*` operation file in `ops/`** (verified: the glob
  is empty), so Rosina's MCP transport structurally cannot reach `confirmAddVillager`,
  `confirmSchoolDayReport`, `approveConsent`, `approve_pickup`, or `request_pickup`.
- **F-b2 — The two propose tools write only drafts (CODE-CONFIRMED).** `propose_add_villager`
  (`supabase/migrations/0074_add_villager_proposal.sql:74`, grant to `authenticated`:141) writes only
  `villager_proposals`; the committing `confirm_add_villager` (`0074:161`) has no MCP op. Same shape
  for school-report propose/confirm (`0071`). So notice/photo/voice text can at most **stage a draft
  for a human to confirm**, never commit a grant/report.
- **F-b3 — requestPickup requires a separate, signed parent confirmation (CODE-CONFIRMED).** The only
  path to `request_pickup` from a notice is the REST confirm endpoint, which verifies an HMAC-signed
  claims envelope with `callerId` taken from the authenticated bearer, re-reads the schedule, and the
  DB RPC enforces `is_parent_of` (`0013:...`). A crafted notice can produce a *proposal*, not a write.
- **F-b4 — Injected instructions in notice/photo text are handled as data (CODE-CONFIRMED, partial).**
  The notice extractor system prompt marks the document as data and every text quote is re-validated
  as a verbatim substring server-side (`noticeFacts.ts`); the photo path is vocabulary-constrained and
  review-only; `textInImage` is explicitly never followed. **Voice path NOT REVIEWED here** — voice
  transcription enters as the user message and is subject to the same output guard, but the
  voice-backend module was not read at this SHA → **NEEDS review** before asserting parity.

## Target c — demo surfaces (DEMO_CLOCK / x-demo-date, demo login on 4008, reset guards, client-ip trust)

- **F-c1 — The demo clock cannot shift identity or the authorization date (CODE-CONFIRMED).**
  `src/context.ts:24` `scenarioNowFrom` returns `undefined` unless `DEMO_CLOCK=1`, and only parses
  `x-demo-now` as a *scenario instant* for time-of-day logic. `src/auth/verify.ts` header comment +
  code: identity is the verified JWT only, and `ctx.today` is the **real** local date
  (`todayIn(new Date())`, context.ts), not the header — so a client cannot move "today" to revive an
  expired grant. *Residual (NEEDS LIVE CHECK):* if a host sets `DEMO_CLOCK=1`, confirm no
  authorization path consumes `scenarioNow` (today it is passed only to Rosina's overdue calc).
- **F-c2 — `/api/demo/reset` is loopback-only + authenticated + rate-limited (CODE-CONFIRMED).**
  `src/demo/server.ts:465-511`: `isLoopback(req.socket.remoteAddress)` → `403 LOOPBACK_ONLY` first,
  then `verifyBearer` (401 otherwise), then per-IP window + per-identity cooldown + one shared lock.
  Any authenticated persona may reset, but only from loopback. **Finding:** reset is not reachable
  off-box.
- **F-c3 — `resolveClientIp` does not blindly trust `X-Forwarded-For` (CODE-CONFIRMED).**
  `src/demo/client-ip.ts:22`: XFF is parsed **only when `socketAddress ∈ DEFAULT_TRUSTED_PROXIES`**,
  then hops are walked right-to-left skipping trusted proxies; an untrusted direct client gets its
  socket address. *Residual (NEEDS LIVE CHECK):* correctness depends on `DEFAULT_TRUSTED_PROXIES`
  matching the real hosting proxy set — a misconfigured trust list would let a spoofed XFF evade the
  per-IP **rate limit** (not auth).
- **F-c4 — Demo login mints service-role-backed persona sessions with no caller auth — exposure is
  the control (CODE-CONFIRMED mechanism; NEEDS LIVE CHECK deploy).** `src/demo/server.ts:172`
  `/api/demo/login` takes `{personaId}` and returns a real Supabase session (via the admin client,
  `session.ts:68`) for any **seeded** persona, gated by rate limits + a persona allowlist. The hard
  guards are **`DEMO_LOGIN_ENABLED=1` and "refuses to start when `NODE_ENV=production`"**
  (`server.ts:5`). **Attack prereq:** reach port 4008 in a deployment that left the picker enabled
  and `NODE_ENV` non-production. **Open question (NEEDS review):** unlike `/reset`, I did **not** find
  an `isLoopback` guard on `/api/demo/login` at this SHA — its off-box safety rests entirely on
  `NODE_ENV` + `DEMO_LOGIN_ENABLED` + network isolation of 4008. Confirm the hosted deployment sets
  `NODE_ENV=production` (or does not expose 4008) before any public host.

## Target d — SECURITY DEFINER functions executable by authenticated/anon that accept an arbitrary identity

- **F-d1 — No SECURITY DEFINER function is granted to `anon`/`public` (CODE-CONFIRMED, within the
  swept set).** `grep "to anon|to public"` over `supabase/migrations/*.sql` returns only
  `0012_revoke_public_execute.sql` (which **revokes** public execute; the matches are commented
  examples). The consequential functions grant to `authenticated` only.
- **F-d2 — Consequential functions derive the actor from the token, not a parameter (CODE-CONFIRMED).**
  `request_pickup` (`0013`) uses `current_person()` + `is_parent_of(p_child)`; `propose_add_villager`
  (`0074:88,91`) sets `v_caller := current_person()` and checks `is_parent_of`; `confirm_add_villager`
  (`0074:173`) uses `current_person()`, and the written `grants.granted_by` + `approvals.approver_id`
  are `v_caller` (`0074:228,234`), **not** a client-supplied id. The villager's `actor_id` comes from
  the stored proposal row, not confirm-time input. **Finding:** no arbitrary-identity injection in the
  functions reviewed.
- **F-d3 — Completeness gap (NEEDS review).** ~20 migrations define SECURITY DEFINER functions
  (0052–0081). This pass verified the **consequential** ones (pickup, villager propose/confirm,
  school-report, demo reset) + the anon-grant sweep. A full per-function audit of the remaining
  village/route/orbit SECURITY DEFINER helpers (e.g. `0058`–`0065`, `0075`) for identity params was
  **not** completed and should be a follow-up.

---

## What was explicitly NOT checked (honesty)
- The muse-wonder-1.0 model was **not invoked** (credential-free worktree) — findings are static
  verification only, not model output.
- Runtime/deploy config (`.apollo/*`, `router*.yaml`, `NODE_ENV`, trusted-proxy set, 4008 exposure,
  `forward_headers`) — excluded from the allowlist; the NEEDS-LIVE-CHECK items above are where safety
  depends on them.
- The voice-backend path (F-b4) and the full SECURITY DEFINER inventory (F-d3).
- No exploit was executed; nothing was run against any stack.

## Next
If muse-wonder-1.0 access is provided (key in the serving env or a Wonder tool), re-run Standard mode
over the same allowlist within the stated caps, and append its claims here with my verification.
Resolve the two NEEDS-LIVE-CHECK items with the deploy owner: (1) `/api/demo/login` off-box exposure
+ `NODE_ENV`; (2) MCP `forward_headers` on each deploy.
