<!-- Latest W4b publication: PR #32 is READY FOR REVIEW. See final readiness entry below. -->
# FridgeGraph — HANDOFF

**Current W4b:** see “W4b replacement brief — live calendar and persona sessions” below. Base #31
`0d80f003c722e009897b1790c461952cd0de6f66`; directory access follows evidence 37 (Bryan confirmed).
Restored W4b delivered-read acceptance passed. The current-main merge and its verification are
recorded in “W4b — current-main merge” below; earlier outage/failure packets are historical.

_Last updated: Oct 30, 2026. Merged origin/main `cccbbd2` (E0 #23) into this branch; read §9 before trusting any state._

---

## Task O — Orbit Alert (2026-10-30, priority change)

Branch `feat/o-orbit` off `main` **`0d80f00`**. Step 0 of the previous plan (guide-seam audit +
cancelled event) was already done in #31 — evidence 41.

| Sub-task | State |
|---|---|
| 1 Coordination types (0031) | **DONE — applied** |
| 2 Orbit tables + actions (0032) | **DONE — applied, dry run 30/30** |
| 3 Policy seed (`orbit_notify_eligible`) | PENDING (dry run seeds it in-transaction only) |
| 4 GraphQL draft/preview/activate/respond/close + reads | PENDING |
| 5 Authenticated photo endpoint + private bucket | PENDING |
| 6 MCP `OrbitStatus` / `CheckInStatus` | PENDING |
| 7 Check-in fixture + live proofs + evidence/PR | PENDING |

**0033 (applied)** hardening: SHA-256 binding over fields + photo **content hash** + the **resolved**
audience (the frozen-table hash was a real defect — it bound an empty list, so an audience change went
unnoticed); `orbit_photos` with immutable content and owner/child binding; helper functions are
caller-scoped (`_orbit_can_see_alert` replaces `_orbit_is_active`) so direct RPC leaks nothing. Dry runs
`ops/0033-dry-run.mjs` **14/14**, `ops/orbit-concurrency.mjs` **5/5** (two simultaneous activations on
separate connections → one ACTIVE, loser `ORBIT_ALREADY_ACTIVE`).

**0034 (applied)** replaces free-text share fields with **controlled vocabulary** (55 values across
WEAR_COLOR / WEAR_GARMENT / HAIR / CARRY_COLOR / CARRY_ITEM). The notification is generated only from
validated values; unmapped text is **refused** (`ORBIT_VALUE_NOT_IN_VOCAB`) so Rosina asks, and
`distinctive` is retired from the message, payload and hash. `_orbit_has_location()` is now **defence in
depth only, not the privacy guarantee**. `orbit_audience_for(childId)` is caller-scoped: parent/guardian
(or guide on sandbox) gets the list; Dana, a non-parent audience member, the guide on a non-sandbox
child, and a nonexistent child all get **0 rows, identical**. Dry runs `ops/0034-dry-run.mjs` **14/14**,
`ops/0033-dry-run.mjs` (replays the 0034 delta) PASS, `ops/orbit-concurrency.mjs` **5/5**.

**Two separate results:** (a) "no location columns" — **PASS**; (b) "audience-facing payloads tested
for location leakage" (GraphQL, MCP, media endpoint, free-text fields, error responses) — **PENDING,
and it is the acceptance result**. #33 goes ready only when (b), the GraphQL contract, audience
isolation, the media access rules and the pickup regression all pass — never on database hardening
alone.

**Data layer as built:** `orbit_alerts` (draft/ACTIVE/CLOSED, `message_hash`, `draft_version`, share
fields, `photo_id` identity only), `orbit_audience_members` (frozen at activation, `notification_outcome
= SIMULATED`), `orbit_responses` (append-only; current = latest row). Actions are SECURITY DEFINER with
**no write grants** to `authenticated`: `draft_orbit_share`, `preview_orbit_share`,
`activate_orbit_alert`, `respond_to_orbit_alert`, `close_orbit_alert`. **No location column exists**;
`_orbit_has_location()` refuses place-like text at draft and activation, and confirmation cannot
override it.

Two defects the dry run caught and fixed: **42P17** policy recursion between `orbit_alerts` and
`orbit_audience_members` (replaced with SECURITY DEFINER helpers) and **42501** because a policy is
evaluated with the caller's privileges, so those helpers must be granted to `authenticated`.

**Audience regression check (2026-10-30).** The `p_dad` "disappearance" was a test fixture
difference (`0032` dry run seeded `p_dad,p_gma,p_bryan`, `0034` seeded `p_gma,p_bryan`, the concurrency
script seeded `p_dad,p_gma` then deleted it), not a code path — the live DB had **no** policy row at
all. `orbit_audience_for()` has no co-parent exclusion. Fixed under the fixture rule:
`createSimulatedOrbit()` seeds the Ellison policy `h_a → p_dad,p_gma,p_bryan`; cleanup removes exactly
that rule and the baseline is byte-identical. `ops/orbit-audience-proof.mjs` **12/12** — Andre is a
frozen audience member with `SIMULATED` + timestamp on activation, Loretta (non-parent) sees only her
own row, Dana gets the no-oracle empty result.

**GraphQL layer (built, live on the alt stack):** `orbitDraft`, `orbitPreview`, `orbitActivate`,
`orbitRespond`, `orbitClose`; reads `orbitAlert`, `orbitStatus`, `checkInStatus`; 911 guidance on every
parent-facing response. Smoke-tested end to end as Kendra: draft → preview (message + SHA-256 hash +
audience 3) → activate (ACTIVE; Andre/Loretta/Bryan `SIMULATED`) → Andre responds `WITH_ME` → status
shows `check-in not recorded` → close. **0035** adds `expected_checkins`/`check_ins`; **0036** makes the
selector prefer today and fall back to the latest overdue expectation (a missed check-in does not stop
being the signal at midnight); **0037** adds `orbit_photo_access` (PARENT after closure, AUDIENCE while
ACTIVE, otherwise the same empty answer as a missing photo) and `register_orbit_photo`.

**Media endpoints (built):** `GET /api/orbit/photo/:photoId` (per-request authority via
`orbit_photo_access`, `Cache-Control: no-store`, 404 for no-access *and* no-such-photo) and
`POST /api/orbit/photo?childId=` (raw body, re-encode via `sips` to drop EXIF/GPS, SHA-256 of stored
bytes, refuses rather than storing unstripped metadata). One real bug found and fixed: the routes had
been registered **after** the catch-all 404 middleware, so every request 404'd; they now sit above it
and `no-token → 401` with `no-store`, unknown route → 404.

**0038+ / media / MCP done:** GraphQL actions + reads with 911 guidance; `ops/orbit-media-proof.mjs`
16/16 (upload → strip → serve-while-ACTIVE → refuse-after-close → parent-still-served → no-store → no
URL); `ops/orbit-leakage-proof.mjs` **19/19** (the acceptance result, including Priya as an audience
member who independently holds `schedule.read`); MCP `OrbitStatus` + `CheckInStatus` live (8 tools, no
mutations).

**BLOCKING: pickup regression 24 PASS / 4 FAIL** after a clean reset — "authenticated cannot consume an
authorization" (404), "duplicate delivery changes nothing" (`rejected_closed`), "terminal job rejects a
late accept" (`rejected_closed`, test expects `rejected_state`), "state rejection recorded as
REJECTED_STATE" (`undefined`). Orbit does not touch the pickup path, but "unchanged" is unproven: the
`main` comparison worktree could not resolve `pg`. Investigate or fix on their merits before marking
#33 ready.

**Host dependency:** photo stripping uses macOS `sips` (re-encode) plus a JPEG segment walk (APP1–APPn,
COM). The server must run on the Mac for Task H's tunnel hosting; if it moves, swap in a portable image
library.

**STILL PENDING (do not claim green):** the media proof with real personas (served while ACTIVE,
refused after close, non-audience refused, SHA/EXIF assertions), MCP `OrbitStatus` + `CheckInStatus`,
the audience-payload leakage acceptance test, the pickup regression run, and the final evidence file.
#33 stays draft.

**Next:** wire GraphQL + the media endpoint + MCP tools, seed the check-in fixture under the additive
rule, then run the live proofs (audience leakage, isolation, demo refusal, pickup suite unchanged).

---

## Task E-NEXT progress — personas, Rosina tools, Groups 3–5 (2026-10-30)

Fresh branch off `main` **`b3173b9`** (#26 merged). One PR per sub-task; none merged.

| Sub-task | Branch | State |
|---|---|---|
| 1 Persona sessions | `feat/e-next-persona-sessions` | **DONE** — evidence `39-persona-sessions.md`, proofs 26/26 |
| 2 Rosina read tools | `feat/e-next-rosina-tools` | **DONE — evidence `40-rosina-read-tools.md`, proof 23/23 on MCP 5051** |
| 3 Group 3 (events + adult schedules) | `feat/e-next-group3` (PR **#31**) | **DONE — 0027/0028/0029/0030 applied; dry runs 18/18 + 20/20; reads + 3 MCP tools 26/26; fixture contract 6/6; cancelled-event and non-sandbox guide-seam items CLOSED.** Evidence `41-group3-events-holidays-availability.md` |
| 4 Group 4 (care + Cast v2 seed) | | not started |
| 5 Group 5 (reset, demo family, consent) | | not started — **resetDemo restores v1 baseline + SIMULATED coordination fixture (later + Cast v2 seed); `db:reset` alone is insufficient; prove Kendra's Mission Control still lists the sample job and Rosina's `JobTimeline` still returns its entries after a reset** |



### Group 5 requirement (recorded 2026-10-30, re-added — the earlier copy landed on a merged branch)

`resetDemo` restores the **demo-ready** state, not a bare baseline: **v1 baseline + the SIMULATED
coordination fixture** (`npx tsx scripts/db.ts seed:simulated`) and, once it exists, the Cast v2 seed.
`db:reset` alone is **not** sufficient — it removes the fixture by design. After any reset the
evidence must show **Kendra's Mission Control** still lists the sample job and **Rosina's
`JobTimeline`** still returns its entries. Prove both in Group 5's evidence.


### Fixture rule (operator, 2026-10-30 — replaces "no rows in a baseline table")

Additive fixture rows MAY go into existing tables when: baseline rows are untouched, fixture rows are
identifiable (`fixture` marker — migration **0030** — or `fx_` id prefix), the fixture keeps its own
checksum, and cleanup removes exactly those rows and restores the baseline checksum **byte-for-byte**.
Proven by `node ops/fixture-rule-proof.mjs` (6/6) and used to seed the cancelled event that closes
Group 3's `includeCancelled` item.

### Group 4 requirement — approval policy is PER HOUSEHOLD, never an assumed second parent

`BOTH_PARENTS` and the self-approval refusal must follow each household's explicit
`schedule_swap_approval` policy. Record the policy in the seed and prove each case in Group 4 evidence:

| Household | Policy to seed | Proof |
|---|---|---|
| Ellison (two parents) | `BOTH_PARENTS` | a swap still needs the OTHER parent; self-approval refused (already proven in 0028 dry run) |
| Castellano (guardians Rosa & Tomás, no parents) | names the guardians | an arrangement proposed by one guardian is approvable by the **other guardian** |
| Ferris (single father Dwayne) | one approver | Dwayne's arrangement does not wait on a nonexistent second parent; Cassandra, Oscar and Priya are **never** approvers |
| Lee | `ANY_PARENT` where the contract says so | any parent may approve |
| Vance–Reyes | stepdad Marcus is `resident_adult` | Marcus is **never** an approver |

`can_approve_swap()` currently assumes "the other parent/guardian in the household" — it must read the
per-household policy and count guardians as approvers where the household has no parents.

### 3 Group 3 — DONE (data and read layers; evidence 41)

`0028_holiday_arrangements.sql` (applied) is the correction: a **SCHOOL_CLOSURE** (`holidays` +
`day_kind` → `SCHOOL_CLOSURE`) is not a **HolidayArrangement**; closures suppress `SCHOOL_DAY`
routines only (`routines.applies_on`), while only an `APPROVED` arrangement overrides parenting time,
inside its inclusive interval. `effective_schedule_for()` is the single precedence point;
`_is_approver_for` delegates to it (still revoked from `authenticated`) and
`src/derive.ts#approverForChild` calls it by RPC. `schedule_conflicts()` surfaces OVERLAP/GAP and
never resolves them; a table trigger refuses self-approval, default policy `BOTH_PARENTS`.
Dry run `node ops/0028-dry-run.mjs` **20/20 PASS** (rolled back).

`0027_events_holidays_availability.sql` (applied): `events.status` (proposed/confirmed/cancelled),
`routines`, `holidays` with **inclusive** ends, `holiday_covers()`, `day_kind()`, `day_routines()`
(no routine on a holiday — precedence lives in the function), `adult_availability` with a **private**
`reason`, and the `adult_availability_free_busy` view that shares **state only** (base table stays
owner-only because RLS filters rows, not columns). Guide gets read-only access with three restrictive
policies per table. **Grants**: 0004 predates these tables, so 0027 grants `select`/`execute`
explicitly — without that every caller hits `42501` before RLS (the dry run caught it).

`node ops/0027-dry-run.mjs` **18/18 PASS**, one rolled-back transaction, real `request.jwt.claims`
impersonation (guide markers included). `node ops/0027-apply.mjs` verifies the applied shape.

**Read layer DONE.** GraphQL `childEvents`, `adultAvailability` (state only),
`effectiveScheduleFor`, `scheduleConflicts`; MCP `ChildEvents`, `AdultAvailability`,
`EffectiveSchedule` — `node ops/mcp-group3-proof.mjs` **24/24 PASS** on router **4012** and MCP
**5051 → 4012**. The no-oracle contract holds on both surfaces (`UNAUTHORIZED` for a known
out-of-network caller, identical to a nonexistent and a malformed id). Availability is Busy/Free
only; the required "recorded free time, not willingness" wording is in the GraphQL description and
the MCP operation file. SIMULATED calendar fixture (closure, two routines, Busy window, two approved
arrangements) seeds with `seed:simulated` and has its own checksum; **no rows are written into a
baseline table** (an earlier attempt to seed `events` was removed — that is why `events` shows only
the 0027 column change). `0029` grants `service_role` on the four new tables (seeding failed with
42501 otherwise).

**Still PENDING:** a seeded cancelled event (cannot go in `events` without moving the baseline
checksum) so the `includeCancelled` filter is proven by data, and the dedicated 0026 guide-seam
audit for these reads.

**Required wording (recorded, lands with the read):** FREE means *recorded free time*, NOT confirmed
willingness or permission to care for a child — in the GraphQL field description **and** the MCP tool
description. Rosina says "has free time recorded", never "is available to watch" / "can pick up".

### 2 Rosina read tools — DONE

`ops/JobTimeline.graphql` + `ops/Attempts.graphql` added to `.apollo/mcp.local.yaml`; MCP **5051**
exposes `Attempts, JobTimeline, PickupCandidates` and **no mutation tool**. `mutation_mode: explicit`
and `forward_headers: [authorization]` unchanged.

`node ops/mcp-rosina-tools-proof.mjs` **24/24 PASS** — Kendra (parent): 5 timeline entries, 2
attempts with candidates; Dana (out-of-network, known caller): `UNAUTHORIZED`, zero rows, never
`UNAUTHENTICATED`; guide: same sandbox rows, read-only (no write tool exists); no token:
`UNAUTHENTICATED`.

Two defects fixed on the way: (1) **no coordination fixture existed** — `baseline()` mapped no
coordination table and `fixtures.ts` had empty arrays, so one simulated job (`p_nora`,
`awaiting_approval` v3) + two `TEST_RESPONDER` attempts (accepted `p_gma`, declined `p_tasha`) were
added to `createSeed()` and the mapping (seeded 163 rows); (2) **`Attempt.job` was a stub** (`{ id }`
only), so `job { status version }` raised a non-null violation — replaced with a real resolver that
loads the job through the caller's own RLS.

**No existence oracle (contract).** Both tools answer one empty result for a **hidden**, a
**nonexistent** and a **malformed** job id — `{"data":{"jobTimeline":[]}}` / `{"data":{"attempts":[]}}`,
no error code — and the proof asserts byte-equality of those payloads. "The caller is known" is a
separate assertion (Dana is never `UNAUTHENTICATED`). Do not "improve" a hidden id into
`UNAUTHORIZED`: that would tell a stranger the job exists.

**Seed separation.** The coordination fixture is **not** baseline. `src/fixtures-simulated.ts` holds
it (label `SIMULATED`, one job on `p_nora` + two `TEST_RESPONDER` attempts, accepted via `p_gma`,
declined via `p_tasha`), seeded with `npx tsx scripts/db.ts seed:simulated` and checked with
`checksum:simulated`. `src/fixtures.ts` is byte-identical to `main`; `scripts/db.ts` only gains those
two commands. Applying the fixture changes **2 of 29 tables**; `db:reset` restores the baseline
byte-identically. Baseline today: 29 tables / 162 rows (evidence 19's 28/157 is an older snapshot,
not this branch). `db:reset` removes the fixture by design — re-apply it when the demo needs
coordination reads to show a record.

Reproduce with the **alt stack running this checkout** (4101–4107 restarted; router 4012 and MCP 5051
untouched apart from the MCP restart that loaded the new operation files). Rosina's allowlist is
added by Claude Code, not here.

### 1 Persona sessions — DONE

**Response contract (W4b builds against this).** `POST http://127.0.0.1:4008/api/demo/login`
`{ "personaId": "<id>" }` → READY 200 with `status`, `personaId`, `personId`, `persona`, `scope`,
`marks`, and `session: { access_token, token_type, expires_in, expires_at }` — **no `refresh_token`
ever reaches the browser.** `expires_at` is the session's real expiry. Renewal = call the same
endpoint again: inside the last **5 minutes** the server refreshes once (single-flight) and returns
the new token and its real expiry; outside it, the cached token with no mint and no refresh. HTTP 503
`MINT_*` and HTTP 429 `RATE_LIMITED` (`Retry-After`) are both retryable; 60/min per IP, 8/min per
persona. Full detail: `docs/evidence/39-persona-sessions.md`.

- One Supabase session per persona in **server memory**, minted on first pick and reused for every
  visitor; concurrent mint and concurrent refresh each collapse to one operation per persona (Supabase
  rotates refresh tokens, so only the server may refresh).
- No global "current persona" on the server; selection is browser-local, and switching/leaving never
  signs out or revokes the shared session.
- `dropPersonaSessionCache()` exists and is proven; wiring it into `resetDemo` is Group 5.
- `ops/persona-sessions-proof.mjs` 26/26; `ops/e2a-proof.mjs` a3 updated to the new contract;
  typecheck clean, secret scan 0 findings.

---

## Task E progress — v2 backend (2026-10-30)

**Resume rule:** skip every step marked DONE; continue at the first not-DONE step. Work in groups;
each group is its own branch off the main state it records below, and one PR. Never merge.

**Reserved evidence numbers:** `34` = E0 (Bentley). Next free = **Task R** (Claude Code, Rosina
service). Always check `docs/evidence/` before numbering.

| Group | Branch | Base | State |
|---|---|---|---|
| 0 | `feat/level-b-drafts` (PR #9) | `origin/main` **`ad720de`** | **DONE — merged as #9 (`ebb7a2c`)** |
| 1 | `feat/e-group1` (PR #23) | off main **`275461e`** | **DONE — merged as #23 (`cccbbd2`)** |
| 2 | `feat/e-group2` (PR #26) | off `origin/main` **`cccbbd2`** | **DONE — E1, E2a, E2b, E2c, E3. PR #26 ready, not merged** |
| 3 | `feat/e-group3` | | not started |
| 4 | `feat/e-group4` | | not started |
| 5 | `feat/e-group5` | | not started |

### Group 2 (E1) — E1 DONE, branch `feat/e-group2`, base `275461e`

**Setup after #23 merged (`cccbbd2`):** `origin/main` merged into this branch (`1c16991`), HANDOFF
conflict resolved to the current state (#9 → `ebb7a2c`, #23 → `cccbbd2`, base refreshed), evidence
conflicts were run-specific ids. Graph suite **115/32 PASS**, voice-turn **15/15**, typecheck clean,
secret scan 0 findings; pushed at `aed9d99`.

**E2a findings (read before writing code):** `src/auth/verify.ts` returns `{ok, personId, sub}` from
the verified JWT and resolves `sub → personId` via `getIdentityMap()`; it does **not** expose
`app_metadata` yet — that is the first edit for the demo marker. `ops/auth.mjs` signs in with a
password grant and caches tokens; its header note says servers never read `.demo-credentials`, which
is linked from the primary checkout (mode 600). `scripts/seed-auth-users.ts` seeds **13** people;
there is **no** `p_demo_guide` auth user, so the Demo guide identity has to be created before E2c can
prove its scope.

**E1 authority model.** `0024_authority_model.sql` (applied): `household_members.role` widened to
`parent | guardian | resident_adult | child`; `is_parent_of()` and `parent_ids_of()` accept
`role in ('parent','guardian')`; `src/authz.ts` uses `.in('role',['parent','guardian'])` at both
sites. Everything calling those functions inherits it with no further edits. `resident_adult` is
outside the IN-list — residence grants nothing. Dry run `ops/0024-dry-run.mjs` **12/12 PASS** in a
rolled-back transaction (guardian recognised, resident_adult not, invalid role rejected, counts
unchanged). Graph suite 114/32 PASS, voice-turn 15/15, typecheck clean, secret scan 0 findings.
Evidence `36-e1-authority-model.md` (35 stays reserved for Task R). No Rosina tool added — no new read.

**PR #26** (draft, base `main`, head `0d798e2`) carries E1 only. E2/E3 will be added to the same
branch, so #26 stays draft until they are green.

**E2 demo login + sandbox enforcement + demo-guide scope.**

**E2a DONE — demo login.** Contract and full response shape: `docs/handoff/E2A-REPORT.md` (this is
what W4 builds against). `POST http://127.0.0.1:4008/api/demo/login { personaId }`, loopback only,
`DEMO_LOGIN_ENABLED=1`, refuses production mode, localhost origins only. Sessions come from Supabase
Auth via `admin.generateLink(magiclink)` + `verifyOtp(token_hash)` — **no password, and no server
reads `.demo-credentials`** (the fallback was not needed; that rule is unchanged). Clients are per
request with persistence off. `app_metadata.demo` marks every demo identity;
`app_metadata.demo_guide` marks the guide alone; `verify.ts` exposes both from the verified token and
defaults them false. READY personas (derived from the identity map, never hardcoded): demo-guide,
kendra, andre, loretta, priya, dana, jax-family. UNAVAILABLE: rosa, felicia, simone, dwayne, plus any
unknown id — never a substitute identity. Limits 20/min per IP, 8/min per persona.
Proofs `npx tsx ops/e2a-proof.mjs` **46/46 PASS** (a endpoint+existing verifier, b marker, c parallel
isolation, d UNAVAILABLE, e live GraphQL scoping incl. Dana UNAUTHORIZED and guide
DEMO_GUIDE_READ_ONLY, f rate limit). Evidence `37-e2-demo-login-sandbox.md` §E2a.

**New rule, unchanged in substance:** servers never read `.demo-credentials`; the demo login path
needs no password at all. The guide identity `p_demo_guide` belongs to no household.

**E2b DONE — sandbox enforcement.** `0025_demo_sandbox.sql` separates two facts that must never be
conflated: `is_demo_caller()` (verified token marker = a property of the SESSION, refuses real
outreach) and `sandbox` (a property of the RECORD, what the guide may read). Refusal is record-level,
because a service-role caller later has no JWT: `coordination_jobs.demo_caller` is stamped once at
insert, attempts inherit it, and four triggers plus `promote_attempt_to_real_consented`,
`consume_real_call_authorization` and `assert_outreach_allowed` refuse demo attempts. `sandbox` is
deliberately NOT a refusal condition — the consented real-call exception runs on a sandbox job.
Simulated work stays allowed (sandbox job, TEST_RESPONDER attempts, parent approval); refusing it
would delete the demo. Dry run `ops/0025-dry-run.mjs` **28/28** in a rolled-back transaction;
applied proof `ops/e2b-proof.mjs` **15 PASS + 1 SKIP** — direct RPC/insert/PATCH all return
`DEMO_OUTREACH_REFUSED`, the dispatcher TS guard returns the same code. **MCP is still UNVERIFIED:**
nothing listens on 5050, and it is recorded as unproven, not inferred. Evidence 37 §E2b.

**E2c DONE — Demo guide scope.** 25 `demo_guide_*` SELECT policies (`is_demo_guide() and sandbox`)
plus 96 restrictive no-write policies across 32 tables, so a later permissive write policy still
refuses the guide. `authorizeChild()` gains a read-only `'guide'` level; every mutation calls
`refuseDemoGuideWrite()`. `ops/e2c-proof.mjs` PASS with real tokens over PostgREST: the guide reads
`care_plans`/`parenting_schedules`/`grants` for p_jax (1/2/2 rows) where Kendra sees 0, and `events`
for p_nora where Dana sees 0; inserts 403, PATCH/DELETE 0 rows, `request_pickup` 400 UNAUTHORIZED.
**Two honest gaps:** (1) the seed holds 4 households / 2 children, not six networks — six-network
breadth is a **W4 seed dependency**, and the policies are network-agnostic so no code change is
needed; (2) `children/people/households/villages/groups/capabilities/memberships` are readable by any
signed-in user (Milestone-1 directory posture), so for those tables the guide adds nothing and nothing
is claimed. Evidence 37 §E2c.

**E3 DONE — `Attempt.candidate` + `jobTimeline(jobId)`.** Additive schema on the coordination
subgraph: `candidate` (nullable — `attempts.candidate_id` is), `destinationMode`, `closedAt`,
`closedReason`, and a `TimelineEntry` list built only from stored timestamps (`created_at`,
`attempts.at`, `closed_at`, `cost_calculated_at`, `received_at`). No evaluation without a cost
timestamp produces an entry, and an invisible job returns `[]` rather than an error, so the id cannot
be probed. `ops/e3-proof.mjs` **21/21**: parent 4 attempts (`p_bryan, p_gma, p_monique, p_tasha`) and
5 timeline entries ascending; Andre 5; Dana 0 jobs / `[]` / 0 attempts; guide 5 read-only with
`DEMO_GUIDE_READ_ONLY` on approve; missing id `[]`. The supergraph was recomposed locally and the
router restarted — a stale supergraph had made the new fields fail validation. Guardian authority is
inherited from 0024 but **no guardian persona is seeded, so it is not exercised** and not claimed.

## 🤝 SHARED STACK — RESERVE THE WINDOW (standing rule, 2026-10-30)

The alt stack (subgraphs 4101–4107, router 4012, MCP 5051) and the database are SHARED with the other
active agent. Before changing either:

1. Note the reservation here (what, which checkout, ports, expected duration) and check the other
   agent is not mid live run — active exec sessions / subagents / recent task list.
2. If a live run is underway: wait, or use a fully isolated environment (separate ports + separate
   database). Never improvise a checkout switch under someone else's run.
3. Afterward restore: expected checkout, ports, **baseline reference data** (seed) and **additive demo
   fixtures** (simulated coordination job, calendar fixtures, Orbit policy + check-in fixture), then
   verify the affected consumer reads — Kendra's `jobTimeline`, Nora's Thanksgiving
   `effectiveScheduleFor`, `orbitVocabulary`, `checkInStatus` — before declaring restoration complete.

## ⚠️ Stack/database operations — ANNOUNCE BEFORE RUNNING (2026-10-30)

Codex's live tests share the alt stack (subgraphs 4101–4107, router 4012) **and the same database**.
During the #33 pickup diagnosis I killed those subgraphs, pointed them at a different checkout
(`/tmp/fg-main`) and ran `db:reset` + `seed` without announcing it — Codex's runs broke. That was my
error, not theirs.

**Rule from now on:** before ANY `db:reset`, `db:seed`, alt-stack restart or checkout switch, append a
line to this section saying what will run, against which checkout and ports, and roughly for how long.
Then run it, then say it is restored. Never leave the stack pointed at a different checkout.

| when | what | checkout | ports | restored |
|---|---|---|---|---|
| 2026-10-30 ~21:2x | killed subgraphs, ran `db:reset` + `seed`, tests | `/tmp/fg-main` (origin/main) | 4101–4107 / 4012 | yes — back on `feat/o-orbit` |
| 2026-10-30 21:35 | alt-stack restart (NO reset, NO seed) + supergraph recompose + MCP restart, for the vocabulary API | `feat/orbit-vocabulary-api` | 4101–4107 / 4012 / 5051 | **restored** |
| 2026-10-30 21:40 | `db:reset` + `seed` + `seed:simulated` to restore the baseline vocabulary (0034's insert is wiped by reset) | `feat/orbit-vocabulary-api` | 4101–4107 / 4012 / 5051 | **restored, 55 values** |
| 2026-10-30 21:40 | **Group 4 window** — 0039 (CareFact) applied; stack + MCP restarted; `seed:simulated` re-applied. Codex: no live run at reservation. | `feat/group4-care-facts` | 4101–4107 / 4012 / 5051 | **restored** |

## Group 4 — CareFact (2026-10-30)

**0039** adds `care_facts(child_id, key, value, source_kind, source_ref, verified_by, verified_at,
confidence, sandbox, fixture)` with a shape constraint: a CONFIRMED fact must name who verified it and
when; PROVISIONAL carries no such claim. Visibility: parent/guardian, a caregiver whose grant holds
`careplan.read` (date-bounded), or the Demo guide on sandbox rows. RLS on, one SELECT policy.

Seeded (additive fixture, `fixture=true`): snack (peanut-free only), TV (30 min after homework, screens
off by 8pm), bedtime (8:30pm school nights) — each with `source_kind=PARENT_CONVERSATION`,
`source_ref='Kendra, care conversation 2026-10-12'`, verified by `p_mom`.

API: GraphQL `careFacts(childId)` → `{id,key,value,source{kind,ref},verifiedBy{id},verifiedAt,confidence}`;
MCP `CareFacts` (read-only). Both listed under **Rosina tools available**.

`ops/care-facts-proof.mjs` **13/13**: three facts with sources and a named verifier; co-parent 3;
caregiver with `careplan.read` 3; Dana 0; nonexistent child the same `[]`; no phone digits in a source
ref; MCP parity; rows marked `fixture=true`.

**Restoration verified** after the window: Kendra `jobTimeline` 5 entries · Nora
`effectiveScheduleFor(2026-11-26)` → `p_dad` / `ARRANGEMENT` / `ha_nora_thanksgiving` ·
`orbitVocabulary` 55 · `checkInStatus` "check-in not recorded".

**Remaining Group 4 pieces (not started):** Cast v2 seed across six networks with idempotent demo auth
users so rosa/felicia/simone/dwayne become READY; guardian timeline access via Rosa; per-household
approval policies (`BOTH_PARENTS`, guardians-approve-each-other, single approver, `ANY_PARENT`, Marcus
never an approver) with proofs.

### Rosina tools available

No new MCP tool was added, so Rosina's toolset is unchanged and this task adds no tool grant. The two
new app reads are GraphQL operations on the coordination subgraph:

| Operation | Arguments | Response shape | Allowed personas | Boundary proof |
|---|---|---|---|---|
| `jobTimeline` | `jobId: ID!` | `[TimelineEntry!]!` — `at`, `kind` (JOB_CREATED / ATTEMPT_OPENED / ATTEMPT_CLOSED / COST_CALCULATED / CONFIRMATION), `attemptId`, `candidate { id }`, `detail` | parents + guardians of the job's child (RLS `is_parent_of`); Demo guide on sandbox jobs; **nobody else** | e3-proof 2,3,4,5,6 — parent 5 entries, co-parent 5, unrelated adult `[]`, guide 5 read-only, missing id `[]` |
| `Attempt.candidate` | via `attempts(jobId)`; no new argument | `Person` (nullable) + `destinationMode`, `closedAt`, `closedReason` | same as the Attempt row's own visibility | e3-proof 1 — 4 attempts, 4 distinct recorded candidates, all `TEST_RESPONDER` |
| `orbitStatus` | `childId: ID!`, `alertId: ID` | `OrbitStatus` — status, audience/notified counts, response counts, latest responses, guidance | parent/guardian full view; an audience member only their own row; nobody else an empty status (no oracle) | `ops/orbit-leakage-proof.mjs` 19/19 — parent 4, audience member 1, Dana `alertId: null` |
| `checkInStatus` | `childId: ID!` | `CheckInStatus` — `recorded`, `label`, `dueAt`, `text` ("check-in not recorded"), `guidance` | parent/guardian only; a stranger and a nonexistent child receive the same refusal | `orbit-leakage-proof` 3 — parent text, Dana UNAUTHORIZED |
| `orbitVocabulary` | `version: Int` (optional) | `[OrbitVocabularyEntry!]!` — `kind`, `value`, `version` | authenticated read; it is public vocabulary, no oracle concern | `orbit-vocabulary-proof` — 55 values, **five** kinds, version filter |
| MCP `OrbitStatus` / `CheckInStatus` | `childId`, `alertId?` / `childId` | same projections as the GraphQL reads | read-only; no photo, no activate/close; audience row set is RLS-limited | `orbit-leakage-proof` 3 |
| MCP `OrbitVocabulary` | `version: Int` (optional) | `[{kind, value, version}]` | read-only | `orbit-vocabulary-proof` |

Both are refused to the guide for writes (`DEMO_GUIDE_READ_ONLY`) and to a demo session for outreach
(`DEMO_OUTREACH_REFUSED`, E2b). Nothing here dials, sends, approves or spends.

**E3 is DONE** — evidence `38-e3-attempt-candidate-timeline.md`, `ops/e3-proof.mjs` 21/21. (The old
"E3 — NOT STARTED" line here was stale and has been removed.)

### Which router each run used, and the 115 vs 114 count

**`ops/run-evidence.mjs` is byte-identical to `origin/main`** (`git diff origin/main -- ops/run-evidence.mjs`
is empty; last touched by `cccbbd2`), and #23's 14b assertions are intact: `edge` requires 400/401 **with**
`AUTH_ERROR` plus "edge rejection carries no protected data"; `downstream` requires 200 **with**
`UNAUTHENTICATED`. A bare status never counts.

The count therefore depends on WHICH router the suite is driven through, not on the suite:

| Run | Router | 14b path | Assertions |
|---|---|---|---|
| graph suite at `0940fd4` (this task) | `router.yaml` on `127.0.0.1:4010` — **no** router-level JWT by design (it is licence-gated; subgraphs verify) | downstream: 200 `UNAUTHENTICATED` | **114 checks / 32 cases, PASS** |
| same suite on a GraphOS-connected router | `router.graphos.yaml` — `authentication.router.jwt` on | edge: 400/401 `AUTH_ERROR` + the extra no-data assertion | **115** |
| E2a / E2b / E2c / E3 proofs | `127.0.0.1:4010` (`router.yaml`) | n/a | as recorded in evidence 37/38 |
| MCP boundary proof | MCP `127.0.0.1:5051` → endpoint `127.0.0.1:4012` (alt-stack router) | n/a | evidence 37 §E2d |

The 115 figure was **not** re-measured here: it needs the GraphOS licence connection, and starting
that router would have replaced the one serving 4010. What is proven is that the difference is exactly
the one conditional assertion inside 14b, and that neither the runner nor the assertion changed.

### Group 0 (E-2, E-1) — DONE

**E-2 rebase.** 51 commits replayed onto `origin/main` `ad720de`; `main` is now an ancestor. One
conflict, in `docs/handoff/HANDOFF.md` (main's Task W sections vs this branch's §11 hard-constraint
section): resolved by **union** — both sides kept verbatim, 0 conflict markers remain, Task W, Task D
and §11 all present. PR #9 was `CONFLICTING`/draft; it is now rebased and marked ready.

**E-1 cleanup.** Both Session 3 attempts were already closed (dial by rollback 17:25:55 ET, Web Call
by its own outcome 21:35:17). State verified: **0 open attempts**, **0 active authorizations**, **1
consumed authorization kept as audit**, every closed attempt kept, **Dispatch inactive**, flag
**unset**, **no `fg-dial` tag**. Nothing deleted; no unrelated job touched. After-state note appended
to `docs/evidence/33-session-3-real-call.md`.

**Two facts from Session 3 that later groups inherit:**
1. The real dial was placed once (17:24:06 ET, 25 s) and was **unanswered — recipient's line busy**;
   no decision reached the app. The voice checks are **still unverified**.
2. The Web Call test recorded **ACCEPTED** (`available=true`, `OVER_POLICY`, 12.40) instead of the
expected DECLINED/NO_TRANSPORT. The parser is unit-proven; a real call did not produce the "no car"
text. Treat as an open voice defect, not a pass.

**Saturday fix (from Session 3, carried here):** a **mint path that takes `destination_mode`**, so a
real call does not need the direct-job-insert deviation recorded in evidence 33 §2. Group 1 E0 is the
designed replacement for that deviation.

### Group 1 (E0) — DONE (branch `feat/e-group1`, base `a5a9ae9`)

**Before:** `ops/dispatcher.mjs` never called `consume_real_call_authorization` and had no PostgREST
access; consumption was a **manual** runbook step, and `open_attempt(REAL_CONSENTED)` consumed
nothing. That is the manual hole E0 closes.

**Migration `0023_promote_real_consented.sql`** (applied; forward-only):
`promote_attempt_to_real_consented(attempt, contact)` **validates** an authorization bound to job +
candidate + recipient + the job's `request_version`, rewrites that undispatched `TEST_RESPONDER`
attempt to `REAL_CONSENTED` (destination = the GHL contact), attaches the authorization — and
**does not consume**. It raises for missing/expired/reused/wrong-recipient/wrong-version credentials,
a closed attempt, a non-discovering job, or a double promote. `service_role` only.

**One consumption point:** the dispatcher now calls the existing atomic
`consume_real_call_authorization` immediately before the webhook POST and aborts on `false`
(`CONSUME_REFUSED — no call placed`). `--dry` consumes nothing. No second attempt is ever opened, so
the `(job_id, candidate_id)` constraint is not in play.

**Proof:** `ops/0023-dry-run.mjs` — **23/23 PASS** inside a rolled-back transaction, including
“promotion did not consume”, “consume once true, twice false”, and promotion refused without an
authorization. Evidence `34-e0-real-call-mint.md`.

**Runbook:** §3 rewritten — mint via `request_pickup` → issue authorization → promote → dispatch
consumes. **No direct job insert anywhere in the path.**

**Rosina tools:** none added (this step is a mutation path; mutations are never exposed).

**PR #23** (draft, base `main`, stacked on #9 — rebase after #9 merges). Head `60d3cf5`.
**Next:** Group 2 (E1/E2/E3) branches off `feat/e-group1` while #9 and #23 are unmerged, and rebases
after each merge.


## 1. State

- **HEAD:** this branch, after the merge commit that brings in `origin/main` `f71a5ed` (see §9).
- **Runtime source of truth:**
  - `village` + `access` (grants/approvals/householdPolicy/parentingSchedule/candidates/approverFor)
    → **Postgres, per-request RLS client** (`src/db.ts`). No in-memory read on those paths.
  - `coordination`, `schedule`, `school`, `transport`, `activities` → **still `src/fixtures.ts`**
    for their own rows; their authorization calls already go to Postgres via `src/authz.ts`.
- **Migrations:** 0001–0011. New in B3: `0008` pickup-candidate definer read, `0009`
  household_members policy recursion fix, `0010` grant-holder/co-parent definer helpers,
  `0011` Daniel's grant window widened off a single day.
- **Last measured results**
  - Graph suite: **31 cases, identical in `DEMO_CLOCK=1` and `DEMO_CLOCK=0`** after B3.
  - B3 proof: `docs/evidence/20-b3-village-postgres.md` — **21/21 PASS** (`node ops/b3-proof.mjs`).
  - RLS proofs: `17` (8/8), `18` (14/14 paired). B2: `19` regenerated from a live run.
- **Last green:** B3 commit — village + access DB-backed, rest restart-proven.

## 2. Test reality check

The 31-check suite runs against a **fixture-backed** graph (subgraphs still import `src/fixtures.ts`). Therefore **31/31 does not prove any migration.** It only proves the GraphQL contract and authorization semantics are intact. Postgres correctness is proven separately by `ops/rls-check.mjs`, `ops/rls-gaps.mjs`, and (partially) `ops/b2-proof.mjs`. When B3/B4 land, re-check with a DB-only change (e.g. edit a care plan in Postgres, see it in the suite) and confirm `grep -r "fixtures" src/` returns no runtime importer.

## 3. Cold start

```bash
cd ~/Desktop/bentley/fridgegraph
set -a; . ./.env; set +a

# subgraphs (7 ports, one process)
npm start                     # 4001-4007; logs "7 subgraphs listening"
# optional test clock: DEMO_CLOCK=1 npm start

# main router — GraphOS mode, edge JWT ON (4010, health 8090)
~/.rover/bin/router-v2.18.0 --config router.graphos.yaml
#   expect: UpdateLicense(Licensed), 0 ERROR lines

# rollback router — offline, no edge auth (same ports)
~/.rover/bin/router-v2.18.0 --config router.yaml --supergraph supergraph.graphql

# MCP (5050) — standalone, survives either router
~/.rover/bin/apollo-mcp-server-v2.1.0 .apollo/mcp.local.yaml
```

Health: `curl 127.0.0.1:8090/health`; MCP probe `node ops/mcp-probe.mjs`; suite `node ops/run-evidence.mjs`.

## 4. `.env` variables (names + purpose; values never recorded)

| Name | Purpose | Status |
| --- | --- | --- |
| `SUPABASE_URL` | project base URL | present |
| `SUPABASE_PUBLISHABLE_KEY` | anon/publishable key; per-request client | present |
| `SUPABASE_SERVICE_ROLE_KEY` | server-side scripts only | present |
| `SUPABASE_DB_URL` | migrations via `supabase db push --db-url` | present |
| `SUPABASE_JWKS_URL` | router edge auth (fixes redaction mangling) | present |
| `APOLLO_KEY` | router ↔ GraphOS (licence + schema) | present |
| `APOLLO_GRAPH_REF` | `fridgegraph@dev` | present |
| `META_API_KEY` | Muse — **no calls made this run** | present |

## 5. Database

Migrations (`supabase/migrations/`, applied 0001–0007):

- `0001_schema.sql` — domain tables, FKs, checks.
- `0002_seed.sql` — fixtures by fixed id.
- `0003_rls.sql` — RLS enabled+forced on 28 tables, deny-by-default policies.
- `0004_grants.sql` — role grants (without these RLS never ran; everything was 403).
- `0005_whoami.sql` — `whoami()` RPC proving `auth.uid()` → person.
- `0006_local_today.sql` — grant windows in `America/Detroit` (UTC `current_date` expired grants at 20:00).
- `0007_village_event.sql` — history table + `ops_sentinel` (outside reset scope).

Ownership: village → people/children/households/relationships/goals/care_plans/groups/memberships/village_event; access → grants/approvals/household_policies/parenting_schedules; schedule → events; school → school_reports/permission_slips; transport → bus_rosters/vehicles; activities → practices; coordination → coordination_jobs/attempts/information_requests/confirmations; conversation_state.

RLS: `auth.uid()` → `identity_map.user_id` → `person_id`; `is_parent_of()`, `has_scope()` (local date), `current_person()`. `identity_map` has **no** policy and is revoked from `authenticated`/`anon`.

Seed/reset: `npm run db:seed`, `npm run db:reset`, `npm run db:checksum`. Boundary = fixed baseline ids + explicit table list in `scripts/db.ts`; no TRUNCATE; `identity_map`, auth users and `ops_sentinel` untouched.

`village_event` = history; `events` = schedule.

## 6. Mutation ownership (no change this run)

| Mutation | Owner | Persistence/restart evidence |
| --- | --- | --- |
| `approveRelationship` | access | fixture-backed only (B4) |
| `grantAccess` | access | fixture-backed only (B4) |
| `revokeGrant` | access | fixture-backed only (B4) |

## 7. Evidence index

`01`–`14b` graph/Auth; `15` edge JWT probe; `16` edge auth + MCP; `17` RLS core; `18` paired RLS gaps; `19` B2 seed/reset/village_event (**stale — §9**).

## 8. Gotchas (with fixes)

1. **Redaction mangling**: literals like `jwks:`, `await`, `Bearer ${x}` get written as `***`. Fix: env expansion (`SUPABASE_JWKS_URL`) and building strings from parts; always `node --check`.
2. **Grants before RLS**: without table grants every request is 403 and RLS never runs — `0004_grants.sql`.
3. **UTC `current_date` in Postgres**: expired same-day grants at 20:00 Detroit — `0006_local_today.sql`.
4. **401 vs 200-zero-rows**: anon is rejected before RLS; signed-in denials are 200 with 0 rows. Keep them distinguishable.
5. **Stale evidence near-miss**: `14b` shipped from a rollback run and contradicted the live edge router.
6. **Silent no-op `.env` append**: verify the line count after appending.
7. `rover dev` **cannot** run edge auth (unlicensed); the GraphOS-connected **binary** must be used. `pkill rover dev` orphans the router child — kill by port.
8. **Self-referencing RLS policy**: putting a table's own `SELECT` inside its own policy raises `42P17` at runtime — migration `0009` (`my_household_ids()`). Never do it.
9. **RLS hides rows the derived queries need** (grants, co-parent membership, relationship types for a `pickup.verify` holder). Fix with narrow `SECURITY DEFINER` helpers (`0008`/`0010`), never by widening a policy.
10. **`/__reset` re-seeds from the fixtures the process loaded at startup** — after editing `src/fixtures.ts`, restart the stack or in-process resets restore OLD values. This silently reverted a grant window once.
11. **Single-day grant windows make the suite pass/fail on the wall clock** (`06a` went red at 00:00). Migration `0011` widened it to a covering window.

## 9. Decisions, mixed state, and what is NOT done

- **B2 status:** migration `0007`, `scripts/db.ts`, npm scripts done; seed idempotency proven (**28 tables, 157 rows, identical checksums**); reset deleted the temp grant/relationship and restored the care plan; sentinel survived; double reset a no-op; `village_event` → Kendra 1, Chris 0.
- **Two FAIL rows in `19-b2-persistence.md` are stale text**, not live failures: Dana legitimately keeps baseline `r_dana_friend_parent` (`DISCOVERED`). The corrected assertion (grants 0, status DISCOVERED only) was patched in `ops/b2-proof.mjs` but the re-run did not finish writing the file. **Re-run `node ops/b2-proof.mjs` and commit the refreshed file.**
- **B3 DONE (village + access on Postgres).** Per-request client, publishable key + caller's token,
  no service key in request handling. Evidence 20: graph + direct PostgREST for Kendra/Loretta/Dana/
  Walter/Chris, a named-row reality check, and `approveRelationship` surviving a real restart.
- **B4 IN PROGRESS:** coordination, schedule, school, transport, activities still read fixtures.
- **B5, Section C: not started.**
- No secrets printed/committed. `META_API_KEY` present; **no model calls made**.

## 10. Risks (ranked)

1. Fixture-backed graph can drift from Postgres schema unnoticed until B3/B4.
2. Reset scope is id-based; a demo record created with a baseline-colliding id would be overwritten, not deleted.
3. `village_event` has no write policy — only service role can insert. Fine for now, must be revisited when Muse writes history.
4. Edge auth depends on GraphOS connectivity at startup; offline → use the rollback config.

## 11. NEXT RUN

1. `node ops/b2-proof.mjs` → confirm all PASS, replace `docs/evidence/19-b2-persistence.md`, commit+push B2.
2. README "Run it locally" (seed/reset/start stack) if not already committed.
3. **B3**: per-request `supabase-js` (publishable key + caller's Authorization) inside village; migrate village reads, then its writes; suite in both clock modes + restart durability + reset.
4. **B4**: access → coordination → schedule → school → transport → activities, one at a time; delete `src/store.ts` at the end; `grep -r fixtures src/` must show no runtime importer.

First three commands: `cd ~/Desktop/bentley/fridgegraph` · `set -a; . ./.env; set +a` · `node ops/b2-proof.mjs`.

## 12. Milestone 3 (pickup job) needs

Present: `coordination_jobs`, `attempts`, `information_requests`, `confirmations` (RLS-scoped, empty), `village_event` for history.
Missing: idempotency keys on job creation (unique `idempotency_key` exists — needs an enforced create path), an outbound channel adapter with labeled test responders, confirmation state that cannot be invented by the model, and a job state machine (pending → awaiting_parent → awaiting_adult → confirmed/failed) with versioned writes.

---

## 13. B3/B4 STATUS — stop point (Oct 27, 2026 00:20)

**Green and pushed, each proven by its own evidence file:**

| Step | Commit | Evidence | Proof |
| --- | --- | --- | --- |
| B3 village + access on Postgres | `f1cb43a` | `20-b3-village-postgres.md` | 21/21 |
| B4 schedule | `0de43f6` | `21-b4-schedule.md` | 8/8 |
| B4 school | `a2a1356` | `21-b4-school.md` | pass (seeded + cleaned a fictional row) |
| B4 transport | `a836604` | `21-b4-transport.md` | pass |

Suite: **31 cases, byte-identical outcome in `DEMO_CLOCK=1` and `DEMO_CLOCK=0`** after every green step
(12 single `UNAUTHORIZED` denials + 04's pair + 14a `UNAUTHENTICATED` + 14b edge `AUTH_ERROR`).

**NOT green — activities (uncommitted code in this commit, marked `wip`):**
- `activities` resolvers were migrated to Postgres, but `node ops/b4-proof.mjs activities` FAILS two checks:
  1. `edit is visible through the graph` — after patching `practices.location`, the graph returned `[]`.
     Not yet diagnosed; the same read path works in the suite (01 shows the practice row).
  2. `paired RLS` — `p_dana` reads 1 `practices` row for Nora's team. **This is a real RLS gap, not a
     test artifact:** `practices_read` (0003) authorizes on the *player's* grants —
     `is_parent_of(m.person_id) or has_scope(m.person_id,'schedule.read')` — instead of the CALLER's.
     Any signed-in user sees practices for any group whose player has a parent.
- **Decision needed (Bryan):** tighten `practices_read` to the caller (`is_parent_of(player) or
  has_scope(player,'schedule.read')` evaluated for `current_person()`), then re-run 18-rls-gaps
  because the policy changes proven evidence. Not done here: changing a policy with no budget left
  to re-verify it would be exactly the "pass the check by moving the goalposts" failure mode.

**Remaining:**
1. Diagnose the activities graph read, then finish activities (needs the policy decision above).
2. Migrate `coordination` (all four tables are empty by design; proof harness already supports
   seed-and-clean via `emptyByDesign`).
3. Delete `src/store.ts`; `grep -rn "fixtures" src/` must show no runtime importer
   (`scripts/db.ts` legitimately imports `createSeed` to build the seed baseline).
4. Re-run the full battery: both clock modes, `b3-proof`, `b4-proof <owner>`, MCP probe as Kendra
   (expect 4 pickup candidates), secret scan for `***` outside fixture data.
5. MCP (5050) was not re-proven after B3/B4 — do that in the final pass.

**New gotchas found this run (add to §8 when next editing):**
- Self-referencing RLS policy on `household_members` = `42P17` at runtime → migration `0009`
  (`my_household_ids()`). Never put a table's own select inside its policy.
- RLS hides *other people's* rows the derived queries need (grants, co-parent membership,
  relationship types for a pickup.verify holder) → narrow `SECURITY DEFINER` helpers in `0008`/`0010`
  rather than widening policies.
- `/__reset` re-seeds from the fixtures the **server process loaded at startup**; after editing
  `src/fixtures.ts` you must restart the stack or in-process resets restore the OLD values. This
  silently reverted Daniel's grant window once and cost a debugging cycle.
- A single-day grant window in the seed makes a suite case pass/fail on the wall clock
  (`06a` went red at 00:00 Oct 27) → migration `0011` widened it to a covering window.

---

## 14. B4 COMPLETE (Oct 27, 2026) — store removed

`src/store.ts` is **deleted**. `grep -rn "fixtures" src/` shows only `src/fixtures.ts` itself and
two stale comments; `scripts/db.ts` still imports `createSeed` to build the seed baseline, which is
its only remaining purpose. Every subgraph reads its own tables through the per-request RLS client.

Suite after the deletion, with no in-memory fallback anywhere:
**31 cases, outcome identical in `DEMO_CLOCK=1` and `DEMO_CLOCK=0`, 0 `DB_UNAVAILABLE`.**

Green steps (each with its own evidence file):

| Step | Commit | Evidence |
| --- | --- | --- |
| B3 village + access | `f1cb43a` | `20-b3-village-postgres.md` (21/21) |
| B4 schedule | `0de43f6` | `21-b4-schedule.md` |
| B4 school | `a2a1356` | `21-b4-school.md` |
| B4 transport | `a836604` | `21-b4-transport.md` |
| B4 activities | `6840829` | `21-b4-activities.md` |
| B4 coordination | `32d669a` | `21-b4-coordination.md` |
| store removed | this commit | final suite above |

### The reported practices_read "gap" was a bad test premise — NOT fixed, deliberately

`practices_read` already evaluates for the CALLER: `is_parent_of(m.person_id)` and
`has_scope(m.person_id, scope)` are `current_person()`-anchored definer helpers. `p_dana`'s single
row was correct access — **Jax is a Tigers player** (`memberships: p_jax / g_tigers / player`).
No policy was rewritten; rewriting it would have broken correct behaviour to satisfy a wrong
expectation. `ops/practices-authz.mjs` / `evidence 22` records the probe table, proves the guard
actually FIRES (withdraw Jax → Dana 1→0, restored → 1), and states the genuine no-op (Kendra stays
at 1 because Nora is still a player).

### Still open

1. **MCP PickupCandidates as Kendra → 4 candidates: RESOLVED (Oct 28, 2026).** Re-proved through
   MCP → router → subgraph → RLS on both routers: see `docs/evidence/16b-b5-mcp-reproof.md`. The
   earlier `ROUTER_FREE_PLAN_RATE_LIMIT_REACHED` was an account plan limit; a single paced probe on
   the GraphOS-connected router now returns 4 candidates with no rate-limit response.
2. `practices_read` authorizes on any group the player belongs to while the resolver surfaces only
   team groups. Scoping question, not a leak; left as-is and flagged in evidence 22.

---

## 15. MCP mutation exposure — pinned to `explicit` (Oct 28, 2026)

`.apollo/mcp.local.yaml` now carries `overrides.mutation_mode: explicit`.

Key and values verified against the **installed binary** (Apollo MCP Server v2.1.0), not only the
skill docs: the field is `mutation_mode` inside `overrides`, and the enum is `none | explicit | all`.

Measured on 2026-10-28 with one query file and one mutation file (`tools/list`):

| `mutation_mode` | Tools exposed |
| --- | --- |
| `explicit` | `PickupCandidates`, `ApproveRelationship` |
| `none` | `PickupCandidates` only (log: `Skipping mutation operation ApproveRelationship`) |
| `all` | `PickupCandidates`, `ApproveRelationship` |

A mutation that has **no operation file** is not exposed in any mode: `grantAccess` and
`revokeGrant` both return `-32602 Tool <name> not found`. Ad-hoc `execute` is separately disabled,
so there is no path to an arbitrary mutation.

With the real repo config (only the port changed for the test) `tools/list` returns exactly
`PickupCandidates`.

**This is an exposure gate, not authorization.** Apollo states `mutation_mode` is a configuration
gate, never per-invocation approval. Every write still runs as the caller's own JWT through the
router and the subgraph resolvers, where identity, scope, parent checks and (for Station 06)
idempotency and explicit parent approval must be enforced. Adding a mutation file must never be
treated as granting it.

## 16. Pre-exposure checklist — public hosting

**Decision (Oct 28, 2026): Cloudflare Tunnel from Bryan's Mac.** It must stay up through judging.
Not set up yet; do not create it until Station 06 needs it.

**Exposure order.** Station 06 needs a public URL for the GHL Custom Action: expose **only the
voice/webhook endpoint first**. The GraphQL router stays private until every gate below passes.

| # | Gate before the router is public | State today | Where |
| --- | --- | --- | --- |
| 1 | `authentication.router.jwt.on_error: RedactedError` | **FAIL** — currently `Error`, returns detailed validation messages | `router.graphos.yaml` |
| 2 | GraphQL introspection **off** | **FAIL** — `introspection: true` | both router configs |
| 3 | Apollo sandbox / homepage explicitly disabled | not configured | both router configs |
| 4 | `include_subgraph_errors` not `all` | **FAIL** — leaks subgraph error detail | both router configs |
| 5 | CORS: no wildcard origin, explicit allowlist | not configured | both router configs |
| 6 | `overrides.mutation_mode: explicit` | **PASS** (pinned) | `.apollo/mcp.local.yaml` |
| 7 | Bind address / tunnel scope: only the intended listener is tunnelled | n/a (no tunnel yet) | Cloudflare |
| 8 | Supabase password rotation | due **before the repo goes public**, not a merge gate | — |

Both router configs are **localhost-only development configs** that bind `127.0.0.1`. They are
correct for local work and must never be promoted as-is.

## 17. SECURITY DEFINER audit — nine functions in `public` (Oct 28, 2026)

Read-only at the time of the audit. The fix below was prepared afterwards and applied on
2026-10-28 with explicit approval.

**Correction to the first version of this section (the repo text and the live database differ).**
Eight of the nine functions pin `set search_path = public`. `local_today()` does **not**: the live
catalog shows `prosecdef = false` and **no** `proconfig`, i.e. a plain `STABLE` SQL function with
no SECURITY DEFINER and no pinned search path — while `0006_local_today.sql` in this repo declares
both. So the earlier "9 of 9" claim was taken from the migration file and was wrong about the
live object. `local_today()` only computes a date from `now()`, both resolved from `pg_catalog`,
so there is no table reference for a search-path attack to redirect; the risk is nil, but the
drift is real and is recorded here rather than silently "fixed". Re-applying 0006 verbatim would
change a live function's attributes, which is out of scope for a grant migration.

All nine live in `public`, the schema PostgREST exposes.

Live probe through PostgREST RPC — as `anon` (publishable key, no user token), as `p_walter`
(authenticated, unrelated adult) and, for child-scoped helpers, as `p_dana` (cross-village):

| Function | `anon` | `p_walter` | `p_dana` | Notes |
| --- | --- | --- | --- | --- |
| `current_person()` | **200** `null` | 200 own id | — | anon-executable |
| `local_today()` | **200** `2026-10-28` | 200 | — | anon-executable |
| `is_parent_of(child)` | **200** `false` | `false` | `false` | anon-executable |
| `has_scope(child, scope)` | **200** `false` | `false` | `false` | anon-executable |
| `whoami()` | 401 `42501` | 200 own id | — | correctly locked |
| `my_household_ids()` | 401 `42501` | `[]` | — | correctly locked |
| `parent_ids_of(child)` | 401 `42501` | `[]` | `[]` | correctly locked, no leak |
| `pickup_candidates_for(child, date)` | 401 `42501` | `[]` | `[]` | correctly locked, no leak |
| `grant_holders_for(child, scope, date)` | 401 `42501` | `[]` | `[]` | correctly locked, no leak |

**Result: no unauthorized data retrieval.** The three child-scoped helpers return empty for an
unrelated adult and for a cross-village parent, and are refused outright for `anon`. Their internal
`is_parent_of` / `pickup.verify` gates work.

**Finding (low severity, posture not leak):** four functions — `current_person`, `local_today`,
`is_parent_of`, `has_scope` — were created without `revoke all … from public`, so they keep
Postgres's default PUBLIC execute and are callable by `anon`. What an unauthenticated caller
actually gets is a null identity, the local date, and two booleans that are always false for them.
No row data is disclosed. The defect is inconsistency: the other five were explicitly revoked.

**Fix applied: `supabase/migrations/0012_revoke_public_execute.sql` (Oct 28, 2026).**
`revoke all … from public` and `from anon` on those four, plus an explicit `grant execute … to
authenticated` (revoking PUBLIC also removes the inherited grant from `authenticated`, which is the
role every request uses). Bodies, policies, tables and `search_path` are untouched.

Catalog ACL, before → after (`has_function_privilege`):

| | `anon` before | `anon` after | `authenticated` before/after |
| --- | --- | --- | --- |
| `current_person()` | YES | **no** | yes → yes |
| `local_today()` | YES | **no** | yes → yes |
| `is_parent_of(text)` | YES | **no** | yes → yes |
| `has_scope(text, text)` | YES | **no** | yes → yes |

Behavioural verification, direct PostgREST (`node ops/run-evidence.mjs`, case 26):

- `anon` on all four → `401 42501` (was `200`)
- authenticated (Kendra) on all four → `200` (no regression)
- authorized data path intact: Angela (`pickup.verify`) → `pickup_candidates_for` **18 rows**
- unauthorized path intact: Walter → `pickup_candidates_for` **0 rows**
- asserted suite: **114 checks across 32 cases, PASS at `DEMO_CLOCK=0` and `DEMO_CLOCK=1`** —
  this is the regression test that revoking PUBLIC did not break the RLS policies that call these
  helpers as `authenticated`.

Residual drift, not fixed (needs its own decision): `local_today()` is not SECURITY DEFINER and has
no pinned `search_path` in the live database, unlike the repo's 0006.

---

## Task W progress — judge-ready web (2026-10-30)

Three states: UI complete · backend complete (Bentley) · integrated + tested. Only integrated
and tested against real services is DONE. No steps are DONE. One branch/worktree/PR per step
from main 72c1cf5; rebase after Bryan merges earlier work. Never merge.

| Step | UI complete | Backend complete (Bentley) | Integrated + tested |
|---|---|---|---|
| W1 — PR #17 | yes, read-only transport + derived feed | primitive reads exist; demo session delivery unavailable | fixture integration tested; live session not tested; NOT DONE |
| W2 — PR #19 | yes, mock | demo login/reset/create unavailable | mock-tested (61 tests); live not tested; NOT DONE |
| W3 — PR #20 | yes, mock | Rosina service unavailable | mock-tested (78 tests); live not tested; NOT DONE |
| W4 | not started | awaiting services | not started |

### W1 implemented surfaces and provenance

- Mission Control reads live `coordinationJobs` + `attempts(jobId)`. Its feed is **derived**,
  never a synthetic event history. Only attempts, recorded confirmations and cost-calculation
  facts carry their own timestamps; job status/version, reasonCode, availability and acceptedVia
  appear under Current state, without manufactured times. Timestamped events never claim an old
  job version or status observed at that time. Candidate channel is **unavailable** (`—`).
- Living Village: **derived** graph projection from live `village`, `child`, `householdMembers`
  and `relationships`. No inferred private roles or fabricated edges. Polls at 30s; Mission
  Control polls at 2.5s. Forbidden results stop polling and show access denial.
- Graphql mode is read-only and has no `readParentChat`. Mock is the default, including tests.
  Legacy mock chat is **unavailable as a live surface**; W3 replaces it with Ask Rosina.
- `/graphql` proxies to 127.0.0.1:4010. Apollo gets the existing Supabase user's access token
  using publishable runtime configuration. No browser passwords or server credentials. The
  connected entry accepts child/village IDs and checks session presence; actual access is server-side.
  It displays unavailable login rather than substituting a mock session. W2/W4 replace this entry.

Validation run: root typecheck PASS; staged secret scan PASS; web **61 tests PASS**; production
build PASS (existing >500kB bundle warning). Playwright CLI checked the derived GraphQL fixture
preview and denied response at desktop/mobile. Screenshots: `web/evidence/task-w/w1-desktop.png`,
`w1-mobile.png`; cost correction screenshots `cost-normal-desktop.png`, `cost-normal-mobile.png`.
These are explicitly labeled fixture previews, not evidence of a live authenticated service.
No live DB evidence suite/probes run: frontend-only, credential-free; those suites are backend scope.

Bentley needs: real demo-login session + authorized scopes; jobTimeline to replace the derived
feed; Attempt.candidate to join channels by candidate id. Parent chat/chatThread is DROPPED.
No attempt destination-mode field exists today; the UI makes no claim about individual deliveries.

BRANCH: feat/web-graphql-adapter; WORKTREE: /Users/user/Desktop/bentley/fridgegraph-web-adapter
TASK: complete W1 read-only adapter, keeping PR #17 draft until live integration.
LAYER: frontend + companion frontend contracts/handoff/mocks only.
TOUCHED: web/, docs/contracts/frontend-data.md, docs/mocks/pickup-candidates.json,
  docs/mocks/pickup-job-lifecycle.json, docs/mocks/mission-control.json,
  docs/mocks/parent-chat.json, docs/handoff/HANDOFF.md.
DONE WHEN: npm run typecheck; npm run check; npm --prefix web test (61);
  npm --prefix web run build; live authenticated Mission Control + village browser proof still required.
NOT DOING: server/schema/auth/DB, merges, Family Calendar, v2 catalog proposals.
BLOCKERS: real authenticated integration unavailable; use explicit mocks for the next UI steps.

### Task W cost-fixture correction (2026-10-30)

Authority: pickup-job.md §6a (PR #14). Normal night: Loretta is AVAILABLE_NO_TRANSPORT;
all candidate costs and bases are null. Drivers are never costed. The explicitly named
**no-driver night** alone carries the $12.40 OVER_POLICY example. mockSync's assertions stay intact.
The source candidate/lifecycle mocks also contained stale driver costs; those documentation
records are reconciled to §6a in this correction. No seed, schema, auth or database changes.

§1.5 rideshare-label amendment is proposed for Bryan's approval in PR #17. The UI describes
the ride and preserves the backend basis; null costs have no label, while zero remains visible.

Bentley follow-up (reported, unchanged): pickup-candidates.json lists Loretta's DEMO-103 vehicle;
the seed has no vehicle for p_gma and PR #14's harness asserts zero. Decide whether the scenario
is “no vehicle on file” or “vehicle on file but not available today”. This does not block web work.

### Task W cross-step resume pointers

- W1: https://github.com/Pettybytes/fridgegraph/pull/17 — feat/web-graphql-adapter, this worktree; 61 tests.
- W2: https://github.com/Pettybytes/fridgegraph/pull/19 — feat/web-persona-picker,
  /Users/user/Desktop/bentley/fridgegraph-web-persona-picker; 61 tests.
- W3: https://github.com/Pettybytes/fridgegraph/pull/20 — feat/web-ask-rosina,
  /Users/user/Desktop/bentley/fridgegraph-web-ask-rosina; 78 tests.

All UI steps are complete with explicit mocks/derived facts; all are draft and NOT DONE because
real-service integration is untested. W2 includes the shared policy correction; W3 includes policy
and W2 prerequisites. Main remains 72c1cf5 at this check. Rebase/deduplicate and reconcile App after
Bryan merges prior steps. Do not mark fixture browser runs as live proof. W4 remains conditional
on Bentley delivery. No merge, tag, release or database action was performed.

### Task W pre-merge copy corrections — W1

Human display labels replace workflow codes, version numbers and confirmation/household IDs.
Recorded values stay in adapter data; no new facts or authors were invented. The connected entry
no longer asks a family to enter internal child/village IDs; its scope still awaits demo login.
Mission Control and Living Village accept a persona-aware denied-state slot for W2/W3; the
credential-free W1 fallback explains sharing instead of rendering a bare denial.
Touched paths additionally include web/src/lib/frontendData/AccessEmptyState.tsx, displayCopy.ts,
displayCopy.test.ts and web/src/features/village/PersonCard.tsx; frontend only.
Validation: root typecheck, secret scan, web build PASS; **62 web tests PASS**. Playwright CLI
screenshots: web/evidence/task-w/w1-access-desktop.png and w1-access-mobile.png. No live integration
claim; W1 remains NOT DONE. Follow-up stack rebase is authorized by Bryan's copy-fix request.

## Task W progress — pre-merge copy review (current)

| Step | PR | Web tests | UI complete | Backend complete (Bentley) | Integrated + tested |
|---|---|---|---|---|---|
| W1 | #17 | 62 PASS | yes | primitive reads available; session delivery incomplete | fixture-tested, live untested; NOT DONE |
| W2 | #19 | 70 PASS | yes | demo login/reset/create unavailable | mock-tested, live untested; NOT DONE |
| W3 | #20 | 88 PASS | yes | Rosina service/action integration unavailable | mock-tested, live untested; NOT DONE |
| W4 | — | not run | pending services | unavailable | not tested |

Copy corrections stay on the owning feature branches. No author is recorded on the current care
plan; sources use “Nora's care plan” without attributing Kendra. W2 groups existing personas and
reserves portrait space. W3 answers first, cites plain-language evidence and offers role-aware,
catalog-validated screen cards. Schedule remains unavailable; Family Calendar and future v2
entries are deferred. Existing visual identity retained. Branch stack is W1 → W2 → W3 with PR
bases kept on main; final readable-label changes must be included before pushing the rebased tips.
No main merge, tag, release, server/auth/schema change or live database action was performed.

Main advanced during the copy pass: PR #18 added coordination-v2.md at 3ad23eb (docs only).
W1 was rebased onto that main. The contract's current/future visibility and catalog constraints
were reviewed; proposed backing models still are not implemented by a document merge. No v2
household, catalog entry or Family Calendar was added. W2 and W3 must be replayed above this tip
before final publication; author attribution still uses the existing record, not proposed fields.

## Task W progress — W2 persona picker (2026-10-30)

| Step | UI complete | Backend complete (Bentley) | Integrated + tested |
|---|---|---|---|
| W1 — PR #17 | yes | primitive reads; login unavailable | fixture-tested; live not tested; NOT DONE |
| W2 — PR #19 | yes, mock | demo-login/reset/create unavailable | mock-integrated + tested; live not tested; NOT DONE |
| W3 — PR #20 | yes, mock | Rosina unavailable | mock-tested (78 tests); live not tested; NOT DONE |
| W4 | not started | awaiting delivery | not started |

Branch created from main 72c1cf5 with the W1 cost correction cherry-picked as a shared prerequisite
so the existing fixture-sync assertions remain intact. No W1 adapter code is included. After Bryan
merges W1, rebase this branch onto main and reconcile App's connected entry; never merge autonomously.

Surface states: entry/sign-in/reset/create = **unavailable live**, explicit mocks. Mission Control
and Living Village = **unavailable live** in this step, conservative mock projections. Priya's
mock **care information** is derived verbatim from src/fixtures.ts carePlans and visible only under
her careplan.read example. Loretta has pickup.request/schedule.read/goals.read; Priya has
supervise.request/schedule.read/careplan.read. Neither gets parent job data or the broad village mock.
Dana scopes to her own child Jax; the Jax-family entry represents Ray. No invented identity.

Private cleanup synchronously unmounts the old workspace before any await, clears Apollo through
clearStore (plus adapter clearStore when provided), remounts selections/cards under the session
generation, and ignores superseded sign-in/family responses. W3 must register conversation cleanup
with the same session registry. Connected mode never signs into the live graph with a mock identity.

Validation: root typecheck PASS; secret scan PASS; **61 web tests PASS**; production build PASS
(existing >500kB warning). Six new session tests cover cache/DOM clearing, a late sign-in response,
Kendra → Loretta, Priya's grants and mock family validation/reset. Existing shell tests now enter via
Kendra instead of assuming private data before sign-in. Playwright CLI checked desktop/mobile,
Kendra → Loretta with a MutationObserver (no old private content in switch mutations), Priya's
care-only view, and mock create/reset. Screenshots: web/evidence/task-w/w2-desktop.png, w2-mobile.png.

BRANCH: feat/web-persona-picker; WORKTREE: /Users/user/Desktop/bentley/fridgegraph-web-persona-picker
TASK: six-person mock entry, session isolation and sandbox demo controls.
LAYER: frontend and companion handoff only (plus shared W1 policy prerequisite).
TOUCHED: web/src/features/personas/, web/src/App.tsx, web/src/lib/frontendData/types.ts,
  web/src/app/Shell.test.tsx, web/src/app/VillageRoute.test.tsx, web/evidence/task-w/, this handoff.
DONE WHEN: npm run typecheck; npm run check; npm --prefix web test (61);
  npm --prefix web run build; real demo-login/reset/create integration still required.
NOT DOING: backend auth, passwords, credentials, DB, Family Calendar, merge, v2 catalog entries.
BLOCKERS: Bentley's server-side demo-login must return the actual user session and authorized
  scope; resetDemo/createDemoFamily endpoints and their contracts remain unavailable.

W2 privacy follow-up: switching/reset clears selected-person hash parameters before the next session loads. A dedicated route-cleanup test passes. PR: https://github.com/Pettybytes/fridgegraph/pull/19.

Task W resume: W1 #17 (61 tests), W2 #19 (61 tests), W3 #20 (78 tests) are pushed draft PRs.
All UI steps complete; Bentley services unavailable and live integration untested; none DONE.
W3 worktree: /Users/user/Desktop/bentley/fridgegraph-web-ask-rosina. Main still 72c1cf5; rebase
after Bryan merges earlier steps. W3 already registers conversation cleanup and owns the catalog
structure; do not implement future coordination-v2 entries or the Family Calendar prematurely.

### Task W pre-merge copy corrections — W2 (current)

W2 is rebased onto updated W1 (f6d4744); PR base remains main. Shared policy commits were
deduplicated. The feature branch history is rewritten only for this requested stack rebase.
The picker groups Nora's four existing personas under “Nora's village” and Dana/Ray under
“Jax's family”. Portrait space keeps initials; no portraits or additional households invented.
The sharing boundary derives its explanation from the persona's recorded mock grants. Priya sees
“Pickup plans are shared with Nora's parents. You can see Nora's schedule and care information.”
Her implemented care screen is offered; schedule is explicitly unavailable, not a new calendar.
W3 replaces these read-only screen links with catalog-validated cards on its branch.
Care sources say “Source: Nora's care plan”. Current CarePlan has no author field, so Kendra is
not attributed. A display helper accepts an author only when actual source metadata supplies one.
No file paths or workflow codes appear in the new source labels. Visual identity retained.
Added paths: web/src/features/personas/PersonaAccessState.tsx, careInformation.tsx,
PersonaPicker.test.tsx; MissionControl/LivingVillage use W1's denied-state slot. Care information
is a derived mock projection; live service remains unavailable. No auth/schema/DB changes.
Validation: root typecheck, secret scan, production build PASS; **70 web tests PASS** including
household grouping, care privacy and persona-isolation regressions. Playwright CLI checked the
grouped entry and Priya's sharing → care path at desktop/mobile. New screenshots are append-only:
web/evidence/task-w/w2-copy-desktop.png and w2-copy-mobile.png. W2 remains NOT DONE for live integration.

Final W2 stack check: rebased onto W1 including its final readable relationship/contact labels
and current progress table. Post-rebase root typecheck, secret scan, build and **70 web tests PASS**.
Full-page grouped picker evidence: web/evidence/task-w/w2-grouped-final-desktop.png and
w2-grouped-final-mobile.png. Existing evidence retained. W2 remains mock-tested, NOT DONE for live
integration. PR #19 stays based on main; no main merge. W3 must be rebased onto this updated tip.

## Task W progress — W3 Ask Rosina (2026-10-30)

| Step | UI complete | Backend complete (Bentley) | Integrated + tested |
|---|---|---|---|
| W1 — PR #17 | yes | primitive reads exist; real login unavailable | fixture-tested; live not tested; NOT DONE |
| W2 — PR #19 | yes, six personas | login/reset/create unavailable | mock-tested, 61 tests; live not tested; NOT DONE |
| W3 — PR #20 | yes, mock | Rosina endpoint/proxy target unavailable | mock-tested, 78 tests; live not tested; NOT DONE |
| W4 | not started | awaiting real services | not tested |

This branch was created from main 72c1cf5 and carries shared policy + W2 prerequisite commits,
without W1's GraphQL adapter. After Bryan merges earlier steps, rebase onto main, deduplicate
prerequisites and reconcile App's connected entry. No agent merge. No step is DONE yet.

### W3 surfaces and authority

- Ask Rosina appears on every mock screen, including entry. **Unavailable live**, explicitly
  scripted mock. Desktop dock; mobile sheet with close/Escape. History uses the existing
  ChatMessage model in memory, scoped to persona; each request sends prior role/content messages.
  Switching aborts/discards pending replies and removes draft/thread/pending confirmations.
- Current-screen explanation is **derived** from implemented UI behavior. Recommendation
  explanation is **derived** from the current recorded candidate reasonCode, never invented
  ranking reasons. Mock afternoon answer reads the current pickup status and does not imply
  a complete calendar. Care answer is **derived** from the care-plan fixture, cited verbatim.
- The catalog owns id/label/schema/handler/changesData/implemented. Unknown/bad/unimplemented
  actions are dropped. Routes are built locally; a person must occur in the available village
  projection. Child scope is rechecked for pickup. Model-written HTML and links remain plain text.
- Pickup execution is **unavailable live**: mock review always passes through the app-owned
  confirmation dialog, even if a response says no confirmation is needed. Cancel performs no
  action. Confirm consumes the card; the reply explicitly says no live job was created.
- Service adapter POST /api/rosina attaches the user bearer and client history, checks response
  shape, and refuses missing sessions. The live snack flow returns exactly “I can't confirm that
  yet” until the approved v2 care-rule integration exists. No guessed service port/proxy target.
- Contract: docs/contracts/ask-rosina.md. Its clearly marked coordination-v2 section defines no
  future IDs or args. Every current catalog entry has implemented. Family Calendar is deferred.

Validation run: root typecheck PASS; staged secret scan PASS; **78 web tests PASS**; production
build PASS (existing >500kB warning). Seventeen Rosina tests cover all seven acceptance examples,
unknown/bad/unimplemented actions, app confirmation despite a response's bypass claim, Cancel,
plain text/links, bearer/history shape, live care uncertainty and late reply/persona isolation.
Playwright CLI exercised all seven scripted examples, no cross-family disclosure, confirmed mock
pickup, Kendra → Priya conversation clearing, actual Loretta card routing, mobile close/Escape,
and additional boundary replies as Andre, Dana and Jax's family. These are scripted mock checks,
not W4 independent exploration or evidence of a live model. Desktop/mobile screenshots:
web/evidence/task-w/w3-desktop.png and w3-mobile.png.

Browser finding, corrected (verbatim initial mock reply): “You can open an available person card
from your own village.” The requested Tasha card was absent from that mock projection, so the
catalog correctly dropped it; the mock now resolves named people from the available projection
and explicitly explains an unavailable card. Loretta's card was exercised successfully. No live
Rosina model ran, so there are no live model errors to report or conceal.

BRANCH: feat/web-ask-rosina; WORKTREE: /Users/user/Desktop/bentley/fridgegraph-web-ask-rosina
TASK: catalog-controlled Ask Rosina with seven scripted flows and private client-side history.
LAYER: frontend and companion frontend contract/handoff (plus shared prerequisites).
TOUCHED: web/src/features/rosina/, web/src/App.tsx, web/src/app/Shell.tsx,
  web/src/app/Shell.test.tsx, web/src/features/village/LivingVillage.tsx,
  web/src/features/personas/Session.test.tsx, web/evidence/task-w/, docs/contracts/ask-rosina.md,
  docs/handoff/HANDOFF.md. Earlier prerequisites are separately committed.
DONE WHEN: npm run typecheck; npm run check; npm --prefix web test (78);
  npm --prefix web run build; real service + W4 exploration/browser runs still required.
NOT DOING: schema/auth/DB, service implementation, Family Calendar, future v2 catalog definitions,
  real outreach, merge/tag/release.
BLOCKERS: Bentley's authenticated demo login/scopes, Rosina service URL/port and endpoint,
  no-history-persistence guarantee, live pickup handler integration, reset/create APIs,
  jobTimeline and Attempt.candidate. W4 must report actual model mistakes verbatim.

W3 PR: https://github.com/Pettybytes/fridgegraph/pull/20 (draft, pushed). Resume map: W1 #17
(61 tests), W2 #19 (61 tests), W3 #20 (78 tests). No steps DONE; UI complete and explicit mocks
are tested, while real backend integration remains untested. Main still 72c1cf5. After Bryan
merges earlier steps, rebase/deduplicate prerequisites and reconcile App with W1; never merge.

### Task W pre-merge copy corrections — W3 (current)

W3 is rebased onto updated W2, with W1 beneath it; duplicate shared policy/privacy commits were
removed. PR base remains main. Resolve future upstream merges by rebasing, never merging here.
Scripted replies lead with the answer or clearly state what cannot be confirmed, then cite recorded
evidence. The snack answer begins “No, Nora has a peanut allergy.” and quotes the care plan.
Its source is “Nora's care plan”: no path, table name, workflow enum or invented “added by Kendra”.
Current source record has no author metadata. Future author attribution must come from the record.
Other sources say “the pickup plan” or “Nora's pickup plan”, with readable status labels.
Sharing boundaries use catalog-validated open-screen cards for care information and Ask Rosina.
Care cards are filtered by actual mock care access; the care screen checks that access again.
Schedule remains explicitly unavailable, with no usable schedule card and no Family Calendar.
The same catalog owns implemented flags, schemas, labels and route construction for both the
empty-state cards and conversation cards. Current routes add care-information and ask-rosina;
no future coordination-v2 entries are defined. Display labels say “Open care information” etc.
Demo conversation/confirmation copy describes the effect to the person, without implementation
terms. UI identity unchanged; household grouping and portrait initials come from W2.
Additional path: web/src/features/rosina/CatalogCards.tsx. Scope is frontend + companion contract
and handoff only. Live services remain unavailable; no auth/schema/DB changes or merge.
Validation: root typecheck/secret scan/build PASS; web tests and desktop/mobile Playwright checks
cover revised acceptance flows, answer-before-evidence, plain sources, no invented author, role-aware
sharing cards, care access filtering, persona privacy and confirmation. See final counts below.
Screenshots: web/evidence/task-w/w3-copy-desktop.png and w3-copy-mobile.png (new artifacts; old retained).

Current pre-merge validation: **88 web tests PASS**, root typecheck PASS, staged secret scan PASS,
production build PASS. Playwright CLI exercised all seven revised replies, care sharing cards,
mobile Ask Rosina navigation/Escape, and Loretta's absence of care cards/private care text.
The stack will receive W1's final readable relationship labels before the final push.

Final W3 stack validation: W1 → W2 → W3 ancestry verified after the requested rebase. Final root
typecheck, staged secret scan, web build and **88 web tests PASS**. W1 has 62 passing tests; W2 has
70 passing tests. The current three-state table above still applies: UI complete; real backend
services incomplete/unavailable; only fixture/mock integration tested; none DONE. PRs remain draft.
A mobile browser check initially timed out waiting for “Open care information” after navigating
to Ask Rosina (TimeoutError: locator.click, waiting for getByRole('link', { name: 'Open care information', exact: true })).
The check was corrected to return to Mission Control first; the same care navigation and Loretta
privacy assertions then passed. No assertion was relaxed and no app failure was called expected.
Sources must remain plain language and record-authored; author metadata remains a nonblocking
Bentley follow-up. Final rebased feature tip is pushed with a lease, never to main. No merge.

Final main update: the whole stack is rebased above main 3ad23eb (Coordination v2 contract, PR #18,
docs only): main → W1 → W2 → W3. W1/W2 code checks remain 62/70 PASS. W3's reserved contract section
now acknowledges the merged document and waits for backing migrations/services, not merely a doc.
A stale Area G sentence claiming current v1 catalog entries already had implemented:false was
corrected to describe their available mock handlers and unavailable live execution; future v2
wrappers remain unimplemented. This is a UI-reference correction only, with no new v2 action
IDs, schema or authorization rule. Touched packet additionally includes that paragraph of
docs/contracts/coordination-v2.md. Four future households and Family Calendar remain outside this
copy pass; their actual backing data/migrations have not landed in this main update.

Final publication check after main 3ad23eb and the approval-copy correction: ancestry verified
main → W1 → W2 → W3; post-rebase checks actually run and observed PASS: W1 62, W2 70, W3 88 web
tests, plus each branch's root typecheck, secret scan and web build. Human “Pickup marked confirmed”
never substitutes for separate Confirmation evidence; recommendation copy calls parent approval
a separate decision, not an inferred fact. All three PRs are draft and live integration remains
untested/NOT DONE. Copy corrections and screenshots are published on their owning branches.

### Task W squash-merge rebase — main 215df4a

Bryan squash-merged W1 (#17) as 215df4a. W2 was replayed with
`git rebase --onto origin/main 1880d70 feat/web-persona-picker`; W3 was replayed with
`git rebase --onto feat/web-persona-picker 05475c9 feat/web-ask-rosina`.
Range-diff verified all five W2 patches and all six W3 patches unchanged. Pre-squash W1 commits
were removed from both branches' pending history. No UI, schema, auth or database changes.
Observed checks after rebasing: W2 **70 web tests PASS**, W3 **88 web tests PASS**; root typecheck,
secret scan (zero findings), and web production build PASS on both. Existing bundle warning remains.

BRANCH: feat/web-persona-picker (#19), feat/web-ask-rosina (#20); existing sibling worktrees.
TASK: restack W2/W3 after W1's squash merge, without reintroducing W1's original commits.
LAYER: frontend history and this companion handoff only.
TOUCHED: commit ancestry only; docs/handoff/HANDOFF.md records this rebase.
DONE WHEN: both branches pass web tests, typecheck and secret scan, are pushed with leases,
  and GitHub reports MERGEABLE against main. Live integration remains a separate pending task.
NOT DOING: UI changes, merging, tags, releases, backend/auth/schema/database work.
BLOCKERS: none found in the rebase or local checks; verify GitHub's refreshed state after pushing.

## Task CAL progress — Family Calendar

BRANCH: feat/web-family-calendar; WORKTREE: /Users/user/Desktop/bentley/fridgegraph-web-family-calendar
BASE: actual origin/main 64429d94054d6429f6492ce05cd4a6e0ccf16226 (fetched at task start).
TASK: week/day calendar UI on explicit v2-shaped mocks; real integration queued alongside W4.
LAYER: frontend + companion calendar contract/handoff.
TOUCHED: web/src/features/calendar/, web/src/features/personas/, web/src/features/rosina/,
  web/src/app/Shell.tsx, web/src/App.tsx, web/evidence/task-cal/,
  docs/contracts/family-calendar.md, docs/contracts/frontend-data.md,
  docs/contracts/ask-rosina.md, docs/handoff/HANDOFF.md.
DONE WHEN: npm run typecheck; npm run check; npm --prefix web test; npm --prefix web run build;
  desktop/mobile Playwright proof including Rosa and the Detroit DST week.
NOT DOING: server/schema/auth/DB, live queries against proposed SDL, merges/tags/releases.
BLOCKERS: Bentley's v2 event/holiday/busy reads are not delivered; no credential needed for mocks.

| Surface | UI | Backend (Bentley) | Integrated + tested |
|---|---|---|---|
| Calendar | complete on mocks | unavailable; Bentley v2 reads pending | mock adapter + UI tested; live NOT DONE |

Baseline actually run: typecheck PASS, secret scan clean, 88 web tests PASS, build PASS.
Mock identities/scenarios are fictional projections of coordination-v2's Cast/seed plan, not live
seed claims. Guardian authority is distinct from the parent flag. Busy projections contain no
reason, employer, other-child or other-household detail. No real authorization is implemented here.
Mock holiday dateStart/dateEnd are inclusive Detroit calendar dates; wire end semantics need
confirmation before live integration. Bryan confirmed inclusive calendar dates for the mock;
no backend wire boundary was guessed.


Task CAL mock verification (2026-10-30): root typecheck PASS; **117 web tests PASS** (88
baseline + 29 additions); production build PASS (existing >500 kB chunk advisory). Detroit
adapter/time suite: **13 PASS** under TZ=UTC and **13 PASS** under TZ=Pacific/Auckland.
Playwright production-preview proof: **5 persona flows PASS** (Kendra, Priya, Dana, Rosa,
Dwayne). Rosa has guardian authority, not a parent flag; Priya’s Nora/Malik scopes remain
separate. Missing confirmer/link/location details are explicit; busy reasons are stripped.
Screenshots and reproducible browser proof: web/evidence/task-cal/ (Rosa desktop/mobile,
DST week desktop/day mobile, Thanksgiving desktop). Corrected a genuine mobile navigation
overflow found during the browser check; no test assertions were weakened.

QUEUE ALONGSIDE W4: calendar live integration after Bentley’s v2 migrations/read operations.
Need authenticated event/category/status reads, weekly/holiday precedence and inclusive-date
wire confirmation, busy-only projections, guardian/schedule grants and readable linked-record/
confirmation metadata. Repeat exploration, persona boundaries, day/DST/holiday cases against
real services. Mock completion does not establish live authorization or backend correctness.
Source classification: fixture facts are unavailable as live data, view segmentation/care bands
are derived; no Task CAL surface is represented as live. No merge/tag/release performed.

Final staged secret guard: `npm run check` PASS, 281 files scanned, **0 findings**.
Diff scope reviewed: web/ plus companion docs only. Task CAL is ready for review on mocks;
UI complete · backend unavailable (Bentley) · mock integrated + tested / live NOT DONE.

Published: draft PR **#21**, https://github.com/Pettybytes/fridgegraph/pull/21.
Implementation commit 9b94808; GitHub reports MERGEABLE. Not merged; live integration still
NOT DONE. Inclusive mock dates confirmed by Bryan in-session.

PR #21 pre-merge presentation revision: US 12-hour times without routine zone suffixes;
EDT/EST retained on DST days and both endpoints of clock-change-spanning records. Removed
the duplicate Rosina eyebrow; footer now reads “Planning and decisions powered by Meta's
Muse Spark”, with no specific model name. Mobile launcher has a safe-area-aware bottom-right
dock outside the scrollable content viewport, plus list/main bottom padding. New screenshots
and repeatable five-persona proof live in web/evidence/task-cal/revision-1/; original evidence
is preserved. UI/backend/live-integration states remain unchanged.
Revision verification actually run: root typecheck PASS; 117 web tests PASS; production build
PASS (same chunk-size advisory); five Playwright flows PASS including safe dock geometry and
last-card clearance. Staged secret scan PASS: 283 files, zero findings. Revised screenshots
include scrolled mobile calendar content with the launcher clear of cards.
## 11. Hard constraint — authenticated third-party calls (Oct 28, 2026)

**Bentley cannot call authenticated third-party APIs from scripts he writes; Bryan or another agent
runs those calls.**

The redaction layer rewrites secret-shaped text when Bentley writes a file: a header template that
interpolates a variable lands as a placeholder on save. The script therefore looks correct in the
transcript and is already damaged on disk before it runs, so a 401 from such a script is **not**
evidence about the credential.

Observed directly on Oct 28: the same credential, read from the same `.env` with the same
fingerprint, returned 200 from Bryan's terminal and 401 from a Bentley-authored script. Bryan then
created the six `fg_` fields successfully from his own terminal while Bentley's calls failed.

Consequences for this repo:

- Never treat a Bentley-authored authenticated call as a test of a credential or of an API's state.
- Any step needing an authenticated GHL or n8n call belongs to Bryan. The exact commands live in
  `docs/ops/level-b-plan.md`; they read the secret from `.env` at runtime and never embed it.
- Bentley still owns everything that needs no third-party auth: schema, migrations, GraphQL, local
  HTTP endpoints, harnesses, `rover`, and git.

## Task B progress — Level B live (2026-10-29)

**Resume rule:** skip every step marked DONE and continue at the first step not DONE. Each DONE row
records what was observed, not what was intended. This section is rewritten in place, not appended
to.

| # | Step | State | Observed |
|---|---|---|---|
| 0 | Worktree `../fridgegraph-level-b` + symlinks | **DONE** | branch `feat/level-b-drafts` @ `9256178`; `.env`, `data`, `.demo-credentials` linked from the primary checkout |
| 1 | Rebase onto `origin/main`, `push --force-with-lease` | **DONE** | rebased onto `1a576a7` (PR #14 squash-merged); `0019_transport_policy.sql` and `0020_transport_reply_cost.sql` both present in the branch; force-pushed with lease to `0630d08` |
| 2 | `node ops/voice-turn-check.mjs` → 12/12 | **DONE** | **12/12 passed** against the local server on `127.0.0.1:4118`; bad secret 401, stale timestamp 401, ESCALATE/END_CALL no state change, no confirmation, job never approved |
| 3 | Preflight: 6-arg `accept_pickup_webhook` has no `estimate_ride_cost_usd` and no `OVER_POLICY` | **DONE** | 6-arg variant found; `estimate_ride_cost_usd` absent; `OVER_POLICY` absent; dedupe `EVENT_ID_CONFLICT` intact — 0020 is live |
| 4 | GHL custom fields: report which of the six `fg_` exist, create only missing | PENDING | |
| 5 | GHL: Rosina recording / transcription / retention (read-only) | **DONE (partial)** | Rosina id `6940d34eed6cdd7ea7a2b746`, location `GNhV1Oyh…`. `GET /voice-ai/agents?locationId=` returns 10 agents but exposes **no** recording/transcription/retention keys; `GET /voice-ai/agents/{id}` returns **403**. Settings not exposed by API → listed **for Bryan**. |
| 6 | n8n: credentials, three workflows, states | **DONE** | Variables unavailable (403 `feat:variables`), so Option B: credential `FridgeGraph Voice Turn` `MPoum0tgq94XPGvy` (X-FridgeGraph-Webhook-Secret), `FridgeGraph GHL` `JCYLvOgzK247D3tt` (Authorization: Bearer). Workflows created — Voice Turn `xOfmO6T4mKbYnjqb` (5 nodes, inactive), Dispatch `A2vnWF2L58Lvquqg` (6 nodes, inactive, both GHL send nodes disabled, credential attached), Reply and Timeout `addWpgFfxXmq7GF1` (8 nodes, inactive; HMAC secret is the open item for Session 2b, never pasted into a Code node). No `$vars` remains in any workflow file. |
| 7 | Stack + named tunnel, //voice-turn only, outside proof | **DONE** | **7a** stack 4001-4007, router 4010, voice-turn 4118. **7b** from outside on `https://fridgegraph.loomz.stream`: `GET /` → 404, `POST /elsewhere` → 404, `POST /voice-turn` no timestamp → **401** `{"error":"UNAUTHORIZED"}`. **7c** Voice Turn `xOfmO6T4mKbYnjqb` URL set to `https://fridgegraph.loomz.stream/voice-turn`, **active=true**. **7d** POST to the n8n webhook with attempt `att_7e691d1f…` + CONTINUE → **200** `status=CONTINUE, note=no_state_change`, say line returned, candidate row byte-identical before/after. Fix required en route: the HTTP node needed `authentication=genericCredentialType` + `genericAuthType=httpHeaderAuth`, without which n8n silently omits the secret header (401). |
| 8 | Rosina Custom Action spec for Bryan | **DONE** | `docs/ghl/rosina-custom-action.md` rewritten for GHL → n8n → tunnel: POST `https://fns2.app.n8n.cloud/webhook/fridgegraph-voice-turn`, `application/json`, no headers, 10 s timeout, retry off, `attemptId` from `{{contact.fg_attempt_id}}`, decision enum CONTINUE/ACCEPTED/DECLINED/ESCALATE/END_CALL, declineReason BUSY/NO_TRANSPORT/OTHER, Rosina speaks `say`. Nothing attached via API. |
| 9 | Rehearsal prep | **PREPARED — ready for Web Call** | job `job_465b22fd27864c21b19b8f7fce1c54d9` (discovering), attempt `att_014c5d0aa80676ec32d62a1f`, contact `AxdxEKypElfgvw3Aagfd` "Loretta Brooks (demo)" created with no phone; `fg_attempt_id` written and re-read from GHL as matching. Verification and evidence 29 await Bryan's call. |
| 10 | HARD STOP before the real call | **HOLDING** | Nothing enabled: no RealCallAuthorization, `REAL_CALL_EXCEPTION_ENABLED` unset, Dispatch inactive, both GHL send nodes disabled. |

### Step 1 blocker — resolved

PR #14 squash-merged to `1a576a7`; `origin/main` now carries `0019` and `0020`, matching the shared
database. Rebase applied cleanly with no conflicts.

### Pre-call hardening (2026-10-29, before the Web Call)

| Step | Result |
|---|---|
| 1 | Voice Turn validates `attemptId` from body **or** query: both and different → **400 CONFLICTING_ATTEMPT_ID**; missing or not `^att_[a-f0-9]{24}$` → **400 MALFORMED**. Neither is forwarded. (The first attempt used a multi-output Code node, which n8n rejects — "Code doesn't return items properly"; replaced with a single output plus an IF node, typeVersion 2.2.) |
| 2 | `FG_GHL_ACTION_TOKEN` generated in-process, written to `.env` atomically (length 43, never printed); credential **FridgeGraph GHL Action** `r3SFGMCVCgINZFL7` (header `X-FG-Action-Token`); webhook `authentication: headerAuth`, workflow active. |
| 3 | Fresh job `job_32b3a61e9dca4235a2bee45be0da2544`, status `discovering`, `inside_window: true`, attempt `att_1cb9b493444a016634339280` bound to `p_gma`. |
| 4a | query-only CONTINUE → **200** `status=CONTINUE, note=no_state_change`; candidate row identical; `webhook_events` delta **0**. |
| 4b | missing id → **400 MALFORMED**; conflicting ids → **400 CONFLICTING_ATTEMPT_ID**; no mutation, delta 0. |
| 4c | no token → **403** `Authorization data is wrong!` — n8n's header-auth returns 403, **not 401**. Enforcement holds; the status code differs from the instruction and is reported rather than dressed up. |
| 4d | DECLINED deliberately not tested (it would consume the attempt). |
| 5 | `docs/ghl/rosina-custom-action.md` carries the query parameter, the token header (copy-to-clipboard command, no value), the trigger wording, and the rehearsal literal id with a checklist item to restore `{{contact.fg_attempt_id}}` before Session 3. |

**Re-minted for the Web Call (2026-10-30T02:06Z):** job `job_26b2d6c06d4944c093a306de047f99d7`,
attempt `att_65b34cc9577dcc89d8386a2c`, bound to `p_gma`, status `discovering`, window 60 s (the
column default; `request_pickup` takes no timeout argument and no household policy governs it, so 60 s
is the contract maximum).

## Task D progress — reproducible stack + real call readiness (2026-10-30)

**Resume rule:** skip every step marked DONE; continue at the first step not DONE.
Worktrees: **D0** in `../fridgegraph-alt-stack` (`chore/alt-stack`, PR #16);
**D1-D6** here (`feat/level-b-drafts`, PR #9).

**Bryan's 2026-10-30 updates (all recorded):** the `pickup_decision` query param reads
`{{contact.fg_attempt_id}}` again (**confirmed by Bryan (UI), 16:50 ET**) — the literal rehearsal id
is gone; the FROM number is referred to by its label **“Dreemzy HQ – Main Line”** in committed files
(verified read-only: that label's `inboundCallService.value` is Rosina's agent id), and the pre-flight
**fails until Bryan confirms the dropdown shows it**; the rollback now implements the documented
workflow-removal `DELETE` with `Version: v3` (see D3 row and evidence 32 §4).

| Step | State | Observed |
|---|---|---|
| D0 alt stack as code | **DONE** | `ops/alt-stack.sh` (--up/--check/--down) + `ops/alt-stack-check.mjs`. Router 4012 and MCP 5051 configs are **generated** from `router.yaml`/`supergraph.yaml`/`.apollo/mcp.local.yaml`; the generator refuses a config without `propagate: Authorization` or without rebasing to 4101-4107. Preflight fails loudly on `data/identity-map.json` (the silent-unmapped trap). `--down` kills only pidfile PIDs. **`--check` PROVEN against the running stack without restarting**: router health OK, graphql OK, **mcp candidates 4/4 as Kendra**. **`--up`/`--down` UNTESTED** (proving them needs the live stack stopped). PR #16. |
| D1 migration 0022 | **DONE** | `0022_real_consented_attempts.sql` applied. (a) `open_attempt(..., p_destination_mode)` refuses `REAL_CONSENTED` without a valid, unconsumed, unexpired authorization bound to job+candidate+recipient — it **raises**, never downgrades (§10). (b) `consume_real_call_authorization(attempt, contact)` — one UPDATE bound to attempt+job+candidate+recipient+version; the 0014 4-arg form is dropped. (c) attempts carry the authorization id + consume time; `webhook_events` inherits the mode via before-insert trigger. Authorizations gained `job_id`/`candidate_id`/`contact_ref`; `attempt_id` is now nullable so an authorization can exist before its attempt. **Dry run 21/21** inside a rolled-back transaction: default unchanged, refused-without, allowed-with, consume-once-then-refuse, expiry, recipient/candidate/job mismatches, TEST_RESPONDER cannot consume, event labelling. Applied; re-apply is a no-op and the script now reports that as correct. |
| D2 dispatcher window guard | **DONE** | Verified the call-log read with ONE live call: `GET /voice-ai/dashboard/call-logs` (the `/dashboard/` segment was the missing piece) with `Version: 2021-04-15` → **200**, `callLogs`/`total`/`page`, record keys incl. `contactId`, `createdAt`, `fromNumber`, `agentId`; `total=178`. Note the API rejected `sort=desc` with 422 demanding `ascend|descend` — a useful shape check. Guard implemented in `ops/dispatcher.mjs`: timezone from the **phone number's NANP area code** (documented rule: GHL schedules in the contact's phone-number tz, not the stored contact tz), unknown area code → **fail closed**; 8:00–20:00 local window; cross-agent daily check using local midnight→midnight converted to Unix seconds; unreadable call history → **fail closed**. `--dry` runs all of it for real and prints each result. Live proof against contact `eSAOWhx…`: contact read ok (stored tz America/Detroit), tz ok, window ok at 16:15 local, local day `04:00Z→04:00Z`, **already-called-today ok (0)**. |
| D3 queue-aware rollback | **DONE** | **No documented cancel exists** for a pending/queued Voice AI call: the docs enumerate scheduling and limits (calls over the daily cap are "scheduled for the next eligible day"; users report 1–5 min before a call goes out) and expose no cancel action. Per Bryan's decision the residual risk is accepted and stated in the script header, not papered over. `ops/session3-rollback.mjs` (--dry first) runs **local shutdown first**: Dispatch deactivate + flag check → close attempt + **expire** unused authorizations (never wait for natural expiry) → only then GHL (tag removal via documented `DELETE /contacts/{id}/tags`, enrolment and workflow-publish have **no documented API** → MANUAL, reported FOR BRYAN) → final DB/GHL state print. A GHL failure cannot leave anything live locally. **Acceptance #4: PASS** — reply on a closed attempt returns **200 `END_CALL` / `attempt_closed`** with the say line "Thanks for your time. Goodbye." and **zero** mutation: attempt row, candidate_evaluations, job, confirmations all byte-identical, `webhook_events` delta **0**; the SQL layer still returns `rejected_closed` with delta 0 inside a rolled-back transaction. Implemented by adding a `closed_at` check to `ops/voice-turn-server.mjs` (200, not 409, so an idempotent replay stays 200); voice-turn-check still **15/15**. Rollback `--dry` proven end-to-end. |
| D4 FG - Dial Rosina draft check | **DONE — exists in DRAFT** | Re-checked after Bryan built it: `FG - Dial Rosina` `6f2b386e-60ed-4848-959b-ed97f1307d92` **state=draft** (73 workflows now). `FG-SMS-Reply` and `FG - No Answer` remain published. Correct state for Session 3: it must stay unpublished until the runbook says otherwise. |
| D5 runbook update | **DONE** | `docs/ops/session-3-runbook.md` rewritten with every pre-flight item carrying its **observed** result: stack 400/400/404 (all answering), tunnel **401**, Voice Turn + Reply and Timeout **active**, Dispatch **inactive**, `FG - Dial Rosina` **draft**, **0022 live verified by query** (`open_attempt` 5 args, `consume_real_call_authorization` 2 args, 4-arg form gone), D2 guard dry run incl. `total`-based cross-agent coverage, Rosina's number confirmed from `voice-ai/agents` and labelled **“Dreemzy HQ – Main Line”**. Two items are **human confirmations, not API checks**, and are labelled as such: the `{{contact.fg_attempt_id}}` action param (agent detail 403s) and the dial action's FROM dropdown (`/workflows/{id}` 404s) — the runbook states the pre-flight FAILS until the FROM dropdown shows that label. Order: pre-flight → 60-second notice → mint/authorize/consume/flag/Dispatch/publish/tag → dial → rollback. |
| D7 real call (Session 3, Bryan's GO) | **BLOCKED at pre-flight — no dial** | Attempted 2026-10-30 17:03–17:05 ET. All platform checks passed (stack 400×7, router 400, voice-turn 404, tunnel 401, Voice Turn + Reply active, Dispatch inactive, `FG - Dial Rosina` **draft**, 0022 5-arg/2-arg, 0 open attempts, 0 authorizations). **Stopped by pre-flight #10:** the "Loretta Brooks (demo)" contact `AxdxEKypElfgvw3Aagfd` has **no phone number**, so `node ops/dispatcher.mjs --dry` returns `[REFUSED] phone number: contact has no phone number — cannot place a call` / `CALL_REFUSED_BY_WINDOW_GUARD`. Nothing was armed: no job, no authorization, no attempt, no `fg_` writes, flag unset, Dispatch inactive, no publish, no tag, no dial. The contact also still carries the stale rehearsal `fg_attempt_id` (`att_014c5d0aa…`), which Dispatch would overwrite before the tag — noted, not a blocker. **Unblock:** add the recipient phone to that contact in GHL and re-run pre-flight, or authorise binding the call to the existing contact that has a phone. |
| D6 runbook dry run + evidence 32 | **DONE** | `node ops/d6-dry-run.mjs` → exit 0, **38 PASS / 0 FAIL / 3 HUMAN**. Every pre-flight item observed this session (stack 400×7, router 400, voice-turn 404, tunnel 401, Voice Turn + Reply active, Dispatch inactive, Dial draft, 0022 5-arg/2-arg with no 4-arg form, guard ok at 16:55 local, `already called today` = none across all agents, 5/5 `fg_` fields, FROM label matched to Rosina's agent id). DB steps real on a TEST_RESPONDER attempt: `request_pickup` job `job_3fcfbcf5…`, attempt `att_a63ecf46…`; reply `"no car"` through the deployed chain → HTTP 200 DECLINED, `available=false`, `decline_reason=NO_TRANSPORT`, `reason_code=AVAILABLE_NO_TRANSPORT`, attempt closed `ANSWERED_NO`. Authorization lifecycle **inside a rolled-back transaction only**: open REAL_CONSENTED `att_2230ebb4…`, consume once **true**, second **false**, no-authorization attempt **raised**, and after ROLLBACK jobs 50→50, authorizations 0→0, tx attempts 0. Dispatcher + rollback both `--dry`, the rollback run twice (open branch then closed branch); GHL reads real, nothing sent. The five external actions printed as `WOULD DO` with exact requests. After-state: Dispatch inactive, flag unset, Draft, **0 of 2684 contacts** carry `fg-dial` across 28 pages, **0** authorizations, **0** open attempts (3 untouched discovery attempts closed `D6_CLEANUP`, recorded). Evidence `32-session-3-dry-run.md`. **Untouched by design:** voice behaviour (one opener; “no car” → DECLINED/NO_TRANSPORT) still UNVERIFIED, and the FROM dropdown still needs Bryan's eye. Two tooling defects fixed: the dispatcher `--dry` CLI treated the documented `[attemptId]` as the channel, and the rollback dry run reported deliberately-skipped steps as FAIL. |

### D1 design note worth not re-litigating

`real_call_authorizations.attempt_id` had to become nullable. An authorization must be issuable
**before** its attempt exists; with a NOT NULL attempt_id the only way to get one would be to create
the attempt first as TEST_RESPONDER and then flip it — precisely the silent downgrade §10 forbids.
The binding is therefore job + candidate + contact_ref at issue time, and the attempt id is attached
atomically when the attempt is created.

---

## Task C progress — Level B finish + Muse on Meta (2026-10-30)

**Resume rule:** skip every step marked DONE; continue at the first step not DONE.

| Phase | Step | State | Observed |
|---|---|---|---|
| A | A2 corrections to evidence 29 | **DONE** | Appended as checkpoint §6, no rewrite: timing corrected to **2.749 s** (not minutes, not 3.6 s) and relabelled *consistent only*; the real proof is the deployed 6-arg function — `estimate_ride_cost_usd` 0 occurrences, `OVER_POLICY` 0, `v_cost` never assigned, so replies write null. Two defects separated: multi-output Code node (14787-14789, fixed) vs **CONTINUE in Rosina's enums → opener repeated → VERIFICATION PENDING**. Third finding: ACCEPTED sent for "I can help but I don't have a car"; description tightened; noted in rosina-custom-action.md. |
| A | A1 evidence 29 | **DONE** | `docs/evidence/29-level-b-rehearsal.md`. Attempt `att_65b34cc9…`: one `ACCEPTED` event, `accepted_via=WEBHOOK_CALLBACK`, and `cost_calculated_at=02:10:40.640Z` — three minutes after the call's executions (02:09:40–02:10:37), proving the reply did not cost her. Ranking then set `OVER_POLICY` / **12.40** / labelled basis, job `awaiting_approval` v3, `over_limit_candidate_id=p_gma`, never `APPROVAL_PENDING`, `confirmations` = 0. Executions 14787-14789 are the multi-output Code-node failure; fixed with an IF node. Headers not dumped. |
| B | B1 D2 open-attempt constraint (forward migration + dry run) | **DONE** | `0021_one_open_attempt.sql` applied. Dry run 20/20 PASS (hash restored `59354d9…`). Applied proof: backfill closed 4 job-inactive + 12 superseded, leaving exactly 1 open attempt per contact; a real 2-connection race for one contact returned `opened:att_fe26786d…` / `refused:att_fe26786d…` — exactly one opened; close → next legitimate attempt opened (`att_ac7b56b0…`); event naming the closed attempt returned `rejected_closed` with attempt row unchanged, `webhook_events` delta 0, `candidate_evaluations` delta 0. Enforcement is the partial unique index `attempts_one_open_per_contact (candidate_id) where closed_at is null`. D4 shipped as `webhook_events.source='no_answer'` + `record_no_answer()`, which writes nothing to `candidate_evaluations`. **D2 correlation remains unproven and is recorded as such.** Evidence 30 §B1. |
| B | B2 rewrite Reply and Timeout per D1/D3/D4, activate | **DONE** | `docs/n8n/fridgegraph-reply-timeout.workflow.json` regenerated by `ops/build-reply-timeout-workflow.mjs` from `ops/reply-parser.mjs`; PUT to n8n `addWpgFfxXmq7GF1` and **ACTIVE**. 12 nodes: `GHL Reply`/`GHL No Answer` (headerAuth credential `FridgeGraph GHL Action` `r3SFGMCVCgINZFL7`), `Decide Reply`/`Decide No Answer` (D3 parser embedded verbatim), `Forward?`/`Forward No Answer?`, `Call Voice Turn`/`Call Voice Turn (no answer)` (credential `FridgeGraph Voice Turn` `MPoum0tgq94XPGvy` → `https://fridgegraph.loomz.stream/voice-turn`, fresh `X-FridgeGraph-Timestamp`), 4 responders returning `{status, note}`. `UNSET_SESSION_2B` and both `Sign *` HMAC nodes are gone (verified in the deployed object, not just the file). Parser: 26/26 unit tests incl. a parity check that the deployed Code node still contains the tested source. No-answer is forwarded as `NO_ANSWER`; the voice-turn server now maps it to `record_no_answer()`. voice-turn-check 12/12. Evidence 30 §B1 addendum. |
| B | B3 verify FG-SMS-Reply and FG - No Answer, write docs/ghl/ghl-workflows.md | **DONE** | Both exist and are **published** (v3) in `GNhV1OyhFLzcl67XwTBV`: `FG-SMS-Reply` `9908591b-f035-40ce-bae7-6a1ed94de32a`, `FG - No Answer` `f85688b4-af4f-485a-86b1-0f0c49c6edd7`. `GET /workflows/{id}` 404s for this token, so the **trigger graph is not readable** and is recorded as unproven, not assumed. Wire check (`ops/reply-chain-check.mjs`) against a closed attempt: both payloads accepted 200 and refused at the D2 gate, extra correlation field tolerated, missing token 403, bad id 400, zero deltas. **Caught a real defect:** n8n's Webhook node nests the payload under `body`, so v1 answered `attemptId required` to every request (execution 14807) — fixed by unwrapping `$json.body`, re-deployed, re-proven. D2 correlation: neither trigger documents a message id or call id as a workflow variable, so stale-event protection is **still not proven**; doc gives the one UI check and the exact body to paste if `message.id` exists. No-answer trigger spec: Call Details + Outgoing + Call Status no-answer, with the change written out. |
| B | B4 eight-case proof + parser unit test, evidence 30 | **DONE** | `ops/b4-proof.mjs` — **62/62 checks, exit 0**. All nine cases plus the late reply, each on a fresh job/attempt with before/after rows: a) `"Yes, I can!"` → ACCEPTED, `WEBHOOK_CALLBACK`, cost null, attempt `ANSWERED_YES`; b) curly apostrophe → `AVAILABLE_NO_TRANSPORT`/`NO_TRANSPORT`; c) a caregiver **with** a vehicle → same, and **0** `RECOMMENDED`/`APPROVAL_PENDING` rows; d/e) UNPARSED with evaluation byte-identical and 0 events; f) no-answer → `source=no_answer`, `outcome=NO_ANSWER`, evaluation untouched; g) closed attempt → `rejected_closed`, row unchanged, delta 0; h) second attempt refused naming the open one; i) 403 missing token, 400 bad id, no delta. **Separation proven both ways:** reply writes null cost (a, a3), driver branch recommends **uncosted** (correct per 0019), no-driver branch alone writes **12.40** + `OVER_POLICY` + `over_limit_candidate_id` (a3). Late reply (j): accepted after the window passed — only `confirmed`/`failed`/version/closed-attempt gate it, never the window. Parser 26/26 incl. deployed-source parity. |
| B | B5 D5 real names in say lines, voice-turn-check 12/12 + new cases | **DONE** | `ops/voice-turn-server.mjs` resolves both names **server-side from the attempt**: child from `coordination_jobs.child_id` → `people.display_name`; requester from the parent scheduled for `as_of` (same rule as `_is_approver_for`) and **only when exactly one parent matches**, else `the family`. Opener carries both; ACCEPTED carries child + requester; FAILED carries requester. **voice-turn-check 15/15** (12 original intact + opener names + closing names + fallback via `as_of = null`). Re-proven **through n8n** by reading `say` out of execution `14811`-class data: "…available for Nora's pickup. Kendra still needs to approve…" — no placeholder. Only the 4118 server was restarted. Found again that an abandoned job holds all four contacts' slots, so the new script now cleans up after itself. Evidence 30 §B5. |
| M | M1 verify api.meta.ai/v1 + muse model, stop on mismatch | **BLOCKED (docs OK, key rejected)** | Both values **confirmed** against dev.meta.ai: base `https://api.meta.ai/v1` from the official Chat Completions example; `muse-spark-1.3` from the Muse Models page, where it is also the docs default. `muse-spark-1.3-contributor` is a different data mode and was not used. `META_BASE_URL` + `META_MODEL_ID` written via `ops/set-env-secret.sh`. **Access fails:** `GET /models` and a 1-token completion both return **401 invalid_api_key**. Key is present, 136 chars, `LLM...`, not a placeholder, contains a non-`[A-Za-z0-9_-]` char. Bryan must re-copy from Model API -> API keys, then `ops/set-env-secret.sh META_API_KEY` and `node ops/meta-probe.mjs`. |
| M | M2 meta provider on the PickupCandidates test, evidence 31, draft PR | **PARTIAL - shape verified, run blocked by M1** | `src/muse/providers.ts` confirmed correct: `POST ${baseUrl}/chat/completions`, Bearer auth, `tools` + `tool_choice: auto`, `temperature: 0` - the documented OpenAI-compatible shape, nothing invented. Branch lacks nothing that is only on unmerged #9. **The provider was NOT run**, so there is **no grounding score, no latency, no tool-call count**; the 4/4 target is unmet and not estimated. Evidence 31 written; **draft PR #15** opened. |
| C | C1 supported Voice AI outbound dial path spec | **DONE** | `docs/ops/session-3-dial-path.md`. Cited GHL article 155000006598: the **Voice AI Outbound Call workflow action** is the only supported way - calls must be placed through a workflow using that action - and there is **no public dialing endpoint** (the Voice AI Public APIs cover call logs, agents, actions). Chain: n8n Dispatch -> fg_ fields -> tag -> `FG - Dial Rosina` (tag trigger) -> Voice AI Outbound Call. Workflow left **unpublished**; Dispatch **INACTIVE**; dial node **DISABLED**. Also records the limits that constrain the test: 8am-8pm contact tz, **one call per number per day**, 14/14 days. |
| C | C2 dispatcher inventory / minimal dispatcher | **DONE** | Inventory: **nothing** calls Dispatch when an attempt is created - only the workflow JSON and docs reference `/webhook/fridgegraph-dispatch`; `request_pickup` creates job+attempts in Postgres and posts nowhere. `ops/dispatcher.mjs` added: posts `{attemptId, contactId, channel}` with `X-FG-Dispatch-Token` from `FG_DISPATCH_TOKEN`. **Not run, not wired**; only `--dry` was executed (prints the shape, sends nothing). |
| C | C3 docs/ops/session-3-runbook.md | **DONE** | One page in the required order: pre-flight table (stack, tunnel **401 not 404**, all six workflow states, `{{contact.fg_attempt_id}}`, contact fields) -> the **60-second notice to Bryan first** (verbatim) -> mint job + RealCallAuthorization, flag, dial node, Dispatch, publish -> dial with a 4-step watch list -> the job-state acceptance table quoted from B4 -> rollback (everything off, authorization consumed/expired, no open attempt left). |

### Note for the next session

Phase A and B1/B2 are complete and pushed. The local stack (4001-4007), router (4010) and voice-turn
(4118) are running; Voice Turn `xOfmO6T4mKbYnjqb` and Reply and Timeout `addWpgFfxXmq7GF1` are both
**active**. Hard stops all held: Dispatch inactive, both GHL send nodes disabled, no
RealCallAuthorization, `REAL_CALL_EXCEPTION_ENABLED` unset.

**Found and fixed during B1:** the first apply of 0021 made `voice-turn-check` drop to 6/12, because a
job stuck in `discovering` held its contact's only open slot forever. `_expire_stale_attempts()`
closes attempts whose job's discovery window has passed; re-proven 12/12.

## Task V2-VILLAGE progress

BRANCH: feat/web-village-v2; WORKTREE: ../fridgegraph-web-village-v2.
BASE: fetched origin/main ad720de6bcc0f2971f200f4db519b8934b4f6e78.
TASK: six-family mock Living Village, scoped directory exploration and new-family demo personas.
LAYER: web + companion docs. TOUCHED: village/v2, App, persona mocks/tests, evidence and handoff.
DONE WHEN: typecheck, staged secret scan, web tests/build and desktop/mobile Playwright proof.
NOT DOING: schema/auth/database/server changes, live seed claims, merges/tags/releases.
UI: in progress · backend: unavailable pending Bentley v2 seed/reads · integrated: not yet tested.
Mock scoping is a projection boundary, never live browser authorization. Private foreign nodes
are omitted entirely, with no greyed-out names. Calendar/W4 live integration remains queued.

Task V2-VILLAGE mock implementation: six networks, ten family children, plus Zion as a
Tigers directory entry. Cast v2 relationships and authority are independent fixture fields.
Felicia's projected view intentionally omits Imani/the third household; only Skye's existence
is shared. Priya's separate child contexts omit the wider household and other helpers. Team
roster names are directory-only; teacher/bus joins contain only the selected child. No hidden
foreign names are returned as disabled nodes. New picker entries Felicia/Simone join existing
Rosa/Dwayne; all six households now have mock entry points. Sources remain unavailable as live
data; layout/projection is derived. Contract: docs/contracts/village-v2.md.

| Surface | UI | Backend (Bentley) | Integrated + tested |
|---|---|---|---|
| Living Village v2 | complete on mocks | pending v2 seed/scoped reads | mock tested; live NOT DONE |
| Six-network persona entry | complete on mocks | real demo login pending | mock tested; live NOT DONE |

Verification actually run: root typecheck PASS; **133 web tests PASS** (117 baseline + 16
new); production build PASS, existing chunk-size advisory. **Seven Playwright flows PASS**
across Kendra/Priya/Dana/Rosa/Felicia/Simone/Dwayne. Desktop/mobile screenshots and reproducible
proof: web/evidence/village-v2/. Source scope tests include unknown/foreign IDs, roster-only
traversal, guardian approval, no stepfather inference and no Nora care answer in Malik context.
Initial build caught three type errors, corrected without weakening assertions. Initial UI
harness retained a stale switching-picker element; re-query now verifies the ready picker.
Legacy lazy-load entry boundary preserved, with all existing tests retained.

QUEUE ALONGSIDE W4: integrate Bentley's v2 seed and scoped graph reads, verify guardian and
per-child grant rights upstream, directory/teacher/bus visibility and recorded authority.
Repeat independent exploration against actual services; mock tests do not prove live RLS or
seed correctness. No schema/auth/database/server changes. Never merged/tagged/released.
Final staged secret guard PASS: 292 files scanned, zero findings. Diff reviewed: web/ and
companion contracts/handoff only. UI complete · backend pending · mock integrated/tested,
live NOT DONE. No credentials needed or accessed.
Published draft PR **#22**: https://github.com/Pettybytes/fridgegraph/pull/22.
Implementation c582c1f; GitHub reported MERGEABLE. Not merged. Live integration remains NOT DONE.

### PR #22 follow-ups — anonymous scale and Demo guide

Same feat/web-village-v2 branch/worktree. Source classification remains mock/unavailable;
counts, graph layout and connections are derived from recorded fictional memberships.
Tigers: 4 children (family total unavailable because Zion's family is unspecified); Room 12:
4 students (the prompt's 5 was an example, not a recorded fixture fact); Route 14: 3 children
from 3 networks. Normal roster projections now include only identities in the viewer's child
scope. Rosa gets class scale but no foreign child names. This supersedes the earlier broader
team-directory name projection; original evidence is retained as historical, not current proof.
Tomás's village person record now uses Tomás Castellano, matching the calendar source.

Demo guide has a separate picker card with the exact fictional-ecosystem disclaimer, a read-only
mock overview of six family clusters, shared team/class/bus/sitter/helper edges and family
village drilldowns. Sandbox banner retained. No parent/guardian authority is assigned to the
guide persona itself; selecting it is not a real authentication mechanism.

**Task E requirement:** deliver a server-enforced, sandbox-only, read-only Demo guide scope,
with scoped discovery/session claims and no data-changing catalog actions. Also deliver
permission-safe aggregate counts separately from name/identity reads. No browser ID, relationship
label, or client-filtered result may grant broad live access. Exact wire fields await delivery.

### W4 readiness audit — after PR #22 follow-ups

Fetched origin/main remains ad720de. Checked this HANDOFF plus the read-only handoffs in
fridgegraph-level-b and fridgegraph-rosina-service. Task E progress in level-b reports Groups
0/E-2/E-1 and 1/E0 complete on unmerged work; Groups 2–5 not started. E0 adds no Rosina tools.
Rosina service checkout contains uncommitted implementation work but no “Rosina tools available”
readiness entry. That work is not a delivered frontend integration contract. No credentials read,
no database actions or services started, no speculative endpoint/auth fields implemented.

| W4 service/surface | UI | Backend readiness observed | Integrated + tested |
|---|---|---|---|
| Demo login/reset/create family | mock complete | no delivered Task E API/session contract | mock only; live NOT DONE |
| POST /api/rosina | mock complete | service WIP; readiness marker absent | live NOT DONE |
| jobTimeline / Attempt.candidate | derived feed / unknown channel | no delivered reads in main | live NOT DONE |
| v2 event/busy/care/holiday reads | mock calendar complete | Task E Groups 2–5 not started | live NOT DONE |
| Guide scope + aggregate scale | mock complete | Task E requirement above | live NOT DONE |

W4 starts per delivered service in its own branch/worktree after readiness is recorded. Required
live acceptance: Kendra/Rosa/Priya/Dana/guide compare Village, Calendar, Mission Control and one
Rosina answer per surface; test synchronous persona cleanup; 3 unscripted questions + 2 followups
per persona, denied and ambiguous requests, created-family query/Rosina visibility then reset
absence; one Playwright E2E per persona. Record every model error verbatim and cross-surface
mismatch. None of these live runs has happened; no live model mistakes or consistency results
can honestly be reported yet. Mock success does not satisfy W4 and is never marked DONE.
Source gaps retained honestly: Vance–Reyes has no recorded team/class/bus/sitter connection in
the current Cast v2 slice, so the guide shows its cluster with “No shared connections recorded”
instead of manufacturing a cross-family edge. Task E can supply such an edge when seeded.
Zion's family mapping is likewise needed before Tigers can show a total family count.

Follow-up verification actually run: **137 web tests PASS**; root typecheck PASS; production
build PASS (existing chunk-size advisory); three refreshed Playwright flows PASS for Kendra,
Rosa and Demo guide, including counts, forbidden identities, source full name, guide drilldown,
mobile overflow and persona-switch isolation. Guide viewport cropping found by screenshot
inspection was corrected; both family rows and all recorded shared edges now fit the diagram.
Screenshots/proof: web/evidence/village-v2/follow-ups/ (desktop/mobile for all three personas).

| Follow-up surface | UI | Backend (Bentley/Claude Code) | Integrated + tested |
|---|---|---|---|
| Anonymous connection scale | complete on mocks | aggregate read contract pending | mock tested; live NOT DONE |
| Demo guide | complete on mocks | Task E sandbox scope pending | mock tested; live NOT DONE |
| W4 cross-surface consistency | acceptance queued | required service deliveries pending | NOT RUN; NOT DONE |

Final readiness recheck: origin/main is `f71a5ed` (Village v2 #22 merged); this branch (#9) carries the
backend and #23 is E0 mint-path work stacked on it — not the required v2/auth/Rosina reads. Rosina readiness marker still absent. W4 cannot start on
these undelivered services; do not label a mock-backed end-to-end run as live evidence.
Follow-up staged secret scan PASS: 295 files, zero findings. Diff remains web + companion docs.

## Task MC — demo-ready Mission Control

BRANCH feat/web-mission-control-v2; WORKTREE ../fridgegraph-web-mission-control-v2.
BASE origin/main f71a5edb5bdcc33a129bf04f342cc9da953a5854 (#22 squash already merged when
Bryan's command was attempted; verified MERGED on GitHub, main pulled fast-forward only).
LAYER web + companion docs. TOUCHED mission-control/v2, App entry, persona boundary copy,
frontend-data §1.4 clarification, handoff, evidence. Never merge this task's PR.
UI in progress · backend awaiting W4 reads · integrated not yet tested.
No invented ringing/policy timestamps: current mock sources contain no such individual records.
No-driver night has no timed lifecycle; show its supplied state without synthetic timestamps.
No live auth/schema/DB/server or pricing logic changes. Approval is a local recorded replay;
no contacts, provider booking, payment or real approval write.

Task MC implemented: source-backed normal replay with Play/Pause/Next/Restart and four
parallel candidate lanes. Original Detroit event times include seconds; presentation pacing
is explicitly condensed. Individual replies become visible only when their recorded evaluation
is reached. Monique's no-answer timeout is a system observation, never Bryan's explicit decline.
Candidate detail pauses replay. Replay stops at parent review and never auto-approves.
Tasha's explanation joins authorized pickup-candidate, human availability, recorded transport
and straight-line distance facts. Kendra is the recorded Wednesday approver; Andre is read-only.
Other personas receive their own role-aware boundary or no-job state, not Nora's private data.

No-driver night is its own supplied over-limit scenario: only Loretta's recorded willing/no-car
option, $12.40 estimate and exact basis. No imported normal-night candidate outcomes. The source
has no attempt metadata, event times or confirmation time for that path; current state and
explicit acceptance remain visible with those gaps stated. Separate app confirmation and
checkbox are mandatory; no contacts, provider actions, spending or live approval writes occur.
Normal parent approval replays the existing 2026-10-28T15:14:00Z evidence, not the current clock.

Contract drift fixed in frontend-data §1.4: TEST_RESPONDER now reads “Test responder”, distinct
from explicitly “Simulated” activity and “Real call (consented)”. No new backend enum invented.
Normal mock attempts all have the recorded Test responder state; real-consented badge coverage
is a component test, never a claim that such a call occurred in this job. Missing mode is
unavailable. Confirmation mode derives from its candidate's attempt, not a global demo flag.

| Surface | UI | Backend (Bentley) | Integrated + tested |
|---|---|---|---|
| Mission Control v2 | complete on mocks | timeline/candidate/mode reads await W4 | mock tested; live NOT DONE |
| No-driver review | complete on supplied mock path | actual approval/readback integration pending | mock tested; live NOT DONE |

Observed verification: root typecheck PASS; **150 web tests PASS** (137 baseline + 13 new);
production build PASS (existing chunk-size advisory). **Four Playwright flows PASS**: desktop
full job and over-limit confirm; mobile full replay and no-driver sheet; Priya sharing boundary;
Andre read-only review. Screenshots/proof: web/evidence/mission-control-v2/ (request, outreach,
recommendation, approval and no-driver decision/confirm, desktop + mobile). Legacy component,
adapter, pricing-policy and persona tests retained. Initial unused import and modal-hidden
selector failures corrected; useful candidate-detail selection restored without relaxing the
existing persona-isolation assertion. Detail: docs/contracts/mission-control-v2.md.

W4 needs delivered authenticated approver rights, jobTimeline, Attempt.candidate/destinationMode,
timeout-vs-decline evidence and approval readback. Ringing/receipt/policy-check events can appear
only when actually recorded. Live integration stays queued; no Task MC step is marked DONE.
Diff reviewed: web + companion docs only. Never merged/tagged/released this task's branch.
Final staged secret scan PASS: 303 files, zero findings. Mock evidence only; no live service
acceptance claimed. Task MC remains UI complete · backend pending · mock integrated/tested.
Published draft PR **#25**: https://github.com/Pettybytes/fridgegraph/pull/25.
Implementation 0236ad0; GitHub reports MERGEABLE. Task MC not merged; live integration NOT DONE.

**Bridging note (Task R-FIX, 2026-10-30, second sync):** Task MC (#25) and Task R/Task R-FIX (#24) both appended at this same point in the file; both are kept below in full, nothing rewritten. Task MC's own W4 needs and Task R's "Rosina tools available" table are independent — Task MC needs jobTimeline/Attempt.candidate/destinationMode reads, Task R needs CoordinationJobs/CandidateEvaluations, CarePlan, village-directory and events/practices reads; neither list supersedes the other.
**Bridging note (Task R-FIX, 2026-10-30):** the W4 readiness audit above (just before this point) found the Rosina service checkout had "uncommitted implementation work but no 'Rosina tools available' readiness entry." That gap is closed below — see "Reserved evidence numbers" and "Task R — live Ask Rosina service" for the readiness table, and "Task R-FIX" for the PR #16 alt-stack reconciliation this merge performs. The W4 table's "POST /api/rosina ... readiness marker absent" row is stale as of this commit; W4 should re-check PR #24 directly rather than trust that row going forward.

## Reserved evidence numbers

Evidence files are append-only and numbered by whoever claims the number first — collisions
happen when two tasks file in parallel without checking both `docs/evidence/` AND open PRs.
Current reservations (always check both before taking the next number):

| # | Owner | File |
|---|---|---|
| 34 | Bentley, E0 | `docs/evidence/34-e0-real-call-mint.md` (PR #23) |
| 35 | Claude Code, Task R | `docs/evidence/35-rosina-service.md` (this PR) |
| 36 | next free (Task H, public hosting, at the time of writing) | — |

Evidence 34/35 collided once (Task R originally filed as 34; renumbered to 35 in Task R-FIX,
2026-10-30, after Bentley's E0 reservation was reported). The content of 35 is otherwise unchanged
from the original filing — see its own renumber note at the top of the file.

## Task R — live Ask Rosina service (2026-10-30)

Full writeup, tool table, and real per-persona transcripts: `docs/evidence/35-rosina-service.md`.
Summary here is for the next agent picking this up; read the evidence file before trusting a
number from this summary.

**Shipped:** `POST /api/rosina` (`src/rosina/server.ts`, `npm run rosina`, port 4200 default).
Muse Spark 1.3 via the Meta Model API, calling MCP as the signed-in caller (bearer forwarded
unchanged, never a service key). Two kinds of tool only: the real MCP read (`PickupCandidates`,
hard-allowlisted by name in `src/rosina/model.ts` regardless of what MCP's config exposes) and
local `proposeAction_*` tools that populate the response's `actions` array and do nothing else —
no mutation tool exists to call, by construction, not by promise. Catalog validated against
`src/rosina/catalog.ts`, a mirror of `web/src/features/rosina/catalog.ts` with a drift check
(`npm run check:rosina-catalog`) that fails the build if the two disagree on ids/flags — see the
evidence file §1 for the one thing that check does NOT prove (byte-identical argsSchema parsing).
Rate limit (20/min default, by resolved person id), graceful timeout (30s default →
`{"reply":"I couldn't check that just now.","actions":[]}`, HTTP 200, not an error page), no
history/token/content persistence or logging. `web/vite.config.ts` proxies `/api/rosina` →
4200 (one line; no other `web/` file touched). `ops/alt-stack.sh` added for the offline test
stack (4101-4107/4012/5051); this run reused an already-live instance of that same stack found
running from the `../fridgegraph-meta` worktree rather than killing it to start a second one —
see evidence §4 for why that was the safer call.

**DONE WHEN, actually run:** `npm run typecheck` PASS; `npm run check` PASS (293 files, 0
findings); `npm run check:rosina-catalog` PASS (and verified it actually fails on a real
injected drift, then reverted); `npm --prefix web test` 117 PASS (unchanged — only `web/` touch
is the proxy line). Every scenario test in the evidence file was run against the real alt-stack
MCP (5051) with real Supabase password-grant tokens for Kendra/Priya/Dana, never mocked.

**Rosina tools available today (update this list as Task E ships more):**

| Tool/operation | Status |
|---|---|
| `PickupCandidates` (access subgraph) | **AVAILABLE** — proven 4/4 (evidence 31), wired into the live service |
| `Attempts` / `JobTimeline` (coordination subgraph) | **AVAILABLE** — shipped by `#29` (evidence 40), wired into the allowlist by TASK R-TOOLS-1 (evidence 35 §11): Mission Control's job status, "what happened with this pickup," and the full chronological story are now answerable live |
| `ChildEvents` / `EffectiveSchedule` / `AdultAvailability` (schedule subgraph, Group 3 `#31`) | **AVAILABLE** — wired into the allowlist by TASK R-TOOLS-2 (evidence 35 §12): a child's calendar, who has the child on a date (WEEKLY vs an APPROVED holiday ARRANGEMENT — PROPOSED never changes it), and recorded Busy/Free (never a reason, never "can pick up") are now answerable live. Child/person-id arguments are gated by a new pre-call `permittedIds` check in `src/rosina/model.ts` — never trust a browser route, history, or a model argument; an id must come from the caller's own roster/self or a tool result already returned this turn. |
| `CareFacts` (coordination subgraph, Group 4 `#36`) | **AVAILABLE** — wired into the allowlist by TASK R-CARE (evidence 35 §14): snack, TV, bedtime, allergy and routine-care questions are answerable live, citing `source.ref` and distinguishing CONFIRMED/PROVISIONAL. An empty result (no access, no such child, or genuinely no facts — identical by design) always gets "I can't see a recorded rule for that," never the harsher generic scope refusal, for care questions specifically. `src/rosina/roster.ts#careOnlyChildren` is a narrow, CareFacts-only supplement for a real grant outside a caller's one documented child (today: Priya on Malik) — never used by any other tool, and never a substitute for the `MyChildren`/grants-by-caller read that would still replace both it and `scopedRoster`. |
| Village directory read (people/relationships) | not yet exposed via MCP — needed for `open-person`; also needed for a proper `MyChildren`/`myVillages` caller-scoped read (R-LEAK's fallback, evidence 35 §10, uses `src/demo/personas.ts` in the meantime) |
| `CheckInStatus` / `OrbitStatus` / `OrbitVocabulary` | **AVAILABLE** — wired into the allowlist by TASK R-ORBIT (evidence 35 §13): notice (server-computed `overdue`, never inferred from `recorded` alone), suggest (only when asked or genuinely overdue), gather (vocabulary-only, never free text/place), and a `prepareOrbitAlert` preparation card are all live. `prepareOrbitAlert` is gated and tested but `implemented: false` in the catalog — pending Codex's app-side draft/preview/confirm handler; no activate tool exists or is exposed. |

**Rule for adding a tool to the allowlist (`ALLOWED_MCP_TOOL_NAMES`, `src/rosina/model.ts`):** a
new MCP read Bentley ships is added to the allowlist ONLY in a PR that ALSO adds persona-boundary
tests for it — at minimum: an allowed persona sees the data; an out-of-network persona gets a
plain refusal with no data leaked; the test runs against the alt stack read-only (no mutation, no
GraphOS router). An unknown tool name stays rejected in code regardless of what `.apollo/mcp*.yaml`
exposes — the allowlist is the actual gate, the MCP config is not trusted alone. See
`src/rosina/model.test.ts` for the shape this takes (Priya capability-fabrication regression).

**Known model variance (reported, not hidden):** the model occasionally describes an action/card
in text without actually calling the matching `proposeAction_*` tool (so `actions` stays empty
when a card was implied). A stronger tool description measurably reduced but did not eliminate
this in the runs performed — see evidence §7. One real (unforced) 20s timeout was observed before
the default was raised to 30s; that number is not exhaustively tuned.

BRANCH: feat/rosina-service; WORKTREE: /Users/user/Desktop/bentley/fridgegraph-rosina-service
TASK: live POST /api/rosina — Muse Spark 1.3 + MCP (caller-token, read-only, catalog-validated),
  rate limit, graceful timeout, alt-stack test harness, evidence 35.
LAYER: server (plus one proxy line in web/vite.config.ts, explicitly requested by the task).
TOUCHED: src/rosina/, ops/rosina-catalog-drift.mjs, ops/rosina-probe.mjs, package.json,
  web/vite.config.ts (one line), docs/evidence/35-rosina-service.md, this handoff.
  (`ops/alt-stack.sh` is PR #16's, merged in as-is — see Task R-FIX below; this PR's own
  `router.alt.yaml`/`.apollo/mcp.alt.yaml` were deleted as redundant with it.)
DONE WHEN: npm run typecheck; npm run check; npm run check:rosina-catalog; npm --prefix web test
  (117); live scenario matrix against the alt stack (not GraphOS) in docs/evidence/35 — all
  actually run above, not just described.
NOT DOING: schema/auth changes, minting identity, exposing any mutation tool, Family Calendar,
  care-plan/village-directory/coordination-job reads (blocked, see table above), merge/tag/release.
BLOCKERS: CoordinationJobs/CandidateEvaluations, CarePlan, village-directory, and events/practices
  MCP operations are not yet available (Task E) — four acceptance-example scenarios stay BLOCKED
  until Bentley ships and lists them under "Rosina tools available" above.

## Task R-FIX — making PR #24 mergeable (2026-10-30, DONE)

Full detail: `docs/evidence/35-rosina-service.md` §9 (the Priya finding, turned into an enforced
code rule + regression test, not just a prompt). This section tracks the mergeability work itself.

**Done so far:**
1. Evidence renumbered 34 → 35 (see "Reserved evidence numbers" above) — every reference updated
   (this handoff, `ops/rosina-probe.mjs`, `ops/rosina-catalog-drift.mjs`, `systemPrompt.ts`).
2. `src/rosina/model.ts`: `start-pickup` now requires a same-turn, successful `PickupCandidates`
   call for the exact `childId` before the service accepts the proposal (`verifiedChildIds`,
   per-child, order-independent within a round). Catalog presence never implies permission.
3. `src/rosina/model.test.ts` (`npm run test:rosina`), stubbed model + stubbed MCP, no network,
   no Meta cost — 8/8 PASS, including the Priya regression and an order-independence case.
4. `src/rosina/model.ts` is now dependency-injectable (`chatFn`, `mcpClientFactory`,
   `providerConfig`) purely so the above test can stub both without touching production code
   paths — production still calls the real Meta/Baseten provider and a real `McpToolClient`.
5. Allowlist-extension rule documented above ("Rule for adding a tool to the allowlist").
6. Re-verified live against the real alt stack after the code change: Kendra (parent) still gets
   the `start-pickup` card; Priya (sitter, no grant) gets a clean refusal with `actions: []` —
   see evidence §9 for the transcripts.
7. Full battery re-run and green: `npm run typecheck`; `npm run check` (294 files, 0 findings);
   `npm run check:rosina-catalog`; `npm run test:rosina` (8/8); `npm --prefix web test` (117).

**Sync with main — DONE (2026-10-30):**
- PR #16 merged to main as `275461e`; PR #9 merged to main as `ebb7a2c` (both landed before this
  sync). `git merge origin/main` (merge commit, not rebase) performed, two conflicts resolved:
  - `ops/alt-stack.sh` (add/add): resolved entirely in #16's favor — `git checkout --theirs`.
    #16's script (ports 4101-4107/4012/8092/5051, `--up`/`--check`/`--down`, config GENERATED
    from `router.yaml`/`supergraph.yaml`/`.apollo/mcp.local.yaml` into `/tmp`) is now the one
    reproducible setup. This PR's own `router.alt.yaml` and `.apollo/mcp.alt.yaml` were deleted
    (`git rm`) as redundant — nothing in `src/rosina/` depended on either file directly (the
    service only ever takes `ROSINA_MCP_URL` as a plain env var), so this was a clean delete, not
    a rewrite. `ops/rosina-probe.mjs` and `ops/rosina-catalog-drift.mjs` are this PR's own tools
    and did not collide with #16's additions.
  - `docs/handoff/HANDOFF.md` (content): both sides had appended new sections at the same point
    in the file; resolved by keeping BOTH in full (origin/main's Task B/D/C/V2-VILLAGE sections
    first, since they were already on main, then this branch's Reserved-evidence-numbers/Task R/
    Task R-FIX sections after), plus one new bridging note closing the loop on origin/main's W4
    audit finding ("Rosina ... no readiness entry") — no past entry on either side was rewritten.
  - The two were irreconcilable-by-nature only in the trivial add/add sense (same path, two
    independent implementations); neither was a real design disagreement, so no STOP was needed.
- Post-merge: `npm run typecheck` clean; evidence 35 §4/§9 and this section updated to describe
  the reconciled `ops/alt-stack.sh --up`/`--check`/`--down` interface in place of this PR's own
  (now-deleted) `start`/`stop`/`status` version — the underlying ports/mechanism were already
  identical, so no live result changed, only the command to reach it.
- PR #9 touched `docs/handoff/HANDOFF.md` only in this PR's diff (many other files it added are
  net-new, not modifications of anything this PR touches) — no further reconciliation needed
  there.

**NOT DOING (hard stops, unchanged):** no schema/auth/DB change; no mutation tool exposed; no
identity minted — every MCP call is still made as the signed-in caller only; the four BLOCKED
scenarios stay BLOCKED until Bentley lists their operations under "Rosina tools available"; no
`--auto`/bypass/merge override; this agent does not merge — Bryan merges.

**Final state (2026-10-30):** PR #24 head `2a0c8a6`. `gh pr view 24` → `state: OPEN`,
`isDraft: false` (`gh pr ready 24` run), `mergeable: MERGEABLE`, `mergeStateStatus: CLEAN`. Both
CI checks pass: `typecheck + secret scan` (18s), `web build` (25s). `git diff origin/main...HEAD
--stat` confirms the actual PR diff is exactly: `src/rosina/*`, `ops/rosina-catalog-drift.mjs`,
`ops/rosina-probe.mjs`, `package.json`, one proxy line in `web/vite.config.ts`, this handoff, and
`docs/evidence/35-rosina-service.md` — nothing from #16/#9 leaks into the diff despite the merge.
Not merged — Bryan merges.

**Second sync (2026-10-30):** main advanced again — #23 (E0, `cccbbd2`) and #25 (Mission Control
v2, `7b4bb14`) both merged. `git merge origin/main` → one conflict, `docs/handoff/HANDOFF.md`
only (both #25 and this branch had appended at the same point); resolved by keeping Task MC
(#25) in full, then this branch's sections in full, plus a short bridging note — no past entry
rewritten. `ops/alt-stack.sh` and everything else merged clean (no second conflict there).
Re-ran the full battery: `npm run typecheck` clean; `npm run check` (358 files, 0 findings);
`npm run check:rosina-catalog` PASS; `npm run test:rosina` 8/8 PASS; `npm --prefix web test`
**150 PASS** (137 + Mission Control v2's 13 new). `git diff origin/main...HEAD --stat` confirms
the diff is still exactly this PR's own layer (same 12 files as above). Pushed to `d085628`;
`gh pr view 24` → `mergeable: MERGEABLE`, `mergeStateStatus: CLEAN`, both CI checks pass. Not
merged — Bryan merges.

## W4a — live-capable Ask Rosina browser (incremental slice)

BRANCH feat/web-rosina-live; WORKTREE ../fridgegraph-web-rosina-live.
BASE fetched origin/main 298f0ee8ebaf1b0e9b446db2faa29dc880db5419 (#24 + #25 included).
Read Task R and “Rosina tools available”: only PickupCandidates is live. Public persona login,
additional care/village/calendar/coordination reads remain pending E2a/Task E. No login call built.
Layer: web + companion docs only; no backend/schema/auth/DB/ops helper changes; never merge.

UI: live-capable · Integration: browser → Rosina service proven for Kendra via a dev-harness
token · Pending: public persona login (E2a) and additional Rosina reads (Task E).
**W4a NOT DONE:** overall local live smoke FAILS the service boundary regression below.

Optional AuthSession.accessToken stays memory-only. No bearer selects Sample answers; a bearer
selects Live with no probe. Every request reads the current session and records its generation;
adapter and panel both discard stale results, including cancellation-ignoring transports.
Switch/close/Escape/navigation/unmount abort. 401 requires sign-in without retry; 429 asks for a
moment without auto-retry; network/5xx/malformed/timeout stays Live with a friendly fallback.
Server timeout reply is unchanged text. No live failure substitutes a scripted family answer.
Client catalog/permission validation and mandatory app confirm remain in place; no mutation
execution was enabled. Source labels and history clearing are visible on desktop/mobile.

Observed: **168 web tests PASS**, root typecheck PASS, web typecheck/build PASS (existing chunk
advisory). Existing 150 tests retained. Live browser pickup names matched the ACTUAL authorized
PickupCandidates response. All four actual candidates had UNKNOWN availability and zero vehicle
records returned; no web mock was used to fill availability or transport. A list of authorized
people does not prove who currently can drive or needs a ride. Exact tool table and all recorded
model qualification findings are in web/evidence/rosina-live/README.md.

**Actual live boundary failure, verbatim:**
“Which child do you mean? I only know Nora and Jax by name.

I only see what you can see, so I can't pull another family's details. For care plan: I can't
confirm that yet. Contact details beyond those names isn't connected yet.”
The generic question did not supply Jax; introducing that foreign name fails the required gate.
An earlier reply similarly said “I only recognize Nora and Jax by name.” Care/contact contents
were refused, but that does not excuse the identity disclosure. No backend patch or client
rewrite was used to hide it. Task R must correct this before calling W4a DONE. The service's
pickup wording “can pick up Nora today” also needs qualification against UNKNOWN availability
and missing vehicle evidence; only authorization was established by the actual read.

The completed smoke still captured desktop/mobile live reply, loading, failed generic boundary,
named-child refusal, controlled live fallback and Sample answers. Controlled loading hold and
HTTP failure are declared in evidence, not represented as actual service delay/outage. Harness
remains nonzero for the observed boundary failure; privacy failures were not weakened to pass.

Token handling: Bryan confirmed p_mom for Kendra after p_kendra lookup was unavailable, and
approved baseline-aware disk scanning. Unmodified ops/auth.mjs only, token in harness/page-session
memory; no token in files/argv/logs/storage/screenshots/traces/videos. Completed scan: **0 current
prefix hits, 0 new generic JWT-prefix hits; 86 unchanged baseline occurrences; 937 files** across
worktree/main and generated evidence/Playwright output (protected creds/dependencies/git skipped).
No token prefix value was printed or supplied as a command argument. No full-filesystem audit
claimed. Screenshots, reproduction and verbatim outputs: web/evidence/rosina-live/.
Final readiness recheck: origin/main still 298f0ee; open PR #26 proposes E1/E2/E3 including
public login/guide scope and timeline joins. It is not integrated here: W4a explicitly excludes
the login call. Task R boundary behavior remains unresolved on the delivered service.
Final local checks: 168 web tests PASS; root typecheck PASS; web build/typecheck PASS;
shared catalog drift PASS (7 identical ids); staged secret scan PASS (366 files, 0 findings).
A test-only placeholder initially triggered the generic assignment guard; changed to its
explicit test-only placeholder convention, without changing production logic or scanner rules.
No-token-on-disk gate PASS; overall live smoke FAIL (foreign-name boundary); do not mark DONE.
Published draft PR **#27**: https://github.com/Pettybytes/fridgegraph/pull/27.
Frontend implementation f5d451c. Draft is mechanically mergeable, but **W4a NOT DONE / live
privacy gate FAILED**. Keep the exact service regression visible; do not merge as an all-green
integration. Await Task R correction, then rerun the same local smoke and disk gate.

## Task R-LEAK — scoped roster + output guard (2026-10-30)

Full detail and live transcripts: `docs/evidence/35-rosina-service.md` §10. Summary for the next
agent (likely W4a's rerun, or Bentley's next Rosina-tools pass):

**Bug (found by #27's W4a smoke):** `src/rosina/systemPrompt.ts` hard-coded
`KNOWN_CHILDREN = [Nora, Jax]` into EVERY caller's system prompt. Kendra, who has no access to
Jax's family, got told Jax exists ("I only know Nora and Jax by name") — a cross-family
disclosure. With Cast v2 (six families) that leak only grows as more names get added to such a
list.

**Fix:**
1. `src/rosina/roster.ts` (new): `scopedRoster(personId, isGuide)` — per-request, scoped to
   exactly the caller. Looks up the caller's own entry in `src/demo/personas.ts`
   (`DEMO_PERSONAS`, server code shipped in `#26`) by their OWN verified `personId`; an
   unrecognized personId gets an EMPTY roster, never a guess. `isGuide` comes from the verified
   token's `app_metadata.demo_guide` claim (`verifyBearer`, also `#26`) — never a personId string
   match — and returns every sandbox child, matching the guide's documented broad role.
   **Investigated first:** no live MCP/GraphQL read exists that answers "list my children" as
   output (every query needs a `childId` as input) — recorded as a Bentley follow-up: ship a
   `MyChildren` (or `myVillages`) read to replace this fallback.
2. `src/rosina/systemPrompt.ts`: `buildSystemPrompt(roster, isGuide)` takes the roster as a
   parameter now; the global constant is gone. New mandatory rule: a scope refusal is always
   exactly "I can only help with children shared with you." — no names, no count, no example,
   even if the user already said a name themselves.
3. `src/rosina/outputGuard.ts` (new): server-side defense in depth. Scans the reply for any demo
   child/adult name not in the caller's roster and not grounded in this turn's own tool results;
   if found, replaces the WHOLE reply with the same fixed refusal and drops `actions` too (fail
   closed). The name list used for scanning is built from `DEMO_PERSONAS` and is never sent to
   the model.
4. `model.ts`/`server.ts` thread `personId`/`isGuide` through; `server.ts` logs
   `outputGuardTriggered` as a bare boolean, never which name triggered it.

**Tests:** `npm run test:rosina` **16/16 PASS** (the original 8 Task R-FIX regressions +8 new:
per-persona roster scoping incl. the guide and an unknown personId, plus three output-guard
cases). `npm run check:rosina-catalog` PASS. `npm run check` PASS (393 files, 0 findings).
`npm --prefix web test` **168 PASS** (unchanged — no `web/` file touched).

**Live, real alt-stack MCP + real Meta Spark 1.3 calls, real tokens:** Kendra asking about
"another family's child" and by name ("Jax") both get the exact scoped refusal with Jax named
nowhere in either reply; Dana asking about Nora gets the same refusal; Jax's family asking about
Jax gets their own normal, grounded answer; Kendra's own-child query and Priya's
no-capability-fabrication case are unaffected (regression-clean); the Demo guide (real seeded
login, `app_metadata.demo_guide` verified, not assumed) gets the broad sandbox answer. Full
transcripts: evidence §10 (one live phone number was hand-redacted before saving, per this
task's hard stop).

BRANCH: fix/rosina-scoped-roster; WORKTREE: /Users/user/Desktop/bentley/fridgegraph-rosina-scoped-roster
TASK: stop Rosina's system prompt from naming any child outside the caller's own access.
LAYER: server (src/rosina/ only; no web/, schema, auth or DB change).
TOUCHED: src/rosina/roster.ts, src/rosina/outputGuard.ts, src/rosina/systemPrompt.ts,
  src/rosina/model.ts, src/rosina/model.test.ts, src/rosina/server.ts,
  docs/evidence/35-rosina-service.md (append), this handoff.
DONE WHEN: npm run typecheck; npm run check; npm run check:rosina-catalog; npm run test:rosina
  (16/16); npm --prefix web test (168); live probes against the alt stack (not GraphOS) — all
  actually run above, not just described.
NOT DOING: schema/auth/DB changes, service-role reads, mutation tools, merging. The four
  previously-BLOCKED scenarios (care plan, calendar/events, Mission Control recommendation,
  village directory) remain BLOCKED, unchanged by this fix.
BLOCKERS: none for this fix. Follow-up for Bentley: a `MyChildren`/`myVillages` MCP read, scoped
  by RLS to the caller, would let `roster.ts` stop depending on `src/demo/personas.ts` and read
  the graph directly instead — add it to "Rosina tools available" when it ships, with the usual
  persona-boundary tests.

**Final state (2026-10-30):** PR #30 head `c9553ab`. `gh pr ready 30` run; `gh pr view 30` →
`state: OPEN`, `isDraft: false`, `mergeable: MERGEABLE`, `mergeStateStatus: CLEAN`. Both CI
checks pass: `typecheck + secret scan` (17s), `web build` (25s). Not merged — Bryan merges.

**Update:** PR #30 merged to `main` as `4f57c97` (confirmed while resolving Task R-TOOLS-1's
merge conflict below). "Not merged" above is stale as of that commit.

## Task R-TOOLS-1 — Attempts + JobTimeline added to Rosina's allowlist (2026-10-30)

Full detail and live transcripts: `docs/evidence/35-rosina-service.md` §11.

**Premise contradiction, flagged and resolved, not silently worked around:** this task's prereq
was "R-LEAK merged." At task start, PR #30 (R-LEAK) was still open on `origin/main` — confirmed
via `gh api repos/Pettybytes/fridgegraph/pulls/30 -q .merged` → `false`, and `src/rosina/
roster.ts` genuinely absent from `origin/main`. Since this task's own point 4 (the output guard
must cover candidate displayNames) hard-depends on R-LEAK's code, and R-LEAK is this agent's own
already-reviewed, CI-green, ready PR (not someone else's uncertain state), the branch was built
from `origin/main` (correctly including `#29`'s tools and `#31`'s Group 3 work) and then merged
with `fix/rosina-scoped-roster` directly, rather than blocking on the merge. Clean merge, one
file (`docs/handoff/HANDOFF.md`), auto-resolved, no conflict markers.

**Shipped:**
- `src/rosina/model.ts`: `ALLOWED_MCP_TOOL_NAMES` now `{PickupCandidates, Attempts, JobTimeline}`.
- `src/rosina/localTime.ts` (new): `at`/`closedAt` timestamps in a tool result are rewritten to
  `America/Detroit` local time BEFORE the model sees them — a real server-side transform, not a
  prompt instruction hoping the model converts UTC correctly.
- `src/rosina/systemPrompt.ts`: new `JOB_TOOLS` section teaches the `Attempts()` → discover job →
  `JobTimeline(jobId)` → full story pattern; `[]` always means "I can't see that pickup," never
  "nothing happened," and the three possible reasons (not visible / doesn't exist / malformed id)
  are indistinguishable by design (evidence 40's "no existence oracle"); enum codes (`kind`,
  `destinationMode`, `closedReason`) must be described in plain language. New rule 10: never
  suggest an action a job's status doesn't license — the Priya rule (8), applied to jobs.
  Care/calendar/events/directory stay explicitly blocked.
- The R-LEAK output guard needed no code change for these tools' candidate names — it already
  allows any name present in this turn's own tool-result JSON regardless of which tool returned
  it — but this is verified by a dedicated test, not assumed.

**Tests:** `npm run test:rosina` **24/24 PASS** (the 16 existing Task R-FIX/R-LEAK regressions,
still green, + 8 new in `src/rosina/jobTools.test.ts`: allowlist accept/reject, empty-result
wording, local-time wording and the actual `localizeTimestamps`/`toFamilyLocalTime` behavior,
and three output-guard cases including a deliberately-induced leak on an empty result).
`npm run check:rosina-catalog` PASS. `npm run check` PASS (416 files, 0 findings).
`npm --prefix web test` **168 PASS** (unchanged — no `web/` file touched).

**Live, real alt-stack MCP + real Meta Spark 1.3 calls, real tokens:** Kendra and Andre (same
job, co-parents) both get the same accurate answer — Loretta accepted, Tasha declined, status
awaiting approval, times correctly converted from UTC to EDT; Dana (not Nora's family) gets the
exact scoped refusal with zero names, HTTP 200 (never 401); the Demo guide reads the sandbox job
with no approve/decline action suggested; a "give me the full timeline" question correctly
triggers BOTH tools (`Attempts` then `JobTimeline`) and renders the chronological story in plain
language with no enum code read aloud. All five runs: `outputGuardTriggered=false`, no phone
digit or out-of-scope name in any reply.

BRANCH: feat/rosina-tools-1; WORKTREE: /Users/user/Desktop/bentley/fridgegraph-rosina-tools-1
TASK: add Attempts + JobTimeline to Rosina's MCP allowlist; answer Mission Control job-status
  questions live; keep everything else (care/calendar/events/directory) blocked.
LAYER: server (src/rosina/ only; no web/, schema, auth or DB change).
TOUCHED: src/rosina/model.ts, src/rosina/systemPrompt.ts, src/rosina/localTime.ts (new),
  src/rosina/jobTools.test.ts (new), docs/evidence/35-rosina-service.md (append), this handoff.
DONE WHEN: npm run typecheck; npm run check; npm run check:rosina-catalog; npm run test:rosina
  (24/24); npm --prefix web test (168); live persona-boundary probes against the alt stack (not
  GraphOS) — all actually run above, not just described.
NOT DOING: schema/auth/DB changes, service-role reads, mutation tools, adding the three Group-3
  tools (ChildEvents/AdultAvailability/EffectiveSchedule — out of scope, needs its own task),
  merging.
BLOCKERS: none for this task. CarePlan, village-directory and the Group-3 trio remain the open
  follow-ups under "Rosina tools available" above.

**Final state (2026-10-30):** PR #34 head `4c3da49`. `gh pr ready 34` run; `gh pr view 34` →
`state: OPEN`, `isDraft: false`, `mergeable: MERGEABLE`, `mergeStateStatus: CLEAN`. Both CI
checks pass: `typecheck + secret scan` (17s), `web build` (25s). Diff vs `origin/main` at that
point legitimately included R-LEAK's files (`roster.ts`, `outputGuard.ts`, PR #30, not yet
merged) since this task's code hard-depends on them.

**Sync (2026-10-30):** #30 merged to `main` as `4f57c97` while #34 was open, carrying the exact
same `roster.ts`/`outputGuard.ts` content this branch already had — so `git merge origin/main`
on `feat/rosina-tools-1` produced conflicts ONLY in the four files this task's own commit also
touched (`src/rosina/model.ts`, `src/rosina/systemPrompt.ts`, `docs/evidence/
35-rosina-service.md`, this handoff), every one resolved by keeping this task's own addition
(R-LEAK's side of each conflict was empty — #30 never touched the Mission-Control bullet,
the allowlist, or the import list this task added). No conflict in `roster.ts`/`outputGuard.ts`/
`model.test.ts` themselves — confirming they are now byte-identical to `main`. Full re-verification
after resolving: `npm run typecheck` clean; `npm run check:rosina-catalog` PASS; `npm run
test:rosina` **24/24 PASS**; `npm run check` PASS; `npm --prefix web test` **168 PASS**.
`git diff origin/main...HEAD --stat` confirmed to contain ONLY this task's own files. Pushed;
`gh pr view 34` → `mergeable: MERGEABLE`, `mergeStateStatus: CLEAN`, both CI checks pass. Not
merged — Bryan merges.
## W4b — Explore as persona sessions

BRANCH feat/web-demo-login; WORKTREE ../fridgegraph-web-demo-login.
BASE actual origin/main 0ff82ee86baf9973152c49e93bd186edc2afe276; ancestry of required 1cd7ab8
verified (includes #28 sessions + W4a #27). Read persona-session contract/evidence 39/E2A report.
E2A's original refresh-token example is historical; current HANDOFF/evidence 39 govern: nested
access token + real expiry, no browser refresh token, 60/min IP, repeat endpoint renewal.
Layer web + companion docs only. Never merge. No browser Supabase client, identity substitution,
shared-session sign-out/revoke, credential-file reads, or automatic mutation/Rosina-message replay.
UI in progress · backend session/E3 reads delivered · integration not yet verified here.

W4b implementation: **UI complete · backend sessions/E3 recorded reads delivered, v2 partial ·
integrated + tested partial. NOT DONE.** Default picker is live “Explore as…”; mock identity only
with explicit VITE_DEV_MOCK_AUTH=true in development/tests. Live sessions whitelist nested access
bearer + real expiry into memory. No browser Supabase client, refresh token, storage, logs,
identity substitution, shared-session sign-out/revoke, or auto-replayed mutation/Rosina message.
Renew at four minutes before actual expiry; same-expiry/failure backoff 30/60/120 s and at least
Retry-After; per-generation single-flight; independent expiry safety timer. Eligible read retries
once after renewal; Rosina renews on 401 but asks the visitor to send again, never replays.
Switch/leave synchronously removes private DOM, clears Apollo/selection/thread state, aborts and
bumps generation; late results cannot enter the cache or restore a prior perspective.

Actual final local browser results (full receipt: web/evidence/demo-login/results.json):

| Persona | Picker | Live reads | Rosina |
| --- | --- | --- | --- |
| Kendra | READY | Private reads pass; stored job + 5 timeline entries. Directory isolation pending (failed) | Live answer |
| Andre | READY | Same family/job/timeline as Kendra; private reads pass. Directory isolation pending (failed) | Live answer |
| Loretta | READY | Schedule/approved goals pass; care/household/candidates correctly refused. Directory isolation pending (failed) | Correct refusal; care tool pending |
| Priya | READY | Schedule/care permission pass; goals/household/candidates correctly refused. Directory isolation pending (failed) | Correct refusal; care tool pending |
| Dana | READY | Jax reads pass; Nora private records correctly refused after switch. Directory isolation pending (failed) | Live answer; date grounding follow-up |
| Jax's family | READY | Jax reads pass; Nora private records correctly refused. Directory isolation pending (failed) | Live answer |
| Demo guide | READY | Sandbox reads pass; confirmed forced write refused. Topology/goals correctly refused under current contract; breadth pending | Live answer |
| Rosa Castellano | Coming soon | Pending: no seeded identity; disabled, not chosen | Pending |

**Full live smoke FAILS six directory-name checks.** Direct child-directory probes disclose Jax's
name to Nora's family/grant holders and Nora's name to Jax's family. E2c evidence 37 explicitly
records the inherited authenticated directory policies; they do not satisfy this task's stricter
isolation gate. No backend change or client-side filter concealed this. Bentley needs to reconcile
that directory posture with the requested persona boundary. Other families' household/candidate/
care/schedule/goals reads were correctly refused. The product did not render the foreign probe
results. Full assertions remain nonzero; do not mark integrated or DONE from the unit suite.
Guide topology remains parent-only per E2e; guide goals refusal is recorded, not invented away.

Two simultaneous contexts verified independent browser identities. Supplemental Kendra → Dana
visual check sampled **70 frames, zero old pickup records**. Token-leak scans in-process PASS:
zero held token/current-prefix hits, zero new generic-prefix matches; existing generic matches
inspected (redacted evidence/patterns/integrity text/binary PNG), no matching content printed.
Coverage/filenames and exclusions are in the receipts. No credential-file reads, traces, HAR,
video, saved browser sessions, header logging or token fragments in command arguments.
Desktop/mobile screenshots for every READY landing and live Rosina reply, picker/Coming soon,
guide refusal and actual Mission Control timeline are in web/evidence/demo-login/.

Recorded Mission Control now uses actual jobTimeline and Attempt.candidate/mode/closure fields;
missing evaluations/times stay explicit. “Stored pickup record” describes persistence only,
never verified execution. Calls/texts may be simulated; sending is explicitly unverified. The
separate no-driver fixture remains “Sample scenario”; Village v2/Calendar/care remain “Sample
data”. No live mutation enabled. Proxy correction: web /graphql rewrites to the router's actual /
endpoint on 4010; /api/demo proxies 4008. Updated frontend identity docs that still incorrectly
required a browser Supabase sign-in; current session contract remains evidence 39/HANDOFF.

Rosina's generic boundary reply introduced no foreign name this time; exact replies are retained
in the evidence README/receipt. Dana's reply cited “grant valid 2026-10-31” during the Detroit
October 30 run: Task R/Bentley must review the tool/service meaning of “today”; no client rewrite.
Permission-only v1 care/schedule probes are not v2 UI or Rosina care integration.

Remaining dependencies alongside W4: Cast v2 seed for Rosa/Felicia/Simone/Dwayne and six-family
Guide breadth; directory/guide topology scope; Village v2 relationships/visibility reads; Calendar
event/category/status, holiday precedence and adult busy/free reads; v2 care read/tool;
resetDemo/createDemoFamily real services; Task H public judge access + Try FridgeGraph landing
button. Current live failures remain Live; never replaced by mock family answers.

Observed local checks: **197 web tests PASS**; root typecheck PASS; web typecheck/build PASS
(existing chunk-size advisory); shared Rosina catalog check PASS (7 identical ids).
Root staged secret scan PASS: **413 files, 0 findings**. No backend/schema/auth paths changed.

W4b upstream reconciliation: rebased onto origin/main **558796a** (#29) before first push; initial
base remains 0ff82ee. Read updated Task E-NEXT and evidence 40: MCP exposes JobTimeline/Attempts
alongside PickupCandidates (service allowlisting is Task R). The current stored pickup is the
separate SIMULATED seed, not proof of actual execution. UI now says “Stored pickup record” and
explicitly leaves dispatch unverified; it makes no “Recorded run” claim. Destination badges use
only destinationMode; that field alone is not sending evidence. Bentley dependency: expose
execution provenance/delivery evidence before calling this an executed run. No field invented.
Removed the obsolete, unused ConnectedEntry browser Supabase client; all sessions now enter
through the documented endpoint. No browser Supabase imports remain in application source.
Final after rebase/provenance correction: root staged secret scan **420 files, 0 findings**.
The refreshed full live receipt has exactly six directory-name failures, not a weakened assertion.
Supplementary frame audit: 70 frames / zero old pickup records. Temporary Playwright logs were
scanned before cleanup; screenshots and safe receipts remain in web/evidence/demo-login/.

Published **DRAFT PR #32**: https://github.com/Pettybytes/fridgegraph/pull/32.
UI complete · backend partial · integrated + tested partial; NOT DONE. Keep the six directory
isolation failures visible. Local final suite 197/197, web typecheck/build and root typecheck
PASS; secret scan 420 files / 0 findings; catalog drift PASS. CI typecheck/secret scan and web
build passed on initial implementation 25c5b6f; final evidence/copy follow-up checked on the PR.
Only the task-owned local Rosina process was stopped after the probes; shared demo login,
routers and MCP were not stopped or reset. No merge, tag, release, seed or database mutation.
Supplemental direct stored-job lookup PASS for all seven READY personas: discover Kendra's real
job ID, then query that SAME ID under every perspective. Kendra/Andre/guide return identical
5 timeline entries / 2 attempts; Loretta/Priya/Dana/Jax's family return empty job/timeline/attempt
results, with no existence disclosure. In-process token scan PASS. Receipt:
web/evidence/demo-login/job-boundary-results.json. This does not override the six directory-name
failures. No model call or mutation was used by this supplemental probe.

## W4b replacement brief — live calendar and persona sessions

This packet supersedes the earlier W4b implementation notes above. Branch feat/web-demo-login in
../fridgegraph-web-demo-login; fetched origin/main base **0d80f003c722e009897b1790c461952cd0de6f66**
(#31), includes #27/#28/#29. Existing draft #32 rebased locally onto that base. No backend/schema/
auth/database changes; no merge. UI in progress · backend documented Group 3 reads delivered ·
integrated + tested pending this replacement run.

Evidence 39 and HANDOFF govern nested session/real expiry; E2A's earlier refresh-token example is
historical. Evidence 40/41 govern each read's own empty/refusal contract: no array emptiness is
promoted to UNAUTHORIZED. Native calendar adapter reads childEvents, daily effectiveScheduleFor,
scheduleConflicts and Busy/Free-only adultAvailability through Apollo/current bearer. The calendar
never substitutes fixture data for an empty/refused/failed live response. Mock calendar is dev/test
only. Native events have no category, confirmer, participants or linked records fields; effective
schedule has parent/source/arrangementId, not holiday metadata. No such fields were invented.

Bentley field gaps: school-closure/day-kind read is NOT exposed by the four delivered GraphQL
operations (day_kind exists only behind the server); event category/confirmer/links and raw proposed
holiday arrangements are not exposed. The UI explicitly leaves those unavailable. Daily approved
arrangement answers can be shown accurately without fabricating a HolidayArrangement object or
inferring a school closure from its title. Busy/Free names/IDs come only from the signed-in caller
and the returned daily caregivers; no mock adult roster. Child enumeration beyond the session's
scope needs its own delivered read before the guide's broader calendar can be offered.

Runtime reconciliation: router 4010 does not expose the four Group 3 fields; 4012 does. The normal
W1 proxy default remains 4010. The local replacement smoke uses an explicit 4012 proxy override,
as evidence 41 does; there is no automatic endpoint or mock fallback. Bentley must reload the
normal stack's schema before its default calendar endpoint can serve these operations.

Replacement W4b resolution and actual state:
- Bryan confirmed **follow documented directory access; still test private-record refusals**.
  The earlier identity-hiding assertions were wrong for the directory contract; old failed receipts
  are preserved, not relabeled as passes. No backend identity-isolation change is requested by this
  replacement. Private household/candidate/calendar/non-sandbox boundaries remain strict.
- First replacement smoke entered Kendra and Andre and captured their real calendars/timeline/
  Rosina; Thanksgiving Nov 25–27 uses ARRANGEMENT/Andre, Nov 28 returns to WEEKLY (Andre in the
  actual weekly schedule). Conflicts Nov 26–27 remain visible; cancelled toggle uses real records.
  It stopped at Loretta's calendar check, so a full private-boundary battery is not claimed.
- Later login attempts failed for all seven seeded personas. Sanitized Kendra endpoint diagnostic:
  HTTP 503 DEMO_LOGIN_UNAVAILABLE. No per-persona backend reason is invented for other failures.
  UI Busy is retryable, no Coming soon or identity substitution. Bryan explicitly said **finish
  with remaining live checks pending**. No credential file or alternate token mint path used.
- Latest per-persona table and desktop/mobile evidence: web/evidence/demo-login/current/README.md;
  current/results.json is a partial integration outcome, not an all-green run. Prior parent-folder
  evidence remains historical. Token scans PASS; later failed-login run issued no credentials.

| Persona | Latest picker | Live reads | Rosina |
| --- | --- | --- | --- |
| Kendra | failed; earlier READY | Calendar/timeline observed; full rerun pending | earlier live answer; rerun pending |
| Andre | failed; earlier READY | same family/job/calendar observed; full rerun pending | interrupted-tool response; pending rerun |
| Loretta | failed; earlier READY | pending; calendar check incomplete | pending |
| Priya | failed | pending | pending |
| Dana | failed | pending | pending |
| Jax's family | failed | pending | pending |
| Demo guide | failed | pending | pending |
| Rosa | Coming soon; disabled | pending seed | pending |

UI: **live-capable for delivered fields** · backend: **session/Group 3 reads delivered, field gaps
remain** · integrated + tested: **partial — NOT DONE**. School-closure day kind is not exposed by
these reads; category/participants/confirmer/links/full holiday metadata are absent. No title
inference or mock data fills these gaps. Start-based date-range reads also need an overlap/civil-
date contract before arbitrary carry-in events are claimed live-tested. Native schedule source
answers are rendered directly; no fabricated weekly or holiday objects. Adult Busy/Free queries
never select a reason; Free says free time recorded, not available/willing.

Remaining: restore login runtime and rerun seven READY personas + Rosa/contexts/guide write check;
normal 4010 schema reload (local proof is explicitly 4012); missing fields/child enumeration;
Cast v2 seed for Rosa/Felicia/Simone/Dwayne + six-family Guide breadth; Village v2 live reads;
**Orbit screens after Bentley's Task O**; Task H public judge access + Try FridgeGraph landing
button; Group 5 reset/demo-family services. Keep draft #32; no merge.

Replacement offline verification: **206/206 web tests PASS**, web typecheck/build PASS (existing
chunk-size advisory), root typecheck PASS, shared Rosina catalog PASS (7 ids). Browser smoke ran;
full completion remains pending as recorded above. Publishing the rebased draft requires explicit
force-with-lease permission under AGENTS.md §1.2; no force push has been performed.
Staged secret scan: **446 files, 0 findings**. Task-layer diff against the recorded base is web/docs
only. A two-dot comparison to the concurrently advanced origin/main included upstream-only files;
that was an incorrect layer-check comparison, corrected against the actual task base.
Final integration-base reconciliation: main advanced concurrently with #30/#34 and Task O #33.
The branch was rebased locally onto **27fb5a44d575bf7683063516ddbe08ecf321bdea**; initial fetched
base remains 0d80f003c722e009897b1790c461952cd0de6f66. HANDOFF conflict resolved by retaining both
upstream Task R/Orbit evidence and the W4b packets. Task O backend is now on this base; Orbit
screens remain a separate queued UI task, not implemented or silently enabled here. No remaining
live checks were retried after Bryan said to finish with them pending.

Standing shared-stack rule (Bryan): before every live run, read the current main checkout's
HANDOFF reservations; wait if active. After a 503 or unexpected empty fixture result, check HANDOFF
first, then rerun only after Bentley marks restoration complete. Treat those as environment/test-
window interruptions, not product defects. The live harness now checks the shared HANDOFF's
operations table BEFORE any browser/login/API request and defers if any booking lacks explicit
restoration. No reservation commands are executed from documentation. Offline guard tests cover
active/restored/unknown states. At the last check, the **Group 4 reservation (2026-10-30 21:40,
4101–4107 / 4012 / 5051) was in progress**; no live retry was started. The preceding outage/empty
run classifications remain environment interruptions with unverified cause, not product bugs.
Final reservation-guard verification: **3/3 offline Node tests PASS**; final staged secret scan
**477 files / 0 findings**. Web suite remains **206/206 PASS**, web typecheck/build and root
checks PASS on final integration base 27fb5a4. Live checks remain paused, not failed product claims.

Evidence review correction: Andre’s saved replacement response was an interrupted-tool fallback,
not a grounded live answer or proven authorization refusal. Its unsupported family-protection
explanation is preserved verbatim in current/README.md. Rerun after restoration before classifying
a product issue. Kendra’s grounded candidate answer is observed; no reply was rewritten by the UI.

### W4b — authorized publication and picker diagnosis (2026-10-30)

Bryan explicitly authorized publishing reviewed head **729e82475ddb32cb74613fe052e57f40f45c31b1**
against the inspected published head **65d03cf980c39eebdf46e09fe56b09659e8119c8**. The remote
still matched that exact head; the explicit `--force-with-lease` update succeeded. Draft #32
remains draft; no merge. This supersedes the earlier pending-publication wording above.

The shared Group 4 reservation is now explicitly **restored**, with consumer-read restoration
recorded by Bentley. Before rerunning all personas, the actual picker made one Kendra request:
**HTTP 200 / READY**, served by `/Users/user/Desktop/bentley/fridgegraph`, port **4008**.
The diagnostic's in-process token-leak scan passed (filenames/pass-fail receipt only in
`web/evidence/demo-login/current/picker-diagnosis.json`). No alternate login/token mint used.
Earlier failing port 4008 served the `fridgegraph-level-b` checkout. Root cause confirmation was
requested from Bentley through the existing terminal; full persona rerun waits for that answer.

Bentley's owning-layer confirmation (shared HANDOFF: “W4b coordination — 503
DEMO_LOGIN_UNAVAILABLE”): the old serving process had not loaded its runtime environment. The
missing-value gate is the only producer of that code and runs before the upstream mint call.
Bentley reproduced the failure and fixed process startup; main checkout port 4008 now returns
READY. The old process no longer exists, so its exact former environment was not inspected;
this cause is supported by the unique code path and Bentley's reproduction, not a retained
process dump. No credential values were requested or output. Full browser acceptance restarted
only after this diagnosis and the recorded Group 4 restoration. Rosina port 4200 is task-started
from the restored checkout, explicitly using the shared MCP on 5051; no shared stack restart.

### W4b — restored acceptance run (supersedes pending-login table above)

Actual public picker path, no ops mint or identity substitution: **seven READY personas passed**;
Rosa is terminal Coming soon and disabled. Full receipt: `web/evidence/demo-login/current/results.json`.
Two simultaneous contexts **PASS**: Dana/Andre switches in context B did not change Kendra in A.
Per-operation receipt audit **PASS**, including a negative control that rejects a forged successful
private-care read. Public directory identities follow evidence 37; private records remain gated.

| Persona | Picker | Live reads | Rosina |
| --- | --- | --- | --- |
| Kendra | READY | PASS: persisted job, five timeline facts; Nov 25–27 ARRANGEMENT, Nov 28 WEEKLY; private refusals | Live candidate answer, availability unknown |
| Andre | READY | PASS: same family/job/calendar; private refusals | Live candidate answer, availability unknown |
| Loretta | READY | PASS: schedule/goals; care/household/candidates correct refusals; authorized empty jobs | Correct refusal: “I can't confirm that yet.” |
| Priya | READY | PASS: schedule/care; goals/household/candidates correct refusals; authorized empty jobs | Correct refusal: “I can't confirm that yet.” |
| Dana | READY | PASS: bounded Jax world; Nora private reads refused after Kendra | Live Jax candidate answer, availability unknown |
| Jax's family | READY | PASS: Jax world; Nora private reads refused | Live Jax candidate answer, availability unknown |
| Demo guide | READY | PASS: sandbox job/calendar; non-sandbox calendar refused; explicitly confirmed forced write refused | Live sandbox candidate answer |
| Rosa Castellano | Coming soon | Pending Cast v2 identity/seed | Pending |

The cancelled toggle is proven against real records; adult reads contain Busy/Free state only,
never reasons. Hidden/nonexistent/malformed IDs have identical outcomes within each documented
operation. Empty reads, authorization refusals and upstream failures retain distinct wording.
Kendra/Andre/Guide timeline is labeled **Sample activity**, not verified dispatch or Recorded run.
Screenshots refreshed desktop/mobile for picker, seven landings/calendars/Rosina replies, timeline,
Thanksgiving arrangement, cancelled events and Guide read-only. Mobile Rosina screenshots now
explicitly open the sheet (the first capture pass only resized a docked desktop panel).
All seven acceptance replies and the supplemental capture replies are preserved verbatim in
separate receipts; no unsupported availability or private cross-family disclosure observed.

Token-leak scan **PASS** for diagnosis, full acceptance and capture refresh: no current-token or
prefix matches, no new generic matches. Receipts list baseline filenames with pass/fail only.
No traces/HAR/video/storage state/request-header logging. Tokens stayed in browser/process memory.
Live proof explicitly uses router **4012**; the normal 4010 proxy still needs the delivered schema.

UI: **live-capable for delivered fields** · backend: **delivered reads available; field gaps remain** ·
integrated + tested: **delivered-read acceptance PASS; full W4 NOT DONE**. Pending: school-closure
day kind and event category/confirmer/links/holiday metadata read contracts; range overlap semantics;
Cast v2 four personas and Guide breadth; Village v2 live reads; Orbit screens after Task O; Task H
public judge access and Try FridgeGraph button; Group 5 reset/create-family. Read-contract gaps were
sent to Bentley; no field was invented. Draft #32 remains draft. GitHub currently reports conflicts
with concurrently newer main; no additional rebase/force push has been performed.

Supplemental live perspective switch: **PASS, 120 frames, zero private-content leaks** for actual
picker Kendra → Dana, with Calendar/Rosina/MC cleanup and bounded sample Village checked.
`current/isolation.json` retains its independent clean token scan. The first supplemental harness
attempt timed out because it waited for Calendar immediately after Dana's initial landing; the
navigation step was corrected, with privacy assertions unchanged, then rerun successfully.
Guide read-only screenshots were refreshed from the product UI without the test-only probe button.

Final local verification after the restored run: **206/206 web tests PASS**, web typecheck/build
PASS (existing chunk-size advisory only), root typecheck PASS; reservation-guard tests **3/3 PASS**;
seven-persona receipt audit and negative control PASS; shared catalog **7 identical ids PASS**;
staged secret scan **484 files / 0 findings**. All new browser scripts pass syntax checks. Changes
remain web/docs only. Publication after 729e824 uses a normal fast-forward push, not another force.

## Task R-TOOLS-2 — ChildEvents, EffectiveSchedule, AdultAvailability ENABLED + TESTED (2026-10-30)

Full detail and live transcripts: `docs/evidence/35-rosina-service.md` §12.

BRANCH: feat/rosina-tools-2; WORKTREE: /Users/user/Desktop/bentley/fridgegraph-rosina-tools-2
BASE: origin/main `2898043` (#30 R-LEAK and #34 R-TOOLS-1 both already merged — confirmed via
`gh api .../pulls/30,34 -q .merged` before branching; no premise contradiction this time).

**Premise mismatches found and adapted (reported, not forced):** the task described the fixture
Busy window as belonging to "Andre" on "the exact Tuesday." The real fixture
(`src/fixtures-simulated.ts`) has exactly one Busy window, and it is Kendra's (`p_mom`), on a
Wednesday (Nov 25). Adapted the live tests to use the real data directly (Kendra's own busy
window) and additionally proved the Andre/AdultAvailability case the task actually wanted via the
realistic discovery-chain path ("who has the child, and are they free" — `EffectiveSchedule` then
`AdultAvailability(p_dad)`, the id harvested from the first call).

**Shipped:**
- `src/rosina/model.ts`: `ChildEvents`, `EffectiveSchedule`, `AdultAvailability` added to
  `ALLOWED_MCP_TOOL_NAMES` (six tools total). New `permittedIds` set — seeded with the caller's
  own roster child(ren) plus their own verified `personId` — gates these three tools' child/
  person-id argument BEFORE the tool is ever called (`ID_ARG_BY_TOOL`). Grows via `harvestIds()`,
  which recursively collects every string under a key named `id` in any successful tool result,
  so a discovered id (e.g. `EffectiveSchedule`'s `parent.id`) becomes usable for a later call in
  the same turn. **Known limitation:** this does not re-order calls WITHIN one round, only across
  rounds — a cold, one-shot dependent question gets refused and the model must retry after a
  discovery call; proven directly by a dedicated test and observed once live (the Demo guide
  asking about Andre's availability cold, with no leak, just an imperfect refusal wording — see
  evidence for the exact transcript).
- `src/rosina/localTime.ts`: `TIMESTAMP_KEYS` extended to include `start`/`end` (ChildEvents/
  AdultAvailability's own time fields), same deterministic America/Detroit conversion.
- `src/rosina/systemPrompt.ts`: new CALENDAR/SCHEDULE section; `buildSystemPrompt` now also takes
  `selfPersonId` so "am I free" questions have an id to use at all (the caller's own, already
  verified by their own token — not a new disclosure). FREE/BUSY wording restriction, PROPOSED-
  vs-APPROVED distinction, and the three distinct required outcomes (refusal / authorized-empty /
  upstream-failure) are all explicit. New rule 11: id authorization is a hard boundary. Care/
  school/directory/Orbit bullets updated; Orbit explicitly named as permanently blocked (no
  suggest action exists either).

**Tests:** `npm run test:rosina` **33/33 PASS** (24 existing regressions, still green, + 9 new in
`src/rosina/calendarTools.test.ts`). `npm run check:rosina-catalog` PASS. `npm run check` PASS
(417 files, 0 findings). `npm --prefix web test` **168 PASS** (unchanged).

**Live, real alt-stack MCP + real Meta Spark 1.3 calls:** Kendra's Thanksgiving question, the
discovery-chain availability question, her own-id "am I free," and a calendar-window question all
answered correctly and grounded; Dana refused on Nora's child/calendar questions (zero names,
HTTP 200) but correctly got a genuinely-empty (not refused) answer for her OWN availability — the
third outcome, distinct from both; the Demo guide got the sandbox answer with no action
suggested. One environment anomaly recorded plainly: a cancelled-event fixture row, confirmed
present and RLS-readable via direct PostgREST, did not appear through `ChildEvents` on the
currently-shared alt-stack (which belongs to a different, further-ahead concurrent worktree) —
not a defect in this task's own code; the cancelled-exclusion behavior is still proven by the
unit test and by evidence 41's own existing proof.

BRANCH/WORKTREE as above.
TASK: enable ChildEvents/EffectiveSchedule/AdultAvailability in Rosina's allowlist with a
  pre-call id-authorization gate; distinct refusal/empty/failure wording; PROPOSED vs APPROVED;
  FREE/BUSY wording restriction.
LAYER: server (src/rosina/ only; no web/, schema, auth or DB change).
TOUCHED: src/rosina/model.ts, src/rosina/systemPrompt.ts, src/rosina/localTime.ts,
  src/rosina/calendarTools.test.ts (new), src/rosina/model.test.ts, src/rosina/jobTools.test.ts
  (buildSystemPrompt call-site signature change only), docs/evidence/35-rosina-service.md
  (append), this handoff.
DONE WHEN: npm run typecheck; npm run check; npm run check:rosina-catalog; npm run test:rosina
  (33/33); npm --prefix web test (168); live persona-boundary probes against the alt stack (not
  GraphOS) — all actually run above, not just described.
NOT DOING: schema/auth/DB changes, service-role reads (`seed:simulated` uses the project's own
  existing script and service-role key, not a new Rosina code path), mutation tools, enabling
  CheckInStatus/OrbitStatus/OrbitVocabulary (not on main yet, Orbit stays blocked regardless),
  merging.
BLOCKERS: none for this task. CarePlan, village-directory, and the three Orbit/check-in tools
  (once they land on main) remain the open follow-ups under "Rosina tools available" above.

**Final state (2026-10-30):** PR #37 head `703b7f5`. `gh pr ready 37` run; `gh pr view 37` →
`state: OPEN`, `isDraft: false`, `mergeable: MERGEABLE`, `mergeStateStatus: CLEAN`. Both CI
checks pass: `typecheck + secret scan` (15s), `web build` (20s). `git diff origin/main...HEAD
--stat` confirmed scoped to this task's own 8 files only. Not merged — Bryan merges.

## W4b — current-main merge (2026-10-30)

Bryan explicitly authorized merging origin/main into this feature branch with a merge commit.
Fetched **593e7944887309851d8d30bed89da5f5df13c87b** (#36 CareFact and #37 Rosina Group 3 tools).
Only HANDOFF conflicted: both W4b's complete session/cache/live evidence and Task R-TOOLS-2's
backend contract/proofs are retained in full. No session/cache implementation conflict; no backend
code was edited by this task. No history rewrite or force push. This is an authorized merge INTO
the feature branch, not a PR merge to main. Verification follows below.
Broader W4 dependencies stay separately PENDING and do not block this slice's review.

Shared-stack coordination: Bentley reserved/released the 22:12 window, then verified Rosina
4200 serving **593e794** from `fridgegraph-main`, MCP 5051. The prior process had loaded a
pre-#37 checkout; its owner reloaded current code and corrected the MCP target. No reset/seed or
subgraph/router change. The shared reservation reads **restored, verified** before this run.
Backend confirmation is in the shared checkout's reservation row; a stable read-only window was
confirmed by its owner. W4b runs through the real picker, never an ops login.

First post-merge run: picker/GraphQL/calendar/context checks passed, token scan passed, but Rosina
failed after the backend-owner reload. All first messages reached the UI's 401/manual-resend path;
follow-ups showed Busy. Exact receipts retained in `current/merge-interrupted-results.json`; this
is NOT a passing post-merge run. Shared HANDOFF still says restored; reported immediately to Bentley
for serving runtime/identity-mapping diagnosis. No credential/map file read or fallback login.
The receipt's overall `passed:false` and explicit errors govern; a care-row classifier was also
corrected so a session-resend message cannot be labeled a correct care refusal on future runs.

Bentley diagnosed and fixed the post-reload refusal in the owning runtime: the new serving worktree
had no identity map at its default cwd-relative path. He configured the existing map by runtime
path (no copy) and verified HTTP 200; MCP remains 5051. Shared HANDOFF's 22:20 row is explicitly
**restored, verified** before the new actual-picker acceptance run. No auth/backend code change,
map read, ops-login substitution, reset or seed by this task. Authorized merge commit **17259ec**
was pushed normally; GitHub now reports MERGEABLE. The interrupted run remains separately recorded;
it is an environment interruption, not relabeled as a pass. Final rerun results follow.

Restored post-merge browser assertions PASS (seven personas, context isolation, calendar/Rosina
consistency and exact Dana refusal). Its scanner flagged one *generic* marker in the refreshed
`jax-family-rosina-mobile.png`. Visual inspection shows no token; binary inspection confirms a PNG
with no JWT-shaped content. The flagged receipt is preserved as `merge-binary-review-results.json`;
it is not silently changed to green. A fresh full seven-session run follows against the inspected
baseline, retaining the same scanner and assertions. No token values/fragments were emitted.

An unchanged full retry stopped waiting 45 seconds for Loretta's visible Rosina reply; its leak scan
was clean and its partial receipt is retained as `merge-timeout-results.json`. A single actual-picker
Loretta diagnosis then returned **HTTP 200 / OK**, the correct care refusal, rendered in the UI,
with checking state cleared and a clean leak scan (`rosina-diagnosis.json`). Backend owner was asked
for safe outcome/latency evidence before classifying the isolated timeout. No timeout assertion was
weakened and no service failure is relabeled as a product pass.

Final post-merge full acceptance **PASS**: seven READY personas, Rosa Coming soon, zero assertion
errors; cross-context isolation PASS; exact per-operation boundaries and authorized-empty results
PASS; token-leak scan PASS. Receipt audit with forbidden-read negative control PASS. New #37
checks PASS: Rosina's Nov 26 answer matches Andre / approved arrangement, and Dana's Nora-calendar
request gets the exact no-name scoped refusal. Full replies retained verbatim in current/results.json.

The isolated 45-second wait timeout remains explicitly recorded, not claimed fixed: backend
completion ~5 s; isolated actual-picker HTTP 200/refusal/render PASS; instrumented unchanged full
flow PASS with no dropped-reply observation. No timeout increase, assertion removal, or production
workaround. The PNG generic finding was inspected; the unchanged full seven-session scanner now
passes against the inspected baseline. No actual token/prefix hits or new generic matches in this
final run. Desktop/mobile captures refreshed for all personas, calendar, timeline and live replies.

**W4b slice: UI complete · backend documented contracts complete · integrated + tested PASS.**
Broader W4 remains PENDING: Cast v2 personas/Guide breadth; Village live reads; read-contract
extensions (day kind/category/confirmer/links/holiday metadata/overlap semantics); normal 4010
schema reconciliation; Orbit UI; Task H/public judge access; reset/create-family services. These
do not block this completed slice's review, per Bryan's latest instruction. Final CI/readiness
publication follows; no PR merge is authorized or performed.

Final post-merge live switch audit: **PASS — 120 frames, zero private-content leaks**, independent
in-process token scan PASS. Stable window released to Bentley after all browser runs completed.
All browser runs used the actual picker and existing runtime services; no reset, seed, auth/schema
change, token copy, traces/HAR/video or automatic message/mutation replay by this task.

Verification for current-main reconciliation: **206/206 web tests, 33/33 Rosina tests PASS**;
root typecheck and web typecheck/build PASS (existing bundle advisory); reservation guard **3/3**;
catalog **7 identical ids**; final staged secret scan **499 files / 0 findings**. Final full live
acceptance, receipt audit, frame audit and in-process token scans PASS as recorded above. Own diff
against main is web/docs only; both CI checks passed on merge commit 17259ec. Final evidence commit
will be pushed normally and checked in CI before marking #32 ready, as Bryan authorized.
## Task R-ORBIT — Rosina's side of Orbit: notice -> suggest -> gather -> preparation card, never activate (2026-10-31)

Full detail and live transcripts: `docs/evidence/35-rosina-service.md` §13.

BRANCH: feat/rosina-orbit; WORKTREE: /Users/user/Desktop/bentley/fridgegraph-rosina-orbit
BASE: origin/main `593e794` (#33 Orbit Alert minimal slice and #37 R-TOOLS-2 both merged —
confirmed via `gh pr view 33,37 --json state,mergedAt` before branching).

**Premise mismatch found and reported (not hidden):** the task listed PR **#35** ("Orbit
vocabulary through the API") as a merged prereq. `gh pr view 35` shows it is still `OPEN`.
Diffed its branch against `origin/main` at the fork point: its unique content
(`ops/OrbitVocabulary.graphql`, migration `0038_orbit_vocabulary_read.sql`, the `orbitVocabulary`
resolver) is already present on `main` — it landed folded into #33 or #37's merge, not through
#35 itself. The actual dependency (OrbitVocabulary live and callable) is functionally satisfied,
confirmed directly against the live alt-stack MCP before proceeding. #35 is likely safe to close
as superseded, but that is Bentley's call, not this task's — flagged here, not closed.

**Shipped:**
- `src/rosina/orbit.ts` (new): `validatePrepareOrbitAlert` (parent authority via a same-turn
  successful `CheckInStatus` call — it throws `UNAUTHORIZED` for non-parents, so success is proof;
  vocabulary membership checked per descriptor KIND, not just presence anywhere in the list; never
  invents an unsupplied field) and `isCheckInOverdue`/`checkInStatusFrom`/`injectOverdueFlag`
  (server-computed `overdue` against the real clock, injected before the model ever sees the
  result; never inferred from `recorded: false` alone).
- `src/rosina/model.ts`: `CheckInStatus`/`OrbitStatus`/`OrbitVocabulary` added to
  `ALLOWED_MCP_TOOL_NAMES` (nine tools total); `verifiedParentOf`/`vocabularyByKind` turn-scoped
  sets; `prepareOrbitAlert` action calls run the full semantic gate regardless of the catalog's
  `implemented: false` flag (so the gate is already correct and tested for when that flag flips)
  but are NEVER added to the response's `actions` — `implemented: false` is unconditional.
- `src/rosina/systemPrompt.ts`: new `proposeAction_prepareOrbitAlert` tool + `ORBIT (CHECK-IN /
  FIND-MY-KID)` prompt section covering notice/suggest/gather/card/photo/while-active wording, all
  exactly as specified (notice: "hasn't been recorded," never "missing"/"in danger"; suggest:
  exact sentence, only when asked or genuinely overdue; gather: vocabulary-only, a place or
  unlisted value gets a clarifying question). One field-shape correction made against the real
  schema (see evidence §13): `OrbitStatus` (the type Rosina's tool actually returns) has no
  per-member `outcome`/`SIMULATED` field — that lives on a different type (`OrbitAlert.audience`)
  Rosina's tool doesn't query. Wrote the "never claim delivery" rule around the field that
  actually reaches the model instead (`notifiedCount`, a count — simulated bookkeeping, not proof
  of delivery). Removed the stale `BLOCKED_TOPICS` "never suggest activating Orbit" bullet — Orbit
  is no longer blocked outright, only activation is (and that remains structurally impossible: no
  activate tool exists or is exposed anywhere).
- Catalog (`web/src/features/rosina/catalog.ts` + `src/rosina/catalog.ts`, kept in sync): new
  `prepareOrbitAlert` entry, `implemented: false`, no location-shaped field. `ops/rosina-catalog-
  drift.mjs`'s id regex widened to accept camelCase (the task's own literal id breaks this repo's
  kebab-case convention on purpose).

**Tests:** `npm run test:rosina` **53/53 PASS** (33 existing regressions, still green, + 20 new in
`src/rosina/orbit.test.ts`). `npm run check:rosina-catalog` PASS (8 ids, up from 7). `npm run
check` PASS (453 files, 0 findings). `npm --prefix web run build` PASS; `npm --prefix web test`
**168 PASS** (unchanged).

**Live, real alt-stack MCP + real Meta Spark 1.3 calls:** Kendra proven end-to-end up to the
preparation card — a routine question triggers no Orbit tool; an overdue check-in (one additive,
announced, cleaned-up-after test fixture row was needed, since the permanent fixture's due time
had not yet passed in real time) produces the exact notice/911/suggest wording in one turn; a
valid vocabulary-mapped gather reaches `prepareOrbitAlert`, passes its own gate cleanly, and is
still correctly and honestly refused as not-yet-available; an unmapped place/color gets a
clarifying question with nothing in any card. Loretta (non-parent, in-scope) gets a real
backend-`UNAUTHORIZED` refusal for `CheckInStatus` (attempted, not leaked) and her own empty
`OrbitStatus` view. Dana (out-of-scope child entirely) gets the scope refusal with zero tool
calls for both check-in and Orbit questions. One model-variance timeout recorded plainly (Loretta
attempting to trigger a card): no leak, no card, in either of two runs — not chased further.

BRANCH/WORKTREE as above.
TASK: enable CheckInStatus/OrbitStatus/OrbitVocabulary; add a correctly-gated but
  catalog-disabled `prepareOrbitAlert` preparation card; notice/suggest/gather prompt behavior;
  never activate.
LAYER: server (src/rosina/ + shared catalog mirror in web/src/features/rosina/catalog.ts + the
  drift-check regex; no schema/auth/DB change).
TOUCHED: src/rosina/orbit.ts (new), src/rosina/orbit.test.ts (new), src/rosina/model.ts,
  src/rosina/systemPrompt.ts, src/rosina/catalog.ts, web/src/features/rosina/catalog.ts,
  ops/rosina-catalog-drift.mjs, docs/evidence/35-rosina-service.md (append), this handoff.
DONE WHEN: npm run typecheck; npm run check; npm run check:rosina-catalog; npm run test:rosina
  (53/53); npm --prefix web run build; npm --prefix web test (168); live notice/suggest/gather/
  card + Loretta/Dana boundary probes against the alt stack (not GraphOS) — all actually run
  above, not just described.
NOT DOING: schema/auth/DB changes (the one fixture row used for the live overdue test was
  additive, announced, and deleted by its exact id when done), any mutation tool, enabling or
  implementing `prepareOrbitAlert` beyond the gate (Codex's app handler is a separate
  dependency), closing PR #35, merging.
BLOCKERS: `prepareOrbitAlert` needs Codex's app-side draft/preview/confirm handler before it can
  ever actually render to a user — tracked here, not solved here. PR #35 should probably be
  closed as superseded by Bentley, not by this task.

**Final state (2026-10-31):** PR #38 head `59c8bf1`. `gh pr ready 38` run; `gh pr view 38` →
`state: OPEN`, `isDraft: false`, `mergeable: MERGEABLE`, `mergeStateStatus: CLEAN`. Both CI
checks pass: `typecheck + secret scan` (21s), `web build` (21s). `git diff origin/main...HEAD
--stat` confirmed scoped to this task's own 9 files only. Not merged — Bryan merges.

### W4b — concurrent main advance (#38)

Main advanced during verification to **a88d613** (Task R-ORBIT #38). Bryan's current-main merge
instruction is applied again with a merge commit and normal push. Only HANDOFF conflicts; both
workstreams are retained. Catalog auto-merge inspected: the new prepareOrbitAlert entry remains
**implemented:false**, changesData:true and is dropped before rendering; W4b calendar validation,
read-only checks and session/cache protections remain intact. No Orbit UI or backend edits by
this task. Offline and affected live verification will be rerun before readiness.

#38 merge verification: **206/206 web tests, 53/53 Rosina tests PASS**; root typecheck, web
build/typecheck, catalog **8 identical ids**, secret scan **501 files / 0 findings** PASS. New
Orbit action stays unimplemented and is dropped before rendering; no Orbit handler added here.
The shared Group 4 pieces 1–3 reservation is currently IN PROGRESS, so no further live requests
are made until explicit restoration. The #38 affected live check is limited to existing seven
persona Rosina flows, current tool grounding, calendar/boundary follow-ups and catalog gating;
GraphQL schema/session/cache code did not change in #38. Existing full graph/isolation proof is
retained. Newly seeded Cast v2 identities, if any, are a separately pending broader-W4 integration,
not forced into the earlier Coming-soon fixture expectation.

### W4b — all eleven READY (Bryan's updated live state)

Cast v2 is seeded in the shared runtime. **Actual picker checks PASS for all eleven personas**,
including Rosa/Felicia/Simone/Dwayne, with fresh desktop/mobile picker + landing captures and a clean
eleven-session token scan (`current/picker-ready.json`). Live scripts no longer expect Coming soon
for these seeded identities. UNAVAILABLE remains tested through controlled response fixtures in
liveAuth/livePicker unit tests. Expanded Cast v2 private-read/Rosina breadth remains separately
PENDING; picker readiness is not claimed as that integration.

#38 scoped Rosina run stopped on a newly added wording matcher. Captured Jax reply, verbatim:
“Evelyn Carter is authorized to pick up Jax today.

The pickup records show her as authorized for today, with no availability recorded — authorization
is permission, not a promise she is free.”
Actual tool result: AUTHORIZED / UNKNOWN. The reply preserves the distinction; the matcher only
recognizes “unknown”, “not recorded”, “not confirmed”, “can't confirm” and wrongly rejects “no
availability recorded”. `current/main38-matcher-failure.json` preserves the failing assertion and
reply; no result is relabeled. Under AGENTS §1.4 the check is stopped; Bryan was asked to authorize
correcting this new matcher with a negative control rejecting confirmed-availability claims.
Matcher is unchanged pending that reply. Independent all-eleven picker checks completed meanwhile.
Current #32 remains draft until this specific acceptance gate is resolved; CI on db6938d is green.

QUEUE: **W-ORBIT — the Orbit browser flow is next AFTER Bryan merges #32**, on its own task branch.
No Orbit handler or activation UI is built here; prepareOrbitAlert remains implemented:false.

All-eleven verification publication: controlled UNAVAILABLE tests remain unchanged; live Coming-soon
expectations removed. Final staged scan **506 files / 0 findings**. Current read-only window explicitly
released to Bentley after independent checks completed, with the stopped matcher gate reported.
No more live requests until a new coordinated window if needed. #32 remains draft pending Bryan's
specific authorization; no PR merge. W-ORBIT remains queued after #32 is merged.

### W4b — authorized wording correction (append-only result)

Bryan explicitly approved correcting the new acceptance matcher. The original failed receipt
`current/main38-matcher-failure.json` remains unchanged and still says passed:false. The regression
test reads that exact reply and source records, rather than rewriting the receipt. “No availability
recorded” now means absent records only. Independent rejection checks prevent an uncertainty
sentence from masking “nobody is available”, a positive availability claim for an UNKNOWN candidate,
or a FREE → confirmed-willingness conclusion (including “so”, “therefore” and “because” variants).
Recorded availability remains distinct from willingness; explicit “FREE does not mean willingness”
wording remains valid. This is a bounded acceptance-language check, not a source of new facts.

Red/green verification: the old matcher failed **5 of 6 groups**; corrected matcher **6/6 PASS**,
including the exact preserved receipt and negative controls. Client production code and backend
contracts are unchanged. The live capture uses the same tested helper. Further results follow;
no earlier failure is relabeled as green.

Final authorized correction verification: **7/7 matcher groups PASS**, including the exact original
failed receipt and negative controls for absent-record “nobody available” claims (even without a
candidate row), unsupported positive availability, and FREE → confirmed willingness/can-help
conclusions. The additional controls were also observed failing before the final fix. All five
current grounded live replies pass an offline audit against the final helper. No earlier receipt
is modified or relabeled.

Affected current-main live acceptance **PASS**: seven scoped Rosina flows, names/availability
grounded in current tool results, Kendra calendar consistency, exact Dana private-calendar refusal,
unimplemented Orbit card blocked, all eleven READY picker paths, desktop/mobile captures, and
clean in-process token scan. Receipt: current/rosina-captures.json; independent eleven-picker proof:
current/picker-ready.json. Explicit completion/release sent to Bentley; no additional live requests
or resets/seeds/restarts/checkout switches by Codex.

Rechecked: **206/206 web tests, 53/53 Rosina tests**, root typecheck, web typecheck/build, catalog
**8 ids** and reservation guard **3/3 PASS**. W4b slice: **UI complete · backend documented reads
complete · integrated + tested PASS**. Broader W4 dependencies remain PENDING and do not block
review. Proceed with normal push, final-head CI, and mark #32 ready as Bryan authorized. Never
merge. W-ORBIT remains queued AFTER #32 is merged by Bryan.
Final staged secret scan after the authorized correction: **508 files / 0 findings**.
## Task R-CARE — CareFacts ENABLED + TESTED (2026-10-31)

Full detail and live transcripts: `docs/evidence/35-rosina-service.md` §14.

BRANCH: feat/rosina-care; WORKTREE: /Users/user/Desktop/bentley/fridgegraph-rosina-care
BASE: origin/main `a88d613` (#36 Group 4 CareFact and #38 R-ORBIT both merged — confirmed via
`gh pr view 36,38 --json state,mergedAt` before branching).

**Live premise verified before building on it (not assumed):** the task's own CONTEXT line said
Priya now holds `careplan.read` on both Nora and Malik. Confirmed directly against the shared
alt-stack MCP (read-only) before writing any code: real, non-empty `CareFacts` results for both,
`[]` for Emma. This became load-bearing — see the roster gap below.

**A real gap this premise exposed:** `src/rosina/roster.ts#scopedRoster` maps each caller to
exactly ONE child (from `src/demo/personas.ts`, which also backs the web demo-login response and
was deliberately left untouched). Left alone, this would have silently broken the task's own
required Priya/Malik scenario twice: the pre-call id gate would refuse `CareFacts(p_malik)`
before it ever reached MCP, and — even if it had reached MCP — the output guard would have
replaced the whole reply the moment the model said "Malik," since `CareFacts`'s own response
shape carries no human name anywhere (`verifiedBy` is a bare id) and "Malik" is in neither
Priya's roster nor any tool-result text this turn. Fixed with a new, narrow, CareFacts-ONLY
supplement: `src/rosina/roster.ts#careOnlyChildren` — one explicit entry (`p_priya -> Malik`)
unioned into `permittedIds` and the output guard's roster argument, never into the general
roster used by any other tool (Priya's real grant is care-plan only; she still has no standing
for Malik's schedule, pickups, or anything else).

**A second design question CareFacts' own "no oracle" shape raised:** the task's Priya/Emma
example wants the SAME graceful "I can't see a recorded rule for that" (not the generic scope
refusal) for a care question about a child she has no grant for. Since Priya has no known id for
Emma at all, the model can't call the tool for her without inventing an id (forbidden). Solved as
a prompt-only rule: for CARE questions specifically, an out-of-roster child gets the graceful
empty-result sentence instead of rule 9's refusal — narrowly scoped to care topics only, verified
live that the same out-of-scope child still gets the ordinary harsh refusal for any other kind of
question.

**Shipped:**
- `src/rosina/roster.ts`: new `careOnlyChildren(personId, isGuide)` (see above).
- `src/rosina/model.ts`: `CareFacts` added to `ALLOWED_MCP_TOOL_NAMES` (ten tools total);
  `ID_ARG_BY_TOOL.CareFacts = 'childId'`; `permittedIds` and the output guard's roster both union
  in `careOnlyChildren(...)`. No new verified-id set needed — RLS alone decides visibility.
- `src/rosina/systemPrompt.ts`: new `CARE FACTS` section (answer only from `value`; cite
  `source.ref` directly, never `source.kind`'s code or a bare `verifiedBy.id`; CONFIRMED vs
  PROVISIONAL are distinct sentences; the empty-result sentence doubles as the narrow care-
  specific non-answer described above). Removed care/snack/allergy from the `still NOT
  connected` list; school and village-directory remain blocked. `buildSystemPrompt` gained an
  optional fourth `careRoster` parameter, default `[]` (every existing call site/test unchanged).

**Tests:** `npm run test:rosina` **66/66 PASS** (53 existing regressions, still green, + 13 new
in `src/rosina/careFacts.test.ts`). `npm run check:rosina-catalog` PASS (8 ids, unchanged — no
catalog/action touched). `npm run check` PASS (455 files, 0 findings). `npm --prefix web run
build` PASS; `npm --prefix web test` **168 PASS** (unchanged).

**Live, real alt-stack MCP + real Meta Spark 1.3 calls, inside Bentley's read-only window (no
reset/seed/restart/checkout-switch; told explicitly when done):** Kendra and Dwayne each get
their own child's cited, confirmed snack rule; Priya gets BOTH Nora's and Malik's correctly
(Malik's name reaching the reply without tripping the output guard — the actual proof the roster
fix worked); Priya asking about Emma (no grant) gets the graceful care-specific sentence, no
names, no tool call attempted; Dana's own child (genuinely empty) gets the identical wording by
design; Dana asking about Nora gets the same graceful sentence for a care question but the
ordinary harsh refusal for a non-care question about the same child; the Demo guide sees sandbox
facts read-only.

BRANCH/WORKTREE as above.
TASK: enable CareFacts; answer snack/TV/bedtime/allergy/routine questions with source citation
  and CONFIRMED/PROVISIONAL distinction; fix a real roster gap a live multi-child grant exposed.
LAYER: server (src/rosina/ only; no schema/auth/DB change, no web/ file touched).
TOUCHED: src/rosina/roster.ts, src/rosina/model.ts, src/rosina/systemPrompt.ts,
  src/rosina/careFacts.test.ts (new), docs/evidence/35-rosina-service.md (append), this handoff.
DONE WHEN: npm run typecheck; npm run check; npm run check:rosina-catalog; npm run test:rosina
  (66/66); npm --prefix web run build; npm --prefix web test (168); live CareFacts probes for
  Kendra/Dwayne/Priya/Dana/Demo-guide against the alt stack, inside Bentley's window — all
  actually run above, not just described.
NOT DOING: schema/auth/DB changes, any db:reset/seed/restart/checkout-switch (read-only window),
  any mutation tool, any new catalog action/card, broadening Priya's general roster (care-plan-
  only grant stays care-plan-only), touching src/demo/personas.ts, merging.
BLOCKERS: none for this task. The `MyChildren`/grants-by-caller MCP read that would replace
  `scopedRoster` would also replace `careOnlyChildren` — still not shipped.

**Final state (2026-10-31):** PR #42 head `3bf8fb0`. `gh pr ready 42` run; `gh pr view 42` →
`state: OPEN`, `isDraft: false`, `mergeable: MERGEABLE`, `mergeStateStatus: CLEAN`. Both CI
checks pass: `typecheck + secret scan` (19s), `web build` (27s). `git diff origin/main...HEAD
--stat` confirmed scoped to this task's own 6 files only. Not merged — Bryan merges.

### W4b — #42 current-main reconciliation

Main advanced to **344595b** (#42 CareFacts) during final verification. Merged into this feature
branch under Bryan's standing merge-commit instruction; only HANDOFF conflicted, both workstreams
retained. No frontend or POST /api/rosina response-contract change in #42. Current completed browser
acceptance explicitly used the coordinated serving process at a88d613; no restart was requested or
performed. #42's newly enabled CareFacts behavior is not claimed as live-proven by that receipt.
Its own upstream proofs remain intact; broader service rollout is separate from this completed
frontend slice. Offline verification is rerun on the reconciled tree before readiness.
Final reconciled-tree verification after #42: **206/206 web tests, 66/66 Rosina tests, 7/7 matcher
groups PASS**; root typecheck, web typecheck/build, catalog **8 ids**, prior reservation guard **3/3**
PASS. Final matcher also rejects a bare nobody-available claim when there are no candidate records;
its current captured live-reply audit passes unchanged. Staged secret scan **509 files / 0 findings**.
Original main38-matcher-failure.json has no diff. No frontend backend-contract change from #42;
its newly enabled care-answer behavior is not attributed to the earlier a88d613 live receipt.

### W4b — ready for review (verified publication)

`gh pr ready 32` succeeded after both CI checks passed on **c60975c**. GitHub reports #32 OPEN,
isDraft:false and MERGEABLE. Authorized correction, preserved failed receipt, all negative controls
and affected live acceptance are complete; broader W4 dependencies remain separately PENDING.
This documentation follow-up is pushed normally; final-head CI/status are reported in the user
response and the PR. No PR merge. W-ORBIT begins only after Bryan merges #32; do not start it on
this worktree/branch or infer that READY means merged.
