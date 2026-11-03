# Hosting execution plan — public app origin (PLAN ONLY)

**Status: PLAN ONLY. Nothing in this document has been executed, deployed or exposed.**
No public hostname exists yet. No router, tunnel, launchd or migration change has been made.

Companion to `docs/handoff/hosting-window-plan.md` (the analysis, #145/#149). That document explains
*why*; this one is the ordered, checkable runbook with exact pinned artifacts, commands, timings,
stop rules and rollback. Where the two disagree, this one wins only after the analysis is corrected.

Base measured at `origin/main` **`00dbc1d173ad4e78f7492c86c0f62b6ee92fd85b`** on 2026-11-03.

---

## 0. Pinned artifacts (record these, never "latest")

| Artifact | Pin | Verification |
| --- | --- | --- |
| Serving code | `00dbc1d173ad4e78f7492c86c0f62b6ee92fd85b` | `git rev-parse HEAD` in each worktree |
| Web build | `/Users/user/fridgegraph-web/00dbc1d/web/dist` | index `1b20467c66e0d901d46b3ec21f1b0b9432a468a8766be47ebf79ecfce048a8fa` |
| Web entry JS | `assets/index-DzmuUm4e.js` | `e67bc917454c1883604dae20c917ecef6974776ec12799e67d3d33d8e00774af` |
| Web entry CSS | `assets/index-BRbs-wFN.css` | `c3558ad7ef91d53089700c9c206c3a38896951f3e38d931bdaa22349ee02f175` |
| Whole-dist tree | — | `e068f201bc30e67960bf8c01a40f4378c2f3e32425b42a223f349a9eedb676b4` |
| Web build flags | `VITE_FRIDGE_EDITING_VERIFIED=false`; notice-plan / add-villager / village-map live **empty** | dist contains no `VITE_` string; ConnectedFridge chunk has `enabled:!!i||!1` |
| Router prod config | **new** `router.prod.yaml` (does not exist at this pin) | hash recorded when written |
| Composed supergraph | `.runs/supergraph.graphql` produced in-window | hash recorded; recomposed, never reused |
| Migration 0086 | `supabase/migrations/0086_availability_view_hardening.sql` | `c709405813a7de47e99277160174da5099820f1df049172be2b76e21b4c77b6e` |
| Demo cast checksum | `f022ccf8311e7561` | `node ops/stack-health.mjs` |

Backend pins for this window are **`00dbc1d`**, not the currently running `bbe11a4`. The swap is part
of the window, and both are recorded separately from the web build.

---

## 1. Prerequisite changes that must be merged BEFORE the window

These are small, separately reviewed and separately proven. **If any is not merged, do not open the
window** — do not "work around" them in a deploy script.

**P-1 — voice controls must be off by configuration.** `RosinaVoiceButton` is rendered unconditionally
and its failure mode when `/voice/*` is absent is an error after the user taps. Required: a build-time
`VITE_VOICE_LIVE` (default off) that removes the mic and hands-free controls, leaving the text
composer as the stated alternative. Without it, excluding `/voice/*` leaves a broken control, not an
unavailable one.

**P-2 — decide the login-limiter identity question.** `POST /api/demo/login` keys its per-IP window on
`req.ip ?? req.socket.remoteAddress` (`src/demo/server.ts`, verified at this pin) and `trust proxy` is
set nowhere, so behind cloudflared **every judge shares one 60/min bucket**. Reset uses
`resolveClientIp()` and is unaffected. Either accept "one global 60/min login budget" in writing, or
fix the resolver for login first. This is a capacity decision, not a security hole — it fails closed.

**P-3 — the static server exists and is reviewed.** `ops/` has no static server today; `vite preview`
is serving. Spec in §3. It must be a reviewed file before the window, not written inline into a shell
history.

**P-4 — the guide/exposure surface is unchanged.** No removal of the UI guide guard, no widening of
RLS, no grants added to `anon`/`authenticated` to make a screen render.

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

**Explicitly 404 at the edge — not "unrouted", actively refused:**

`/voice/*` · `/api/rosina/invite` · `/api/rosina/photo-descriptors` · `/api/rosina/notice-plan*` ·
`/api/village/*` · `/api/orbit/photo/*` · `/api/demo/family` · `/api/demo/voice-note/*` ·
everything on `4001–4007`, `4101–4107`, `5051`, `8090`, `8092`, `4118`.

**Two features therefore go dark, and this must be said out loud:**

- **Orbit photos** (`/api/orbit/photo/*`) and **Village map** (`/api/village/day|route`) are not in the
  allowlist. Orbit renders its text records; the photo preview and the map's live geometry will not.
  If judges need either, add **only** `/api/orbit/photo/*` (GET, bearer-checked) or `/api/village/day`
  as a deliberate, separately-argued line — never a prefix that also opens `/api/village/route`.
- **Invitations** will show the service as unavailable because `/api/rosina/invite` is refused. That is
  the intended state (live invitation generation is out of scope), and the panel already renders a
  refusal honestly.

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

## 11. Explicit exclusions

Fridge editing · live photo intake · live invitation generation · 0084/0085 · public voice routes ·
every SMS/call send · MCP, subgraph and health-port exposure · any wildcard CORS · merging this plan.

---

## 12. Decisions this plan needs from Bryan before the go

1. **P-1** (voice-off build flag) — merge first, or accept a visible-but-failing mic (not recommended).
2. **P-2** — accept one global 60/min login budget behind the tunnel, or fix the login resolver first.
3. **Village map / Orbit photos** — leave dark, or admit exactly one read-only route each.
4. **The public hostname** — the literal origin, so `DEMO_ALLOWED_APP_ORIGINS` and `cors.origins` can
   be pinned rather than placeholdered.
