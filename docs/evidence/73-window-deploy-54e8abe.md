# Evidence 73 — backend deployment window W-DEPLOY-54e8abe

**Window:** `2026-11-02T19:00:00Z` → `2026-11-02T21:00:00Z`; recovery/verification `20:45–21:00Z`.
**Pinned revision:** `54e8abe80382f069075ddfe6a78744fe8bc8ab16` (origin/main, never moved during the window).
**Scope:** backend only. Web cutover is a separate window. **5189 untouched.** No tunnel published, no dial, no SMS, no merge.

## Pre-flight

| Check | Result |
| --- | --- |
| `npm run typecheck` at the pin | **PASS** |
| `npm run check` (secret scan, 1048 files) | **PASS — 0 findings** |
| Reservation | `0be3878` `chore(handoff): reserve W-DEPLOY-54e8abe` |

## Serving before (recorded per process, not a blanket claim)

| Ports | Process | Command / config |
| --- | --- | --- |
| 4001–4008 | node pid `47998` | `--env-file=.env --import tsx src/main.ts`, cwd `fridgegraph-village-backend` @ `1be7f5b` |
| 4010 | `router-v2` pid `50674` | `router.yaml`, `.runs/supergraph-alt.graphql` |
| 4012 | `router-v2` pid `50708` | `/Users/user/.openclaw/tmp/fridgegraph-alt-router-6a12e1a.yaml` |
| 5051 | `apollo-mcp-server` pid `56537` | `/tmp/fridgegraph-mcp-deploy.yaml` |
| 4200 | node pid `54300` | `src/rosina/server.ts`, cwd `fridgegraph-village-backend` |
| 5189 | `vite preview` pid `64228` | `--host 127.0.0.1 --port 5189` (not restarted) |
| 4118 | — | no listener |

Rollback snapshot: `/Users/user/Desktop/bentley/window-54e8abe-rollback/` — `router.yaml` (`74a40fd24855d078`), 4012 config (`e361e1484b268f7f`), MCP config (`c6e0078a9ecec2e2`), supergraph (`93506905e3310283`), HANDOFF.

## Rehearsal

`node ops/shared-status-proof.mjs` on a disposable `postgres:16-alpine` container — **14/14 PASS**, including: stranger refused read/update/delete; co-parent and sitter both read; expiry hidden by RLS itself; demo guide refused on write; `_connected_children` private; `can_view_shared_status` caller-bound with no viewer argument; owner set → expire → replace → clear; reset restores a freshly computed expiry.

## Live migration inspection

- `supabase_migrations.schema_migrations` records **only 0001–0011**, yet the schema carries `demo_families` (0049), `place_route_results` (0059), `school_reports` (0070), `villager_proposals` (0074). **The ledger is stale; it is not a reliable applied-state record.** Read directly, never inferred from the ledger.
- 54 public tables; `people`=42, `children`=10, `events`=91.
- `shared_statuses`: **ABSENT**. `can_view_shared_status` / `_connected_children`: **ABSENT**.

## 0076 outcome — APPLIED (fully present, matching)

**Procedural note, stated plainly:** I attempted a wrapper `begin … rollback` dry run. The migration file carries **its own `begin;` … `commit;`**, so the inner commit made my rollback a no-op and the reviewed file applied itself. That was my error in the harness, not a database fault.

Post-application verification (not re-applied):

- 6 columns exactly: `person_id, emoji, text, eta_text, set_at, expires_at`
- 3 constraints: `shared_statuses_pkey`, `shared_statuses_person_id_fkey` (ON DELETE CASCADE), `shared_statuses_text_shape`
- RLS **enabled and forced**; 4 policies: `shared_statuses_read`, `_write_own`, `_update_own`, `_delete_own`
- Both functions `SECURITY DEFINER`, `search_path=public`
- `_connected_children`: anon **false**, authenticated **false** — private
- `can_view_shared_status`: anon **false**, authenticated **true**, service_role **true**
- 0 rows; no test residue

### Defect found (recorded, not fixed)

`0076` grants only to `authenticated`. **`service_role` holds no SELECT/INSERT/UPDATE/DELETE** on `shared_statuses` (only REFERENCES/TRIGGER/TRUNCATE), while `people`, `events` and `orbit_alerts` grant it fully. Consequence: `npm run db:checksum` now fails **HTTP 403** on `shared_statuses`, because the pinned revision adds that table to its `TABLES` list. `demo_families` (0049) has the same grant shape, so this is a precedent rather than a unique slip — but it breaks the new checksum path. The fix is a one-line grant (`select` to `service_role`); it was **not** applied because it would be an unreviewed schema change inside a deployment window.

