# Hosting-window plan — public exposure of the web app + router

**Status: PLAN ONLY. Nothing in this document has been executed.** No shared-stack action was taken
while writing it. Every figure below is a **read-only observation** made on 2026-11-02 at
`origin/main` **`c4d190c`**; anything not observed is marked **UNKNOWN** rather than assumed.

Owner: Bentley. Execution requires its own posted reservation and a receipt.

---

## 0. Current state, measured

| Thing | Observed | Consequence for hosting |
| --- | --- | --- |
| `origin/main` | `c4d190c` (#143 merged 19:06Z) | base for this plan |
| Graph/demo 4001–4008 | pid `98183`, `DEMO_LOGIN_ENABLED=1`, **`DEMO_CLOCK` unset** | clock is already correct for prod |
| Router 4010 | `router.yaml` (dev), health 8090 | **not** promotable as-is |
| Router 4012 | alt config, health 8092 | dev only |
| MCP 5051 | pid `95929`, 13 tools | dev only |
| Rosina 4200 | pid `96204` | dev only |
| UI 5189 | pid `64228`, **`vite preview`** from **`/private/tmp/fg-ui-main/web`** | **will not survive reboot** — see §6 |
| 5190 | **no listener** | nothing to stop; verify, do not assume |
| 5191 | pid `45254`, `vite` dev, design-system, `--strictPort` | stop, by exact PID |
| Other stray vite dev servers | 6 more (`notice-plan-ui`, `map-labels`, `voice-mount`, `village-map`, `orbit-climax`, `orbit-alert-ui`) | out of scope but listed |
| launchd | **no fridgegraph entries** | nothing auto-starts today |
| pm2 | **not installed** | launchd is the available mechanism |
| cloudflared | LaunchDaemon, token-file mode, root | ingress is **dashboard-managed**, not in a local file |
| `router.graphos.yaml` | introspection `true`; `include_subgraph_errors.all: true`; `on_error: Error`; no CORS; no sandbox/homepage config | all five gates currently fail |

This mirrors HANDOFF §16 (pre-exposure checklist), which already records gates 1, 2, 4 and 5 as
**FAIL** and both router configs as localhost-only development configs.

---

## 1. Router production settings

The plan is to add a **new** `router.prod.yaml` rather than edit the dev configs, so local work keeps
working and the production file is reviewable on its own. Nothing here is applied by this document.

```yaml
# router.prod.yaml — production exposure. Dev configs stay untouched.
supergraph:
  listen: 127.0.0.1:4010
  introspection: false          # gate 2: schema discovery off

health_check:
  enabled: true                 # keep, on loopback only
  listen: 127.0.0.1:8090

# gate 4: never ship subgraph error detail. Redact everywhere; do not "selectively" include.
include_subgraph_errors:
  all: false

# gate 3: no explorer, no homepage.
sandbox:
  enabled: false
homepage:
  enabled: false

authentication:
  router:
    jwt:
      jwks:
        - url: "${env.SUPABASE_JWKS_URL}"
          issuers:
            - "${env.SUPABASE_URL}/auth/v1"
          audiences:
            - authenticated
          algorithms:
            - ES256
      header_name: Authorization
      header_value_prefix: Bearer
      on_error: RedactedError   # gate 1: was `Error` (detailed validation messages)

# gate 5: exact origin only. No wildcard, no regex.
cors:
  origins:
    - "https://<app-host>"      # fill from §3; the ONE public app origin
  allow_credentials: true
  allow_headers:
    - authorization
    - content-type
  methods:
    - GET
    - POST
    - OPTIONS

headers:
  all:
    request:
      operations:
        - propagate:
            named: Authorization
```

**Verification for each gate** (must pass before traffic):

| Gate | Check | Pass condition |
| --- | --- | --- |
| 1 | POST malformed bearer | response carries **no** validation detail; generic `AUTH_ERROR`-class message |
| 2 | `POST /` with an introspection query | refused / not supported |
| 3 | `GET /` in a browser | no explorer, no homepage |
| 4 | force a subgraph error | client sees generic message, no subgraph stack/detail |
| 5 | `curl -H 'Origin: https://evil.example'` | **no** `access-control-allow-origin` echo |
| 5 | `curl -H 'Origin: https://<app-host>'` | exact origin echoed, credentials allowed |

Gates 1–5 must be proven on the **exact bytes** that will be served, not a nearby revision.

---

## 2. `DEMO_CLOCK` — confirmed unset

Observed on the live process (pid `98183`): `DEMO_LOGIN_ENABLED=1`, and **`DEMO_CLOCK` absent from
the environment**. Absent means unset; the subgraphs treat only the literal `1` as enabled
(`src/context.ts`), so the production clock is real time.

**Also confirmed in the file, not just the process:** `.env` has no `DEMO_CLOCK` entry, so a restart
cannot acquire one by accident.

**Re-verify at window start, and again after start:**
```bash
pid=$(lsof -nP -iTCP:4001 -sTCP:LISTEN | tail -n +2 | head -1 | awk '{print $2}')
ps eww -p "$pid" | tr ' ' '\n' | grep -E '^DEMO_(CLOCK|LOGIN_ENABLED)='
```
Pass: `DEMO_LOGIN_ENABLED=1`, `DEMO_CLOCK` **not printed**. Fail closed if `DEMO_CLOCK=1` appears.

---

## 3. Tunnel routes — web app and router

**Constraint that shapes everything:** cloudflared runs in **token mode**; the ingress rules live in
the Cloudflare dashboard, not in a local file. There is nothing on this machine to diff or review, so
the route table must be written down here and applied by hand in the dashboard.

### Option A (recommended) — one public origin, router stays private

| Public hostname | Path | Local service |
| --- | --- | --- |
| `app.<domain>` | `/` | `http://127.0.0.1:5189` |
| `app.<domain>` | `/graphql` | `http://127.0.0.1:4010` |
| `api.<domain>` | `/` | `http://127.0.0.1:4200` (Rosina, only if the UI needs it publicly) |

Why: the browser talks to one origin, so **CORS becomes moot** and the router is never independently
reachable. `cors.origins` then lists exactly that one host. Fewer moving parts, no wildcard, no
preflight surprises.

### Option B — two hostnames

| Public hostname | Local service | CORS |
| --- | --- | --- |
| `app.<domain>` | `http://127.0.0.1:5189` | — |
| `router.<domain>` | `http://127.0.0.1:4010` | `origins: ["https://app.<domain>"]` |

Why not first: it makes the router a public endpoint in its own right, which is exactly the surface
§16 gates exist to harden. Choose it only if the app cannot be served same-origin.

**Explicitly not exposed:** 4001–4007 (subgraphs), 8090/8092 (health), 4008 except as required for
demo login, 5051 (MCP), 55434 (fg81). MCP and subgraphs are **never** public.

**Verification after routing:** from off-machine, `app.<domain>/` returns the app; introspection at
the public host is refused; `router.<domain>` (if used) answers only with a valid bearer and never
echoes a foreign origin.

---

## 4. Auto-restart after reboot

pm2 is **not installed**, and adding a process manager to a machine that has none is a bigger change
than this window wants. Use **launchd**, which is already present (cloudflared uses it).

### Recommended shape — one supervisor, not eight racers

Eight independent agents would start in arbitrary order, and the routers/MCP/Rosina **cannot** come up
before the subgraphs and the composed supergraph exist. So: **one** LaunchDaemon that runs a
dependency-ordered script with health gates.

```
/Library/LaunchDaemons/com.fridgegraph.stack.plist
  RunAtLoad            true
  KeepAlive            { SuccessfulExit: false }   # restart on crash, not on clean stop
  UserName             <the owning user>           # so ~/.nvm and the worktree are readable
  ProgramArguments     [/bin/bash, <repo>/ops/stack-start.sh]
  StandardOut/ErrPath  ~/Library/Logs/fridgegraph/stack.log
  ThrottleInterval     30
```

`ops/stack-start.sh` (to be written **in** the window, with its own review) does, in order, with a
health gate between each step:

1. `4001–4008` — graph + demo, `DEMO_LOGIN_ENABLED=1`, **no** `DEMO_CLOCK`
2. `rover supergraph compose --config supergraph.yaml` (requires step 1 up) → `./.runs/supergraph.graphql`
3. `4010` + `4012` — both routers on the composed file
4. `5051` — MCP, explicit schema path in config
5. `4200` — Rosina (`ROSINA_GRAPHQL_URL=http://127.0.0.1:4012/`, `ROSINA_MCP_URL=http://127.0.0.1:5051/mcp`)
6. `5189` — web, from a **persistent** build dir (§6)
7. cloudflared is already a LaunchDaemon; do not manage it here

Failure policy: any gate fails → **stop**, log the failing step, leave earlier steps up, and do not
mark the stack healthy. The script must never "continue anyway".

**Why LaunchDaemon + `UserName` rather than a LaunchAgent:** a LaunchAgent only starts when that user
logs in, so "after reboot" would silently mean "after someone logs in". A daemon with `UserName` runs
at boot with the right privileges. The trade-off is that it runs before login, so every path must be
absolute — no shell rc, no nvm shims.

**Rollback:** `launchctl bootout system/com.fridgegraph.stack` and delete the plist; the manual
cold-start in §6 remains the recovery path.

---

## 5. Stop stray previews 5190 / 5191

**Measured first — do not act on the assumption that both exist:**

- **5190: no listener.** Nothing to stop. Record it as "already free" rather than claiming a kill.
- **5191: pid `45254`** (`vite --port 5191 --strictPort`, `fridgegraph-design-system`).
- **Do not `pkill vite`** — pid `64228` (the served UI on 5189) is also `vite`, and a pattern kill
  would take down the app you are trying to keep.

Safe procedure:
```bash
lsof -nP -iTCP:5190 -sTCP:LISTEN    # expect empty
lsof -nP -iTCP:5191 -sTCP:LISTEN    # expect 45254
kill 45254                          # exact PID
sleep 2
lsof -nP -iTCP:5191 -sTCP:LISTEN    # expect empty
lsof -nP -iTCP:5189 -sTCP:LISTEN    # expect 64228 still alive
```
Re-measure the PID at execution time; `45254` is an observation, not a constant.

Broader cleanup, listed but **out of scope** for this window: six further stray `vite` dev servers
(`29788`, `46916`, `95386`, `1294`, `7171`, `42209`). They consume ports and confuse which build is
serving. Recommend a separate, explicitly-approved cleanup pass.

---

## 6. The real problem this plan exposes: 5189 is not reboot-safe

The served UI is `vite preview` running from **`/private/tmp/fg-ui-main/web`**. macOS clears
`/private/tmp` on reboot (and periodically). After a restart, **5189 will be gone and cannot be
restarted from that path** — the directory will not exist.

So a true cold start needs a durable artifact:

1. Build from a pinned revision (`web/npm ci && web/npm run build`).
2. Publish the built `web/dist` to a **persistent** location under the user's home (e.g.
   `~/fridgegraph-web/<sha>/`), not `/tmp`.
