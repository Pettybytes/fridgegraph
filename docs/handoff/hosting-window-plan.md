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