## Deploy — per process

| Ports | PID | Revision | Notes |
| --- | --- | --- | --- |
| 4001–4008 | `98183` | `54e8abe` | `DEMO_LOGIN_ENABLED=1`; `DEMO_CLOCK` **unset**, deliberately preserved as served |
| 4010 | `95477` | supergraph `184f08cb…` | `router.yaml`, health **8090** |
| 4012 | `95478` | supergraph `184f08cb…` | alt config, health **8092** |
| 5051 | `95929` | 13 tools, 0 load errors | explicit schema path in config |
| 4200 | `96204` | `54e8abe` | `ROSINA_GRAPHQL_URL=http://127.0.0.1:4012/`, `ROSINA_MCP_URL=http://127.0.0.1:5051/mcp`, `INVITE_LIVE` off |
| 5189 | `64228` | untouched | not restarted |

**Two deployment faults found and fixed inside the window:**

1. **Identity map missing.** A fresh worktree has no `data/identity-map.json`, so every persona answered `NO_SEEDED_IDENTITY`. Linked relatively to the known-good 24-entry map; Kendra READY after restart.
2. **Wrong composition config.** `supergraph.local.yaml` composes from **committed, stale SDL** (`schema/*.graphql`) and produced an artifact missing `myChildren`, `jobTimeline`, `orbitStatus`, `careFacts` — 10/13 MCP operations failed validation. Recomposed with **`supergraph.yaml`**, which introspects the running subgraphs → `184f08cb888741283fbed2eebc802cae311258419d00a9c380008d9ce5c0cd2e`. MCP schema **valid**, Router API **valid**, **13 documents / 0 invalid**.

`--schema` is **not** a flag on `apollo-mcp-server-v2.1.0` (it takes `<CONFIG>` only); the explicit schema path is carried in the config instead.

## Reset

`POST /api/demo/reset` on 4008 as **kendra** (`p_mom`, a fictional demo parent) — **HTTP 200, 14.5 s**, `droppedSessionCache: true`.
Restored: people 17, `shared_statuses` 1, households 5, household_members 15, routines 34, care_facts 9, events 90, recorded_places 11; coordination_jobs 2, attempts 3.
Not `npm run reset`; `ops/run-evidence.mjs` not used.

## Assertions

- **Cast checksum `f022ccf8311e7561` — MATCHES** the required value (`ops/stack-health.mjs`; hashes `care_facts`/`routines`/`grants`).
- `ops/stack-health.mjs` → **HEALTHY (0 failing)**. Picker personas **0 unready of 12**; MCP token forwarding PASS; MCP `MyChildren` = 3; MCP anonymous refused; Rosina chat named 3/3 children; notice→plan 200.

## Consumer-path probes — 9/9 PASS

| Probe | Result |
| --- | --- |
| Owner (André) sees his own status | PASS — "Changing a diaper" |
| Kendra (connected parent) sees it | PASS |
| Dana (unconnected) sees **no** status | PASS — `null` |
| Anonymous read refused | PASS — `UNAUTHENTICATED` |
| `can_view_shared_status(Andre)` — Kendra | PASS — `true` |
| `can_view_shared_status(Andre)` — Dana | PASS — `false` |
| Direct `_connected_children` as authenticated | PASS — `403 42501 permission denied` |
| Guide `myChildren` | PASS — 12 sandbox children, all read-only scopes |
| Guide write refused | PASS — `DEMO_GUIDE_READ_ONLY` |

**Two earlier FAILs were my harness, not the system, and are recorded as such:** Whitfield, Priya and Loretta are legitimately connected to Nora (teacher grant, sitter grant, grandmother relationship) so they correctly see the status; and `ChildAccess` has no `id` field, so my selection returned `data: null`. Re-run against Dana and against `{ child { id person { displayName } } scopes }` — green. **No defect is claimed from either.**

## Close

- Pinned `54e8abe`; all restarted processes serve `54e8abe` **except 5189, which was deliberately not touched**.
- Migration: 0076 applied and verified; additive, left in place.
- Artifacts: supergraph `184f08cb…`, MCP config `1e3ec3ae…`, router config `74a40fd2…`, 4012 config `e361e148…`.
- **Counts:** rehearsal 14/14 · probes 9/9 · health 0 failing · defects found 1 (service_role grant gap, unfixed) · faults fixed in-window 2.
- Rollback: previous configs and supergraph retained; `fg81-prev` container retained; migrations are forward-only and remain applied.