3. Serve it with a static server that is part of the stack (node/serve on `127.0.0.1:5189`), not
   `vite preview`, so the same command works on every boot.
4. Record the served build SHA in the receipt; the UI revision is recorded separately from backend
   revisions, per standing practice.

`vite preview` is a development convenience. It is not a production server and it is not a
cold-start artifact.

---

## 7. True cold-start run plan

"Cold" means: **machine rebooted, nothing running, no login performed, Cloudflare tunnel already up.**
Because the plan uses a LaunchDaemon, the cold start is largely *automatic* — the proof is that it
comes up correctly without a human.

**T-0 Reboot.** Do not touch anything for 90 s.

**T+90s — supervised start only.** If the LaunchDaemon works, all of §4 steps are already up. Verify,
do not restart.

| # | Check | Pass |
| --- | --- | --- |
| 1 | `launchctl print system/com.fridgegraph.stack` | loaded, last exit 0 |
| 2 | 4001–4008 listening | 8/8 |
| 3 | graph env | `DEMO_LOGIN_ENABLED=1`, `DEMO_CLOCK` **absent** |
| 4 | composed supergraph exists | file present, hash recorded |
| 5 | 4010 health 8090 / 4012 health 8092 | `{"status":"UP"}` on **each own** port |
| 6 | 5051 | 13 tools, 0 load errors |
| 7 | 4200 | listening, log line shows MCP + GraphQL URLs |
| 8 | 5189 | app HTML 200 from the **persistent** build dir |
| 9 | tunnel | `cloudflared` ready connections ≥ 1 |
| 10 | `node ops/stack-health.mjs` | **HEALTHY (0 failing)** |
| 11 | cast checksum | matches the value recorded for that revision |
| 12 | public URL from off-machine | app loads, introspection refused, foreign origin not echoed |

