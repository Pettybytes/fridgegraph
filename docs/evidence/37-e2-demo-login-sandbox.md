# Evidence 37 — Task E2: demo login, sandbox enforcement, guide scope

Branch `feat/e-group2`. Migration `0025_demo_sandbox.sql`. No token, link, OTP, password or user id
appears in this file.

---

## E2a — demo login endpoint

Full contract: [`docs/handoff/E2A-REPORT.md`](../handoff/E2A-REPORT.md).

**Endpoint** `POST http://127.0.0.1:4008/api/demo/login`, body `{ personaId }`. Loopback bind only,
`DEMO_LOGIN_ENABLED=1` required, refuses `NODE_ENV=production`, localhost origins only, no-store.

**Session source: Supabase Auth, primary path, no password.**
`admin.generateLink({ type: 'magiclink' })` → `verifyOtp({ token_hash, type: 'magiclink' })`, both
clients created per request (`persistSession:false`, `autoRefreshToken:false`). The password fallback
was not implemented because the primary path works on this project — so no server reads
`.demo-credentials` and that rule is unchanged.

Observed on the first probe (`ops/e2-mint-probe.mjs`):

| Step | Outcome |
|---|---|
| `generateLink(magiclink)` | ok, hashed token present, `verification_type=magiclink` |
| `verifyOtp(token_hash, magiclink)` on a fresh client | session issued, refresh token present |
| subject → identity map | `p_mom` |
| `app_metadata` keys on the user | `demo`, `provider`, `providers` |
| existing JWKS verifier accepts the minted token | yes |
| `app_metadata.demo` in the verified claim | true |
| `app_metadata.demo_guide` in the verified claim | false |

**Marking.** `app_metadata.demo = true` on all 14 seeded identities, `app_metadata.demo_guide = true`
on `p_demo_guide` only, set idempotently by `scripts/seed-auth-users.ts` (re-run wrote 0 changes the
second time). `src/auth/verify.ts` exposes them from the verified payload only, both defaulting to
false; `src/context.ts` carries them on `Ctx`.

**Persona allow-list** (`src/demo/personas.ts`, server code). READY is derived from the identity map:

- READY (7): `demo-guide`, `kendra`, `andre`, `loretta`, `priya`, `dana`, `jax-family`
- UNAVAILABLE (4, no seeded identity): `rosa`, `felicia`, `simone`, `dwayne`
- Unknown ids → `UNAVAILABLE / UNKNOWN_PERSONA`, never another identity

**Proofs** `npx tsx ops/e2a-proof.mjs` — **46/46 PASS**:

| # | Check | Result |
|---|---|---|
| a | endpoint sign-in; real Supabase session; **the existing verifier** resolves `p_mom`; persona/scope shape matches the web AuthAdapter | PASS |
| b | demo marker in the verified token; guide = demo + demo_guide; Kendra is not guide; response marks agree | PASS |
| c | Kendra+Andre then Andre+Priya in parallel: own personId each, different tokens, no cross-identity, earlier session unaffected | PASS |
| d | `nobody`, `not-a-persona`, `p_mom`-as-personaId, and the four unseeded personas → UNAVAILABLE, no session, no substitute | PASS |
| e | live GraphQL through the router: Kendra/Andre (parents) and Priya (`schedule.read`) read Nora's event; Dana (unrelated adult) → `UNAUTHORIZED`; guide reads the same sandbox record; guide mutation → `DEMO_GUIDE_READ_ONLY`; no token → `UNAUTHENTICATED` | PASS |
| f | per-persona limit: 8×200 then 429 | PASS |

**Exposure.** No tunnel, host, proxy or forwarding rule. The listener is `127.0.0.1:4008` inside this
machine and the process refuses to start in production mode.

---

## E2b — sandbox enforcement (database + server)

Two different facts, kept apart:

- `is_demo_caller()` — the verified token's `app_metadata.demo`. A property of the SESSION; real
  outreach must never start from it.
- `sandbox` — the record is fictional demo data. A property of the RECORD, and what the guide may
  read. Deliberately **not** a refusal condition: the consented real-call exception runs on a sandbox
  job (that is exactly what Session 3 did).

