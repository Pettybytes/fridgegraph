# Hosting execution plan — public app origin (PLAN ONLY)

**Status: PLAN ONLY. Nothing in this document has been executed, deployed or exposed.**
No public hostname exists yet. No router, tunnel, launchd or migration change has been made.

Companion to `docs/handoff/hosting-window-plan.md` (the analysis, #145/#149). That document explains
*why*; this one is the ordered, checkable runbook with exact pinned artifacts, commands, timings,
stop rules and rollback. Where the two disagree, this one wins only after the analysis is corrected.

Base measured at `origin/main` **`00dbc1d173ad4e78f7492c86c0f62b6ee92fd85b`** on 2026-11-03.

**Two phases, two separate goes.** Everything in §1–§12 is Phase 1 (core app). §13 is Phase 2 —
judge voice and SMS outreach — on the *same public origin*, and it does not run until Bryan gives a
second, explicit go. Voice and outreach are excluded from Phase 1 only because they are not yet
deployable, not because they are unwanted.

---

## 0. Pinned artifacts (record these, never "latest")

| Artifact | Pin | Verification |
| --- | --- | --- |
| Serving code (Phase 1) | `bbe11a4c4da51fd47b5c37fc64c510753193775b` | `git rev-parse HEAD` in each worktree |
| Web source | `00dbc1d173ad4e78f7492c86c0f62b6ee92fd85b` | the web build below is built from this commit |
| Web build | `/Users/user/fridgegraph-web/00dbc1d/web/dist` | index `1b20467c66e0d901d46b3ec21f1b0b9432a468a8766be47ebf79ecfce048a8fa` |
| Web entry JS | `assets/index-DzmuUm4e.js` | `e67bc917454c1883604dae20c917ecef6974776ec12799e67d3d33d8e00774af` |
| Web entry CSS | `assets/index-BRbs-wFN.css` | `c3558ad7ef91d53089700c9c206c3a38896951f3e38d931bdaa22349ee02f175` |
| Whole-dist tree | — | `e068f201bc30e67960bf8c01a40f4378c2f3e32425b42a223f349a9eedb676b4` |
| Web build flags | `VITE_FRIDGE_EDITING_VERIFIED=false`; notice-plan / add-villager / village-map live **empty** | dist contains no `VITE_` string; ConnectedFridge chunk has `enabled:!!i||!1` |
| Router prod config | **new** `router.prod.yaml` (does not exist at this pin) | hash recorded when written |
| Composed supergraph | `.runs/supergraph.graphql` produced in-window | hash recorded; recomposed, never reused |
| Migration 0086 | `supabase/migrations/0086_availability_view_hardening.sql` | `c709405813a7de47e99277160174da5099820f1df049172be2b76e21b4c77b6e` |
| Demo cast checksum | `f022ccf8311e7561` | `node ops/stack-health.mjs` |

**Why the backend is older than the web build.** `00dbc1d`'s `src/demo/reset.ts` and
`src/subgraphs/coordination.ts` call `invite_budget_reserve` / `invite_budget_settle` from **0085**
and reference **0084** staged tables. Neither is applied live, and `bbe11a4` does not contain them, so
serving `00dbc1d` as the backend would fail at those call sites. Phase 1 therefore runs **backend
`bbe11a4`** with **web `00dbc1d`**, and `router.prod.yaml` must be proven against the **`bbe11a4`**
subgraphs — recomposed in-window, never reused from this analysis. Moving the backend to `00dbc1d` is
a later window, after 0084/0085.

**Re-pin before the window.** The web pin above cannot contain P-1 (voice flag), P-3 (static server) or
P-10 (login limiter). Once those land, rebuild from the new commit, record the new index and whole-dist
hashes, and replace `00dbc1d` everywhere in this document. A plan that pins a commit without its own
prerequisites is a plan for a build that cannot exist.

---

## 1. Prerequisite changes that must be merged BEFORE the window

These are small, separately reviewed and separately proven. **If any is not merged, do not open the
window** — do not "work around" them in a deploy script.

**P-1 — voice controls must be off by configuration — merge first.** `RosinaVoiceButton` is rendered
unconditionally and its failure mode when `/voice/*` is absent is an error after the user taps.
Required: a build-time `VITE_VOICE_LIVE` (default off) that removes the mic and hands-free controls,
leaving the text composer as the stated alternative. Without it, excluding `/voice/*` leaves a broken
control, not an unavailable one.

**P-2 — P-10: fix the login limiter to the trusted proxy IP.** `POST /api/demo/login` currently keys
its per-IP window on `req.ip ?? req.socket.remoteAddress`, and `trust proxy` is set nowhere, so behind
cloudflared every judge shares one 60/min bucket. Required change: reuse the existing
`resolveClientIp()` (as reset already does) for login. It is safe to trust `X-Forwarded-For` here for
one reason only — **4008 binds `127.0.0.1`, so the only peer that can reach it is the tunnel**. If 4008
were ever bound broadly, the header would become attacker-controlled and the per-IP limit would become
meaningless. Verify with L6/L7 in §5 and record the effective numbers.

**P-3 — the static server exists and is reviewed.** `ops/` has no static server today; `vite preview`
is serving. Spec in §3. It must be a reviewed file before the window, not written inline into a shell
history.

**P-4 — the guide/exposure surface is unchanged.** No removal of the UI guide guard, no widening of
RLS, no grants added to `anon`/`authenticated` to make a screen render.

**P-5 — rotate three secrets before exposure, in this order.** Each goes in through
`ops/set-env-secret.sh NAME` (hidden prompt, value never in argv, logs or an agent's context):
`GHL_API_KEY` (rotated in GHL, then re-exported into the n8n credential), the **Supabase database
password** (rotated in the project, then `SUPABASE_DB_URL` updated), and `FG_GHL_ACTION_TOKEN`.
Then: restart **only the services that read each value** (4118/4200/4001–4008 as applicable — not the
whole stack), re-run `node ops/stack-health.mjs` plus the consumer reads, and record **the names and
the rotation time, never the values**. A rotation that is not followed by a health pass is untested;
a rotation recorded with a value is a leak.

---

## 2. Window shape and timing

| Phase | Work | Expected |
| --- | --- | --- |
| 0 | Preflight measurement, reservation posted | 10 min |
| 1 | Publish durable web build to `5189` via the static server | 10 min |
| 2 | Write + start `router.prod.yaml`, prove the five gates | 30 min |
| 3 | Dashboard tunnel routes applied by hand | 10 min |
| 4 | Demo origin allow-list + limit verification through the public origin | 15 min |
| 5 | Supervision (launchd), recovery proof, duplicate-listener proof | 25 min |
| 6 | Validation battery against the public URL | 30 min |
| — | **Total** | **~2 h 10 m** |

One window, one agent. Codex and any capture harness hold live requests for the duration.

---

## 3. Phase 1 — stack-owned static server replaces `vite preview`

`vite preview` is a development convenience: it is not supervised, has no method allow-list, and its
SPA fallback is incidental. Replace it with a stack-owned server that serves the **pinned durable
build**.

**`ops/serve-web.mjs` (P-3), spec:**

- binds **`127.0.0.1:5189`** only — never `0.0.0.0`;
- root = the directory given by `WEB_ROOT`, validated to be an existing directory containing `index.html`;
- methods `GET` and `HEAD` only; anything else → `405` with `Allow: GET, HEAD`;
- path normalisation **before** filesystem access: decode, collapse, reject any segment `..`,
  reject NUL, reject absolute escapes; a resolved path outside root → `403`;
- static files served with `Content-Type` from a fixed extension map; unknown extensions → `application/octet-stream`;
- `/assets/*` → `Cache-Control: public, max-age=31536000, immutable` (content-hashed filenames);
  `index.html` and every SPA fallback → `Cache-Control: no-store`;
- SPA fallback: a path with **no extension** that is not a file → `200 index.html`; a path with an
  extension that is not a file → `404` (so a missing asset never returns HTML);
- no directory listing, no dotfile serving, no write methods, no proxying of its own;
- `SIGTERM` → close listener, exit 0.

**Commands:**

```bash
cd /Users/user/fridgegraph-web/00dbc1d
WEB_ROOT=/Users/user/fridgegraph-web/00dbc1d/web/dist \
  nohup node ops/serve-web.mjs --port 5189 > /Users/user/fridgegraph-web/00dbc1d/serve-5189.log 2>&1 &
sleep 2
lsof -nP -iTCP:5189 -sTCP:LISTEN        # exactly one PID, 127.0.0.1
curl -s localhost:5189/ | shasum -a 256 # must equal 1b20467c…
curl -s -o /dev/null -w '%{http_code}\n' localhost:5189/assets/index-DzmuUm4e.js   # 200
curl -s -o /dev/null -w '%{http_code}\n' localhost:5189/nope.css                   # 404, not HTML
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:5189/                   # 405
```

**Pass:** served `index.html` hash equals the built hash; `/nope.css` is 404; `POST` is 405.

**But:** `vite preview` also provided the dev proxy (`/graphql`, `/api/demo`, `/api/rosina`, `/voice/`).
The static server must **not** proxy those; behind the tunnel they are routed by the public edge to
their own services (§4). Locally after the swap, `/graphql` and `/api/*` on 5189 will 404 **by design**
— the public origin is the only place they exist. State this in the receipt so a later reader does not
report it as a regression.

**5190 is local-only and has no public route.** It exists for local click-through and
app-vs-routing triage; the edge must never point at it.

**Keep a working local app: 5189 is the artifact, 5190 is the workbench.** Alongside the static server,
keep one `vite preview` instance on **`127.0.0.1:5190`** serving the *same pinned build* with its API
proxy intact. It preserves local click-through with live data when the edge is not involved, and it is
the fastest way to separate an app bug from a routing bug: if 5190 works and 5189 does not, the fault is
in the static server or the edge. Rollback is one line each. Record both PIDs and both commands.

---

## 4. Phase 2/3 — one public origin, explicit route allowlist

**One origin.** `https://<app-host>` serves the app *and* fronts the API paths. One origin means no
CORS surface between app and API, and the router is never independently reachable.

**Route allowlist — the edge admits exactly these, everything else 404:**

| Path | Target | Why it is here |
| --- | --- | --- |
| `/` , `/index.html` | static `5189` | app shell |
| `/assets/*` | static `5189` | JS/CSS/portraits/maplibre worker (content-hashed) |
| `/favicon.svg`, `/icons.svg` | static `5189` | shell assets referenced by `index.html` |
| `/fridge/*` | static `5189` | family pack images, fonts, samples (`/fridge/packs/ellison/*`) |
| `/samples/*`, `/invites/*` | static `5189` | fixture art referenced by the app |
| `/graphql` | `127.0.0.1:4010` (`router.prod.yaml`) | every read and the app's only API |
| `/api/demo/login` | `127.0.0.1:4008` | judge entry |
| `/api/demo/health` | `127.0.0.1:4008` | picker readiness |
| `/api/demo/reset` | `127.0.0.1:4008` | reset semantics (#149) |
| `/api/rosina` (exact) | `127.0.0.1:4200` | Ask Rosina **text** turns |
| `/api/village/day` (exact) | `127.0.0.1:4008` | bearer-checked day reads for the map |
| `/api/village/route` (exact) | `127.0.0.1:4008` | bearer-checked road route / ride calculation — **calls a paid provider (ORS)** |
| `/api/orbit/photo/:photoId` (exact pattern) | `127.0.0.1:4008` | bearer-checked Orbit photo read |

**Explicitly 404 at the edge — not "unrouted", actively refused:**

`/voice/*` · `/api/rosina/invite` · `/api/rosina/photo-descriptors` · `/api/rosina/notice-plan*` ·
`/api/village/*` · `/api/orbit/photo/*` · `/api/demo/family` · `/api/demo/voice-note/*` ·
everything on `4001–4007`, `4101–4107`, `5051`, `8090`, `8092`, `4118`.

**The map stays ON.** The map, recorded locations, route/ride calculations and Orbit photos are part
of the demo, so each is admitted as an **exact path with its own bearer check** — never a prefix.
`/api/village/route` also calls a paid routing provider, so it carries its own limit:

| Route limit | Value |
| --- | --- |
| `/api/village/route` per demo session | **20 / hour**, **60 / hour** per person as the backstop |
| `/api/village/day` per demo session | **120 / hour** |
| `/api/orbit/photo/:photoId` per demo session | **120 / hour** |

These counts feed **V5** ("no stray spend") alongside the voice and Spark numbers: a route call is a
provider call even though it is not an LLM call.

**Invitations** still show the service as unavailable because `/api/rosina/invite` is refused — the
intended state, and the panel already renders that refusal honestly.

**Tunnel mechanics.** cloudflared runs in **token mode**; ingress lives in the Cloudflare dashboard,
not on disk. There is nothing to diff, so the table above is the source of truth and is applied by
hand. **No wildcard route.** No route may point at a port not in the table.

**`router.prod.yaml`** — new file; the dev configs are untouched:

```yaml
supergraph:
  listen: 127.0.0.1:4010
  introspection: false
health_check:
  enabled: true
  listen: 127.0.0.1:8090
include_subgraph_errors:
  all: false
sandbox:
  enabled: false
homepage:
  enabled: false
authentication:
  router:
    jwt:
      jwks:
        - url: "${env.SUPABASE_JWKS_URL}"
          issuers: ["${env.SUPABASE_URL}/auth/v1"]
          audiences: [authenticated]
          algorithms: [ES256]
      header_name: Authorization
      header_value_prefix: Bearer
      on_error: RedactedError
cors:
  origins: ["https://<app-host>"]     # the ONE public origin, literal
  allow_credentials: true
  allow_headers: [authorization, content-type]
  methods: [GET, POST, OPTIONS]
headers:
  all:
    request:
      operations:
        - propagate:
            named: Authorization
```

**Gate proofs — run against the bytes that will be served, and record each separately:**

| Gate | Command | Pass |
| --- | --- | --- |
| 1 redaction | `POST /graphql` with a malformed bearer | no validation detail, generic `AUTH_ERROR` |
| 2 introspection | introspection query | refused |
| 3 explorer/homepage | `GET /` in a browser | no explorer, no homepage |
| 4 subgraph detail | force a subgraph failure | generic message, no stack/trace |
| 5 CORS | `curl -H 'Origin: https://evil.example' -i` | **no** `access-control-allow-origin` |
| 5 CORS | `curl -H 'Origin: https://<app-host>' -i` | exact origin echoed, credentials allowed |

A bare status code is not a pass. Gate 1 and 4 must be judged from the **response body**.

---

## 5. Phase 4 — demo exposure on the public origin

**`DEMO_ALLOWED_APP_ORIGINS=https://<app-host>`** on the 4008 process. The parser (`src/demo/origins.ts`)
accepts only bare `https://` origins, rejects wildcards/`null`/credentials/paths, and compares parsed
origins exactly. Localhost stays allowed by design.

`NODE_ENV` must **not** be `production` on 4008 — `startDemoLogin()` returns false and the endpoint
disappears. Record the observed value.

**Phase 1 uses the limits as deployed.** New session-keyed accounting is explicitly deferred: do not
assume a `jti` claim exists or is unique per browser. Two independent Kendra contexts must be exercised
under whatever limits the running 4008 actually enforces, and the observed numbers are recorded.

**Verify the effective limits, not the constants** (each result recorded separately):

| # | Check | Pass |
| --- | --- | --- |
| L1 | login as `kendra` through the public origin | `READY` + session |
| L2 | login with unknown persona | `UNAVAILABLE` / `UNKNOWN_PERSONA`, **no token** |
| L3 | body with `email`/`password` instead of `personaId` | `400 INVALID_REQUEST` |
| L4 | decode `access_token` | `role=authenticated`, `app_metadata.demo=true`, no service-role claim |
| L5 | any login/reset body | no service key, refresh token or `SUPABASE_*` secret |
| L6 | 61 logins in 60 s | `429` + `Retry-After` |
| L7 | 9th login for one persona in 60 s | `429` |
| L8 | reset with the **guide** token | `403 DEMO_GUIDE_READ_ONLY` |
| L9 | reset with a non-demo session | `403 DEMO_SESSION_REQUIRED` |
| L10 | two parallel resets, different eligible identities | exactly one `200`, other `409 RESET_IN_FLIGHT` |
| L11 | judge B resets while judge A is mid-session | record A's **observed** experience |
| L12 | foreign origin on `/api/demo/login` | `403 ORIGIN_NOT_ALLOWED` |

L6 is the measurement that decides P-2: if the bucket is global, 61 logins from one client proves the
global cap, and that must be written down as the accepted behaviour or fixed.

---

## 6. Phase 5 — supervision and recovery

**Fresh pin worktrees, every time.** Each service runs from a checkout at `00dbc1d`; the cache is not
reused across revisions. Every worktree must receive, before first start:

- `.env` (copied, mode 600, **not** a symlink — an absolute link written through a path-masking layer
  has silently become a broken link before);
- `data/identity-map.json` (copied, mode 600) — auth mapping and RLS `current_person()` read
  **different** stores; missing either yields a persona that signs in and is denied everywhere;
- `var/orbit-photos` aligned to the same directory the uploader writes, or the parent's own photo
  fails with an ordinary-looking 403.

**Start order with a health gate between each:** 4001–4008 → compose supergraph → 4010 (prod config) →
5051 → 4200 → 5189 static. cloudflared is already a LaunchDaemon and is not managed here.

**launchd** — one supervisor, not eight racers:

```
/Library/LaunchDaemons/com.fridgegraph.stack.plist
  RunAtLoad true · KeepAlive {SuccessfulExit:false} · UserName <owner>
  ProgramArguments [/bin/bash, <repo>/ops/stack-start.sh]
  StandardOut/ErrPath ~/Library/Logs/fridgegraph/stack.log
  ThrottleInterval 30
```

`ops/stack-start.sh` must: refuse to start a service whose port already has a listener (duplicate
listeners are the failure this prevents), fail **closed** on any gate, log the failing step, and never
"continue anyway".

**Environment checks, on the running processes:**

```bash
pid=$(lsof -nP -iTCP:4001 -sTCP:LISTEN | tail -n +2 | head -1 | awk '{print $2}')
ps eww -p "$pid" | tr ' ' '\n' | grep -E '^DEMO_(CLOCK|LOGIN_ENABLED)='
```

Pass: `DEMO_LOGIN_ENABLED=1`, **`DEMO_CLOCK` not printed**. Fail closed if `DEMO_CLOCK=1` appears.
Also confirm `.env` contains no `DEMO_CLOCK` entry, so a restart cannot acquire one.

**Recovery proof:** stop one supervised service by exact PID, confirm the supervisor restarts it and
the port returns with the same configuration; confirm no second listener appears.

---

## 7. Phase 6 — migration 0086 (separate, later, gated)

0086 is **staged, never applied**. It is not part of the exposure window and must not be applied to
make a screen work.

Preconditions, all satisfied in the same window before any apply:

1. **Deployment-catalog check** — read the real catalog for `adult_availability_free_busy` and its
   base table: owner, `reloptions`, and `has_table_privilege()` for `anon`, `authenticated`, `public`,
   `service_role`. The migration's own header claims the view has no PUBLIC/anon grant; verify it.
2. **Grant preservation** — enumerate every existing grant on the view and base table. The apply must
   revoke only what the migration names and must not drop a grant a trusted service depends on. Any
   grant that disappears without being named in the diff is **unexpected drift → stop**.
3. **Disposable rehearsal** — stock Postgres container from a pinned digest, fake rows, one
   transaction ending in `ROLLBACK`, 127.0.0.1-bound from the first launch. A stock Postgres proves
   SQL semantics only, **not** `anon`/`authenticated`/`service_role` semantics or `auth.uid()`; the
   reserved-window rehearsal on the project database is still required.
4. `ops/availability-view-proof.mjs` green on the applied schema.

**Never** restore a service configuration by reversing a migration. Rollback is configuration and
code, not DDL.

---

## 8. Validation after the go (public URL, in this order)

1. **Judge-path suite** against the public URL: login → Today → Fridge → Mission Control → Orbit →
   Ask Rosina text.
2. **Two independent Kendra contexts** simultaneously usable (separate browser contexts, separate
   logins) — proves the shared-session cache and per-person limits do not collide.
3. **Authorized reset** through the public origin; **anonymous/refused** access checks: no token,
   foreign origin, guide token, non-demo session.
4. **Application health** — `node ops/stack-health.mjs` **HEALTHY (0 failing)**.
5. **Cast checksum** — `f022ccf8311e7561`, recorded as its own fact.
6. **Schema changes** — recorded separately from code: which migrations are applied, and none applied
   by this window unless Phase 6 ran.
7. **No unexpected provider calls or outreach** — no SMS/call send, no Muse/ElevenLabs generation
   beyond the invited Ask Rosina text turn, no GHL/n8n write.

Report the public URL **only** after 1–7 pass.

---

## 9. Stop rules (stop and report; do not improvise)

- Any gate proof produces a generic-looking body but a 500, or a 200 with an `errors` array.
- Origins cannot be set to the exact public origin without a wildcard.
- `DEMO_CLOCK` appears on any process.
- A duplicate listener appears on any stack port after a supervised start.
- `.env` or `identity-map.json` missing from a pin worktree (never start "to see").
- A public path exists that is not in §4's table, or any wildcard appears in the tunnel.
- 0086 shows unexpected grant drift, or its rehearsal does not reach ROLLBACK cleanly.
- Any check requires widening a permission or deploying an incompatible backend to pass.
- Provider spend or an outbound message that this plan did not call for.

## 10. Rollback (four levels, fastest first)

1. **Remove public exposure** — delete the `app.<host>` route in the dashboard. Public URL dies; local
   stack keeps running. This is the default first move for any failure.
2. **Restore the previous router** — stop 4010 (`router.prod.yaml`), start `router.yaml` at the
   recorded hash, restart both routers on the previous supergraph file.
3. **Restore the previous web build** — stop 5189, start the static server against the preserved
   `e8f000d` build (`index 302bbf4c…`, tree `c90eb837…`).
4. **Restore the previous service configuration** — the recorded pre-window PIDs/commands, cold-start
   script reverted, launchd plist booted out.

Applied 0086 is **not** reversed by an improvised down-migration. If 0086 caused the failure, stop the
exposure, report, and plan a forward fix.

---

## 11. Explicit exclusions (Phase 1)

Fridge editing · live photo intake · live invitation generation · 0084/0085 · public voice routes ·
every SMS/call send · **phone calls at any phase** · MCP, subgraph and health-port exposure · any
wildcard CORS · merging this plan.

Voice and SMS are **deferred to Phase 2 (§13)**, not cancelled.

---

## 12. Decisions this plan needs from Bryan before the go

Settled on 2026-11-03, recorded here so the plan is not re-litigated:

1. **P-1** — merge the voice-off flag **first** (decided).
2. **P-2 / P-10** — **fix** the login limiter to the trusted proxy IP; do not accept a shared bucket
   (decided).
3. **Map / recorded places / route / Orbit photos** — **stay ON**, each as an exact bearer-checked
   route with its own session limit (decided).
4. **Outbound calls** — deferred in both phases; rideshare is the fallback (decided).
5. **Judge-triggered SMS** (Phase 2) — authorised to the three `fg-test-responder` contacts only
   (decided).

Still needed from Bryan:

6. **The literal public hostname**, so `DEMO_ALLOWED_APP_ORIGINS` and `cors.origins` are pinned rather
   than placeholdered.
7. **The rotation window for P-5** — a quiet 15 minutes, since rotating the Supabase DB password and
   the GHL token restarts only the affected services but does interrupt them briefly.

---

## 13. Phase 2 — judge voice and SMS outreach (separate go)

**Status: PLAN ONLY.** Same public origin as Phase 1, one additional explicit go from Bryan. Phase 1
does not wait for it, and Phase 2 never re-opens a Phase 1 gate.

### 13.1 Preconditions before the §13 go

1. **#187 merged and its real run passed.** The single-Loretta loop passes first; three-responder
   fan-out only after that. A merged PR is not a passing run.
2. **#182 voice auth deployed and verified** — JWKS issuer/audience/expiry checked before any paid
   provider is touched, `sub` mapped through `data/identity-map.json`.
3. **The kill switch is readable at runtime and honoured at handoff**, default OFF.
4. The Phase 1 validation battery (§8) is green on the exact same origin.

### 13.2 Exact public routes to add (and nothing else)

| Public route | Local target | Authentication |
| --- | --- | --- |
| `POST /voice/turn` | `127.0.0.1:4118` | Bearer, JWKS-verified (#182) |
| `POST /voice/transcribe` | `127.0.0.1:4118` | Bearer, JWKS-verified |
| `POST /voice/speak` | `127.0.0.1:4118` | Bearer, JWKS-verified |
| `POST /webhooks/coordination/reply` | `127.0.0.1:4110` | Machine callback: `x-fridgegraph-timestamp` + `x-fridgegraph-signature`, constant-time compare. **Not** bearer |

Admitted as **three exact paths plus one exact webhook**, never `/voice/*` as a prefix. Everything
else on 4118 and 4110 stays 404 at the edge. `/voice/*` is 404 throughout Phase 1, so the app must
already render the typing alternative and no mic (P-1 in §1).

### 13.3 Rate limits and per-session caps

Existing and verified today: Rosina text `20/min` per person (`ROSINA_RATE_LIMIT_PER_MIN`, keyed by
`identity.personId`), invites `6/min`.

**Every judge signs in as the same Kendra persona**, so a per-person limit is one shared bucket for the
whole audience — the same mistake the login limiter made. In Phase 2 the demo **session** (`jti`) is the
primary key and the person is only a backstop, so one caller minting sessions in a loop cannot make the
budget disappear for everyone else.

Phase 2 must add and then **verify on the public URL**:

| Limit | Value | Key |
| --- | --- | --- |
| voice turns (turn + transcribe) | **6 / min per session**, **30 / min per person** | `jti` → `sub` |
| voice turns per session | **120** | `jti` |
| audio per request | **≤ 20 s** and **≤ 1 MB** | rejected before ASR |
| concurrent captures | **3 per session** | `jti` |
| speech synthesis | **10 / min per session**, **40 / min per person**, text ≤ 4 000 chars | `jti` → `sub` |
| Spark model calls | **20 / min per session**, **60 / min per person**, **300 / day per person** | `jti` → `sub` |
| `/api/village/route` | **20 / hour per session**, **60 / hour per person** | `jti` → `sub` |
| per-turn wall clock budget | **8 s**, then a bounded honest failure | — |

Refusals are `429` with `Retry-After`; a capped turn must say so in the UI rather than hang.

### 13.4 Outreach caps, backstop and the 5-second update

- **Caps: 50 segments per run, 15 per recipient, 150 per America/Detroit day**, enforced atomically
  with the claim and reservation (0087), not as a separate check.
- **$1.00 run backstop** in the same reservation.
- **5-second app update**: the reply webhook → dispatch response → Activity timeline must land within
  **5 s p95**, measured end to end — the same budget the app-update work was assigned.
- **Kill switch**: one flag read at the final handoff, default OFF, effective without a restart,
  blocks new handoffs only, and does not promise recall of anything already handed off.
- Every permitted message kind has its own durable identity and reservation; only `REQUEST` ships in
  the first proof, so an identity prompt or nudge cannot borrow a request's allowance.

### 13.5 Acting directives stay inside the caller's permissions

Rosina **advises; she never executes.** The chain is:

1. the model returns `actions[]` drawn from a **closed catalog** (`web/src/features/rosina/catalog.ts`)
   with typed argument schemas; unknown ids or malformed args are dropped by `validateActions`;
2. the UI renders each permitted action as a **button** — there is no auto-execute path, and an action
   that is not `implemented` is not rendered at all;
3. the person clicks, and the click runs the **same authenticated GraphQL mutation** a manual action
   would, carrying the caller's own bearer — RLS and subgraph authorization decide, exactly as they do
   without Rosina.

There is no service-role shortcut and no "Rosina said so" path. A directive the caller lacks the grant
for fails at the database, identically to a manual attempt.

### 13.6 The judge flow that triggers SMS, and whose numbers

**Authorised by Bryan (2026-11-03):** judge-triggered SMS is approved **only** to the three
`fg-test-responder` contacts (`p_gma`, `p_tasha`, `p_bryan`), **only** within 50/15/150 segments, the
$1.00 run backstop and the kill switch, and **only** through the triple recipient rule below. Any
wider audience is a new authorization, not a configuration change.

1. A judge signs in as a demo persona and opens Mission Control → **request pickup** for Nora. No
   phone number is ever typed into the public app.
2. `requestPickup` creates the job. Dispatch resolves recipients only from the triple: the
   `fg-test-responder` tag **AND** the roster (`p_gma`, `p_tasha`, `p_bryan`) **AND** the private
   mapping.
3. The number itself exists only in the GHL contact record and environment — never in a browser
   payload, never in a response body. The page shows the child/attempt, not the number.
4. One permitted SMS goes out. The reply arrives at `/webhooks/coordination/reply`, binds to the
   dispatch by provider message id (or the exact attempt/candidate/version set), and appears in
   **Activity**.
5. **Outbound phone calls are deferred, in both phases.** GHL's one-call-per-day limit and the
   judging risk make them a bad demo, and no proof of them is planned. The no-reply / no-car path is
   the **rideshare fallback**: the app shows the alternative instead of promising a call. This is a
   documented deferral, not an oversight — do not add a call path to "complete the story".

### 13.7 Validation on the public URL (Phase 2)

| # | Check | Pass |
| --- | --- | --- |
| V1 | spoken turn | transcript returns, reply is **audible**, measured end-of-speech → first audio byte recorded |
| V2 | interruption | talking over the reply stops playback and starts one new turn — no double capture |
| V3 | real SMS reply | appears in **Activity within 5 s** (p95 over repeated runs) |
| V4 | Ask Rosina proposes an edit from that reply | the action renders, requires a click, and lands only if the caller's permissions allow |
| V5 | no stray spend | no provider call outside `/voice/{turn,speak,transcribe}` and the invited Spark turn |
| V6 | no number leak | no phone number appears in any page payload or response body |

Latency is reported as **measured**, never as a product claim. Voice stays "unverified" until V1–V2
have run against the public URL.

### 13.8 Phase 2 stop rules

- Any `/voice/*` path reachable without a verified bearer.
- The kill switch unreadable, or not honoured at handoff.
- Any send to a number outside the private mapping, or to a browser-supplied number.
- Activity update slower than 5 s p95.
- Any directive that lands without a person's click.
- Any need to widen a grant, add a wildcard route, or set `DEMO_CLOCK` to make a check pass.

### 13.9 Phase 2 rollback — order matters

1. **Kill switch ON.** Stops new handoffs at the boundary immediately. Nothing new leaves the machine.
2. **Drain and reconcile what is in flight.** For every `HANDOFF_STARTED` dispatch, read the provider
   and settle it to `ACCEPTED` / `FAILED_FINAL` / `UNKNOWN`. Do **not** delete or "reset" them; their
   reservations are retained by design.
3. **Keep `/webhooks/coordination/reply` UP** until those callbacks settle. Removing it first turns a
   late reply into a lost binding and an Activity item that never appears — the exact failure a judge
   would see.
4. **Then** remove the three `/voice` routes. The app falls back to text with the typing alternative.
5. Stop 4118/4110 only after 3 and 4.

Never roll back by reverting an applied migration, and never by widening a permission. Removing routes
before draining is not a rollback — it is a data-loss window.

---

## 14. Authorization and execution corrections (2026-11-03)

**This go covers Phase 1 hosting only.** It does not enable public voice, SMS/calls, live invitation
generation, photo intake, Fridge editing, or **any apply of 0084–0087**. Phase 2 keeps its own go.

### 14.1 Pins are per component
`§0` pins the artifacts; `#188`'s pin-table comment pins the *processes*. Re-read them together. Two
things that table exposes and this plan must not paper over:

- the 4101–4107 subgraphs run a **different commit** (`405f7a7`) from the 4001–4007 set (`bbe11a4`),
  while both routers serve a supergraph composed as `bbe11a4`. A `router.prod.yaml` proof must name
  which upstream set it targets.
- the Activity failure originates in **`bbe11a4`** (`src/db.ts`), not in the web build and not in the
  alternate stack.

### 14.2 P-10 must be in the running 4008
Prepare a **narrowly patched build compatible with the deployed schema** — not current `main`
wholesale — carrying the login-limiter fix. Rehearse login and the real `resetDemo()` against that
exact build before it serves the public origin.

### 14.3 Client IP through Cloudflare
Verify trusted-proxy resolution end to end. A spoofed `X-Forwarded-For` must not let an external
caller choose another caller's rate-limit bucket or appear local. **Do not enable blanket Express
`trust proxy`**; trust exactly the loopback peer that cloudflared presents.

### 14.4 Limits
Session-keyed accounting is deferred from Phase 1. Do not assume `jti` is present or unique per
browser. Verify two Kendra contexts under the limits actually deployed.

### 14.5 Secrets
Inventory every consumer **before** rotating. Hidden-input tooling only. Update all consumers, test
each dependency without printing values, and make the rollback artifacts use the rotated credentials
as well — a stale backup is how a rotation becomes an outage.

### 14.6 DNS and ingress
One hostname → one DNS mapping, multiple **ordered path rules**. Preserve unrelated hostnames
(`app.loomz.stream` belongs to LOOM). **No public route to 5190.**

### 14.7 Release acceptance
In addition to §8: Activity loads, map and recorded places render, route/ride calculations answer,
authorized Orbit photos load, and Rosina's conversation-first journey works. Expected refusals must
pass their negative assertions; an unexpected failure in an authorized flow **stops release**.

The known smoke-test defects remain assigned repairs. Hosting infrastructure passing does not close
them. On failure: remove FridgeGraph's public exposure and keep the working local environment.

No merging. No HANDOFF edits.