If the LaunchDaemon did **not** start things: fall back to the manual order in §4 step 1→6, and treat
the daemon as **failed** (that is a finding, not a workaround).

**Not part of a cold start:** reset, seed, `db:restore-demo`, migration. Those are data actions with
their own windows. A cold start restores **processes**, never data.

---

## 8. Ordering and preconditions

1. #141 and #142 merge (they touch `HANDOFF.md`; #144 must be refreshed only after, on instruction).
2. Production router config written and **reviewed as its own change**.
3. Durable web build published (§6) — otherwise the cold-start gate is unachievable.
4. launchd supervisor written and reviewed.
5. Reservation posted; window opened.
6. Execute §5 cleanup → §1 settings → §3 routes → §4 supervision → §7 cold-start proof.
7. Receipt with per-process revisions, config hashes, and each gate's own result.

## 9. Explicit non-goals

- No `db push`, no migration, no reset, no seed in this window.
- No MCP, subgraph or health-port exposure.
- No wildcard CORS, at any point, even temporarily.
- No merging of this plan or of #144.
- No removal of the UI guide guard (see `guide-map-inspection-queries.md`).

---

## 10. Public demo-login exposure (added 2026-11-02)

**Status: PLAN ONLY.** Judges need demo login through the tunnel, so `/api/demo/login` and
`/api/demo/reset` **will be internet-reachable**. Loopback binding is not protection behind
cloudflared: every request arrives with socket peer `127.0.0.1`, and `src/demo/client-ip.ts` says so
in its own header comment. Everything below is read from code at `5cfa121`, with `file:line` so it can
be re-checked rather than trusted.