### Where the refusal lives

| Layer | Object | Refuses |
|---|---|---|
| function | `is_demo_caller()`, `is_demo_guide()` | read `auth.jwt() -> app_metadata` only, boolean only |
| trigger | `coordination_jobs_mark_demo_caller` | stamps `demo_caller` once, at insert, from the verified session |
| trigger | `attempts_inherit_markers` | inherits `sandbox` + `demo_caller`; refuses a `REAL_CONSENTED` insert on a demo attempt |
| trigger | `attempts_refuse_demo_promotion` | refuses relabel/authorize/consume transitions on a demo attempt |
| trigger | `real_call_authorizations_refuse_demo` | refuses the **mint** (direct insert) for a demo attempt |
| function | `promote_attempt_to_real_consented` | refuses a demo caller or a demo attempt |
| function | `consume_real_call_authorization` | refuses a demo caller or a demo attempt |
| function | `assert_outreach_allowed(attempt)` | dispatcher pre-flight; refuses a demo attempt |
| TS | `ops/dispatcher.mjs` `assertOutreachAllowed()` | refuses before consuming anything |
| TS | `refuseDemoGuideWrite()` in every mutation | guide is read-only |

Simulated work stays allowed on purpose: a demo session can create a sandbox job, receive
`TEST_RESPONDER` attempts and approve as a parent. Refusing that would delete the demo, not secure it.

### Dry run — `node ops/0025-dry-run.mjs` → **28/28 PASS** (migration applied inside one transaction, rolled back)

Scope note recorded in the script: that connection is the migration role and **bypasses RLS**, so it
can prove triggers and functions and can prove nothing about policies. Policy behaviour is proven
over PostgREST in §E2c instead.

Observed: marker only from `app_metadata` (a6); `user_metadata.demo` and `.demo_guide` cannot forge
it (a4/a5); `"false"` is not true (a6); demo job stamped `demo_caller=true, sandbox=true` (b1/b2), a
non-demo session is not (b3); attempts inherit both (b4/b5); `REAL_CONSENTED` insert refused (b6);
authorization mint refused for a demo attempt and allowed for a non-demo one (d1/d2); promote,
consume and a relabelled attempt all refused (e1–e3); `assert_outreach_allowed` refuses a demo
attempt and reports `ATTEMPT_NOT_FOUND` for an unknown one (f1/f2); counts unchanged after rollback.

### Applied proof — `node ops/e2b-proof.mjs` → **15 PASS, 1 SKIP**

All calls bypass the UI: a demo session is minted, a job is created through GraphQL, then the
outreach paths are called directly.

| # | Direct call | Result |
|---|---|---|
| 1–3 | GraphQL `requestPickup` as Kendra; row read back | job created, `demo_caller=true`, `sandbox=true` |
| 4–5 | job's attempts | 4 attempts, all `TEST_RESPONDER`, all `demo_caller=true` |
| 6 | PostgREST RPC `promote_attempt_to_real_consented` (service key) | **400 DEMO_OUTREACH_REFUSED** |
| 7 | PostgREST RPC `consume_real_call_authorization` | **400 DEMO_OUTREACH_REFUSED** |
| 8 | PostgREST RPC `assert_outreach_allowed` | **400 DEMO_OUTREACH_REFUSED** |
| 9 | direct insert into `real_call_authorizations` (mint) | **400 DEMO_OUTREACH_REFUSED** |
| 10–11 | read back | no authorization row; attempt still `TEST_RESPONDER`, unauthorized, unconsumed |
| 12 | direct `PATCH attempts` relabelling to `REAL_CONSENTED` | **400 DEMO_OUTREACH_REFUSED** |
| 13 | dispatcher's own TS guard | `DEMO_OUTREACH_REFUSED` |
| 14 | MCP `tools/list` | **SKIPPED — no server on 5050.** Not claimed. |
| 15–16 | cleanup | job deleted, 0 jobs remain |

**MCP stays unverified**, exactly as the earlier rate-limit blocker left it. It is recorded as
not-proven rather than inferred from the GraphQL result.