### 10.1 Two blockers found while writing this

**B-1 — an `https://` origin is refused today.** `originAllowed()` (`src/demo/server.ts:117-120`)
accepts **only** `http://localhost` and `http://127.0.0.1`. It runs as middleware on every demo route
(`:145`). A browser on `https://app.<domain>` sends `Origin: https://app.<domain>` and receives
**403 `ORIGIN_NOT_ALLOWED`** — for login *and* reset. A public browser demo cannot work until this
allow-list includes the real app origin.

*Note:* the same check returns `true` when there is **no** `Origin` header (`:118`), so `curl` and
non-browser callers are unaffected. The gate blocks exactly the judges it is meant to admit.

**B-2 — `NODE_ENV=production` does not "disable the picker", it kills the endpoint.**
`startDemoLogin()` (`src/demo/server.ts:579-583`) returns `false` and logs
`[demo-login] refusing to start with NODE_ENV=production`. The demo therefore stays available only
when **`DEMO_LOGIN_ENABLED=1` and `NODE_ENV` is not `production`**. Any hosting recipe that sets
`NODE_ENV=production` "for safety" silently removes demo login entirely — the opposite of the intent.

### 10.2 Which identities `/api/demo/login` can mint

The request body accepts **one field**: `personaId`, a string ≤64 chars (`src/demo/server.ts:173-178`).
There is no email, password, person id or role in the contract, so a caller cannot name an account
they were not offered.

Resolution is allow-list first, registry second (`:182`):

```ts
const persona = personaById(personaId) ?? (await familyPersona(personaId));
```

- **`personaById`** matches only the fixed `DEMO_PERSONAS` allow-list
  (`src/demo/personas.ts:35-177`): `demo-guide`, `kendra`, `andre`, `loretta`, `priya`, `dana`,
  `jax-family`, `rosa`, `felicia`, `simone`, `whitfield`, `dwayne` — each with a fixed `personId` and
  a fixed `@example.com` mailbox.
- **`familyPersona`** resolves **only** rows created through the family registry
  (`src/demo/family.ts:303-306`, table `demo_families`); it never constructs an identity from input.
- Unknown and known-but-unseeded are **distinguishable**. Both answer `UNAVAILABLE`, but the `reason` differs: `UNKNOWN_PERSONA` for an id not on the allow-list or in the registry, `NO_SEEDED_IDENTITY` for a known persona with no seeded identity (`server.ts:184-192`). **Correction to an earlier draft: the "no oracle" claim is withdrawn.** The reason code tells a caller whether the id exists. Record it as an existence oracle and decide deliberately whether that is acceptable for a public endpoint.

**Verdict: fictional demo personas only.** An arbitrary or real account cannot be minted through this
endpoint, because the only address ever used is the one stored on the persona row.

### 10.3 What the returned session is allowed to do

Minting is two steps, and the two keys never mix (`src/demo/session.ts:60-110`):

1. **service-role** `admin.generateLink({ type:'magiclink', email: persona.email })` — server-side only,
   used to *create* a link, never a session;
2. **publishable-key** `verifyOtp({ token_hash, type:'magiclink' })` — produces an ordinary **user**
   session.

The response is checked before it is trusted (`session.ts:88-104`): the authenticated subject must map
back to the requested `personId` (`MINT_IDENTITY_MISMATCH`), `app_metadata.demo` must be `true`
(`MINT_MARKER_MISSING`), and the guide marker must agree with the persona (`MINT_MARKER_MISSING`).
Any failure throws — there is no fallback session.

What crosses the wire: `access_token`, `token_type`, `expires_in`, `expires_at`
(`src/demo/personas.ts:245-251`). The **refresh token stays in the server process**; the service key
never reaches the browser and is never in a response body.

**Privilege statement to verify, not assume:** the browser holds a **`role=authenticated`** JWT with
`app_metadata.demo=true`. It is *not* a service-role token, and every authorization decision is still
made by RLS and the subgraphs against that user token. The service key's only role is minting the
magic link server-side.

### 10.4 Rate limiting and admission seen through the tunnel

Client identity comes from `resolveClientIp()` (`src/demo/client-ip.ts:23-37`), and the rule matters:

- peer **not** in the trusted set → the `X-Forwarded-For` header is **ignored**, socket peer used;
- peer **is** trusted (default `127.0.0.1`, `::1`) → walk `X-Forwarded-For` **right to left**, return
  the first untrusted hop;
- all hops trusted → the peer itself, which `isResolvedClient()` treats as "no client identity".

**Gap B-3 — the login limiter does not use the trusted-proxy resolver.** `resolveClientIp()` is used
by **reset** (`server.ts:479`) but **not** by login: login keys on `req.ip ?? req.socket.remoteAddress`
(`server.ts:181`), and `trust proxy` is **not configured anywhere** in `src/` (grep returns nothing).
Behind cloudflared every request therefore arrives from `127.0.0.1`, so the login per-IP limit collapses
into **one global bucket of 60 requests/min for all users**, not 60 per client. It fails closed rather
than open, but it is not the per-client limit §10.4 above describes.

This is recorded as an **open public-boundary gap** to be fixed under the existing public-boundary
work, **not** changed in the origin PR: origin handling and limiter identity are separate concerns and
must not be bundled.

So a caller cannot choose the address they are counted against unless they are the proxy — **true for
reset, not yet true for login**.

| Limit | Value | Where |
| --- | --- | --- |
| login per client IP | **60 / 60 s** | `server.ts:80-81` |
| login per persona | **8 / 60 s** | `server.ts:82-83` |
| reset per client IP | **5 / 60 s** | `server.ts:132-133` |
| reset per person | **30 s cooldown** | `server.ts:126` |
| created-family | **5 s cooldown** | `server.ts:135` |
| request body | **2 kb** | `server.ts:139` |

Refusals are `429` with `Retry-After` on login and `retryAfterMs` on reset.

### 10.5 Reset admission and concurrent judges