---

## E2c — Demo guide scope

Identity: `p_demo_guide`, `app_metadata.demo_guide = true`, **no household membership anywhere**. A
`people` row exists only because `identity_map.person_id` is a foreign key; it is a label, not a
family member.

### Mechanism

25 permissive `demo_guide_*` SELECT policies, each beginning `is_demo_guide() and <sandbox test>`,
plus **96 restrictive no-write policies** (insert/update/delete × 32 tables) that AND with every
permissive policy, so a table that later gains a write policy still refuses the guide. Two
`SECURITY DEFINER` existence helpers (`is_sandbox_child`, `is_sandbox_person`) return a boolean and
never rows — justified against the real policies, not a service-role read for a caller. Resolver
side, `authorizeChild()` returns a third level `'guide'` for a sandbox child, and every mutation
calls `refuseDemoGuideWrite()` first.

### Proof — `node ops/e2c-proof.mjs` → PASS (real tokens, PostgREST, no UI)

**Discriminator** (a table whose base policy is parent/scope-only, so the guide policy is what
answers):

| Table / child | Guide | Unrelated adult |
|---|---|---|
| `care_plans` / p_jax | 1 row | Kendra 0 |
| `parenting_schedules` / p_jax | 2 rows | Kendra 0 |
| `grants` / p_jax | 2 rows | Kendra 0 |
| `events` / p_nora | 1 row | Dana 0 |

**Breadth** (guide SELECT, all HTTP 200): households 4, household_members 10, children 2, events 1,
grants 15, household_policies 3, care_plans 2, goals 2, parenting_schedules 4, relationships 25,
contact_methods 8, locations 1, bus_rosters 1, vehicles 4, practices 1, village_event 0,
permission_slips 0, school_reports 0, coordination_jobs 0, attempts 0.

**Writes, direct:** `INSERT approvals` → 403; `PATCH goals` → 0 rows; `DELETE events` → 1 → 1 (nothing
removed); `INSERT goals` → 403; RPC `request_pickup` → 400 `UNAUTHORIZED`. Reads still work after
every refused write.

**Honest gaps.**

1. The seed holds **4 households and 2 children**, not the six v2 networks. Guide breadth across six
   networks is a **W4 seed dependency**, not something this task can demonstrate. The policies are
   network-agnostic (`sandbox` is the predicate), so no code change is needed once the v2 seed lands.
2. `children_read`, `people_read`, `households_read`, `villages_read`, `groups_read`,
   `capabilities_read`, `memberships_read` are `current_person() IS NOT NULL` — a pre-existing
   Milestone-1 directory posture. Any signed-in user reads those, so for those tables the guide adds
   nothing and nothing is claimed. The guide-specific policies matter exactly where the base policy
   is parent/scope-gated, which is what the discriminator above tests.

---

## E2d — the MCP boundary (alt stack on 5051, server NOT restarted)

Surface: MCP `PickupCandidates`, already listening on `127.0.0.1:5051` → endpoint
`127.0.0.1:4012` (alt-stack router). Nothing was started, restarted or reconfigured for this proof;
only the subgraph processes were reloaded with the code change described in §E2e.

`ops/mcp-e2-proof.mjs` — every call carries the caller's own minted session; the tool payload is not
just ids (it returns `displayName`, contact method values and vehicle plates).

| # | Caller | Observed |
|---|---|---|
| 0 | handshake | `initialize` 200; `tools/list` = **PickupCandidates** only |
| 1 | Kendra (parent) | **4 candidates**, each with id + reason; payload includes names, contact methods and vehicles |
| 2 | Dana (unrelated adult) | **`UNAUTHORIZED`**, `isError`, no data field; leak probe: **0 of 12** sensitive strings present |
| 3 | Demo guide | **4 of 4**, same recorded people — permitted sandbox read |
| 4 | no token | `UNAUTHENTICATED`, no data, 0 strings leaked |
| 4 | garbage token | `UNAUTHENTICATED`, no data, 0 strings leaked |
| 5 | mutations | **none exposed** on this surface |

**Mutations — "not exposed" is not "refusal exercised".** No mutation operation file exists, so
`tools/list` shows none and no MCP authorization refusal for a mutation can be exercised. Calling
`ApproveRelationship` or `grantAccess` returns `-32602 Tool not found` — that is the tool registry's
**exposure** gate, not authorization. The unexposed paths are: `approveRelationship`, `requestPickup`,
`acceptPickup`, `approvePickup`, `grantAccess`, `revokeGrant`. Their **authorization** refusals are
proven over GraphQL instead (`DEMO_GUIDE_READ_ONLY` in e2a-e6 / e3-5, `DEMO_OUTREACH_REFUSED` in
e2b 6–13). Nothing in §E2d claims more than that.

**Harness caveat, recorded because it produced false passes.** The first two runs reported Dana
"refused" while every call was in fact **anonymous**: the Authorization header had been written into
the script as a literal masked placeholder instead of a bearer value, so the scheme word and the token
never reached the server. Anonymous calls fail `UNAUTHENTICATED`, which superficially looks like a
refusal. Fixed by building the header from parts and by asserting, on every authorised call, that the
result is **not** `UNAUTHENTICATED` (and on the denied call, that it is `UNAUTHORIZED`, i.e. a known
caller refused). Those assertions are what make the table above meaningful.

---

## E2e — the guide seam this exposed (migration 0026)

With the resolver allowed to serve the guide, `PickupCandidates` came back **empty** rather than
refused. Cause: the read is derived through two `SECURITY DEFINER` helpers that authorise the caller
themselves — `pickup_candidates_for` (0008) and `grant_holders_for` (0010) accept a parent or a
`pickup.verify` holder only. The guide was neither, so the definer returned zero rows. An empty
candidate list is not a harmless zero: it states "nobody can collect this child".

`0026_demo_guide_derived_reads.sql` adds one clause to each helper:
`or (is_demo_guide() and is_sandbox_child(child))`. Justification, in the file and here: the guide may
already read these same rows directly through 0025's policies, the projection stays narrow
(`(from_id,type)` and actor ids only), every non-guide caller keeps the previous gate, and a guide on
a **non-sandbox** child still gets nothing. No table policy is relaxed and no service-role read is
performed on a caller's behalf.

Resolver-side companion change (same seam): `access.ts` `requirePickupAccess`,
`requireSupervisionAccess`, `requireDerivedAccess` and `transport.ts` `mayReadVehicles` now accept the
guide for a sandbox child. Village topology reads (`households`, `householdMembers`, `relationships`)
remain **parent-only** — deliberately not opened, so the guide's GraphQL surface is exactly what is
listed under "Rosina tools available" and nothing wider.

Dry run `node ops/0026-dry-run.mjs` — **9/9 PASS** in a rolled-back transaction: parent rows unchanged
(18 → 18); guide == parent (18/18); unrelated adult 0; guide on a non-sandbox child 0; grant holders
equal for guide and parent, empty for the unrelated adult; `authenticated` keeps EXECUTE on both;
rollback leaves the deployed function without the clause.

Applied (`ops/0026-apply.mjs`): both helpers carry the guide clause, `authenticated` EXECUTE retained.
Re-run of the MCP proof then gave the guide **4 of 4** candidates.

---

## Rate limits (adjusted during verification)

Per IP: **60/minute** (was 20). Eleven personas exist and a demo session may switch between them; the
per-IP window was never the thing being protected. Per persona: **8/minute**, unchanged — that is what
bounds minting for one identity.

`ops/e2a-proof.mjs` f1–f3 no longer assume a fresh window: they drain the persona window until a 429
arrives, then assert every earlier response was 200 and that the refusal is 429 with `Retry-After` and
no session. All proofs now wait out a 429 instead of failing, so a re-run is not broken by the windows
a previous run consumed.

**Known limit observed during verification:** Supabase Auth rate-limits magic-link generation per user.
A full battery (≈16 mints across five proofs in a few minutes) can exhaust it, and the endpoint then
returns `UNAVAILABLE` with a `MINT_*` reason — fail-closed, correct behaviour, but it means a full
battery should be run once per window rather than repeatedly.