`POST /api/demo/reset` (`server.ts:465-515`) requires, in order:

1. **loopback socket peer** (`:468`) — note this is *not* public protection behind cloudflared;
2. **`identityRefusal`** (`src/demo/guards.ts:34-39`): not `UNAUTHENTICATED`, must be **demo**
   (`DEMO_SESSION_REQUIRED`), and the **guide is refused** (`DEMO_GUIDE_READ_ONLY`);
3. **per-IP window** (5/min) and **per-person 30 s cooldown**;
4. **one shared reset lock** (`SHARED_RESET_LOCK`) → concurrent callers get **`409 RESET_IN_FLIGHT`**.

Precision on "parent-only": the code enforces **demo session, guide refused**. It does **not** test
parenthood — nothing in this path verifies the caller is a parent. An earlier draft claimed every
non-guide persona is a parent account; **that claim is withdrawn**, because it is a property of the
current fixture list rather than something the code enforces or should be relied on.

**If another judge resets mid-session:** the reset performs `dropPersonaSessionCache()`
(`src/demo/persona-sessions.ts:208-214`), which increments a generation and clears the cache — so a
mint that *raced* the reset is discarded and re-minted against the new generation (`:88-95`). But an
**access token already issued stays valid** until its own expiry; it is a Supabase JWT, not something
the cache can revoke. The observable result for the other judge is therefore: **token still works,
data snaps back to baseline underneath them** — a stale view, not a bounce to login. Record what
actually happens; do not claim either "they are logged out" or "nothing changes".

### 10.6 Pass conditions for the hosting window

Each must be run through the **public** hostname, and each result recorded separately.

| # | Condition | Pass means |
| --- | --- | --- |
| D1 | `https://app.<domain>` login as `kendra` | `READY` with a session — proves B-1 was fixed, not worked around |
| D2 | login with an unknown `personaId` | `UNAVAILABLE` / `UNKNOWN_PERSONA`, **no token in the body** |
| D3 | login body with `email`/`password`/`personId` instead of `personaId` | `400 INVALID_REQUEST`; extra fields ignored |
| D4 | decode the returned `access_token` | `role=authenticated`; `app_metadata.demo=true`; **no** service-role claim |
| D5 | any login/reset response body | contains **no** service key, refresh token, or `SUPABASE_*` secret |
| D6 | 61st login from one IP in 60 s | `429` + `Retry-After` |
| D7 | 9th login for one persona in 60 s | `429` |
| D8 | reset: spoof `X-Forwarded-For` from an untrusted path | the counted client is the socket peer, not the claimed address (**reset only** — login does not use the resolver, see B-3) |
| D9 | reset with the **guide** token | `403 DEMO_GUIDE_READ_ONLY` |
| D10 | reset with a non-demo (normal) session | `403 DEMO_SESSION_REQUIRED` |
| D11 | two resets in parallel, **different eligible identities**, both with fresh cooldown and rate state | exactly one `200`; the other `409 RESET_IN_FLIGHT` — same-person overlap is **not** a valid test, because it may correctly answer `429` from the per-person cooldown and would not isolate the shared lock |
| D12 | judge B resets while judge A is mid-session | record A's actual experience (token valid? data baseline?) — report observed, not assumed |
| D13 | demo process env at runtime | `DEMO_LOGIN_ENABLED=1` **and** `NODE_ENV` **not** `production` (B-2) |
| D14 | reset completes | `200` with a report; `droppedSessionCache: true`; cast checksum matches the recorded value |

### 10.7 Decisions this section forces

1. **Decide the origin allow-list change before the window.** B-1 is not a tuning item; without it
   there is no public browser demo. It needs its own reviewed change and its own proof (D1).
2. **Never set `NODE_ENV=production` on the demo process** (B-2). If a hosting recipe requires it for
   other reasons, the demo endpoint must be split out or the recipe changed — not quietly accepted.
3. **Publish the reset semantics to judges** if resets are shared: a concurrent judge gets `409`, and
   a mid-session reset leaves them with a valid token over restored data.
4. **Do not treat loopback as a control.** Two independent defences are what bound a public caller:
   the trusted-proxy client IP and the per-identity lock.
