# Reconciliation — 0055 state and process revisions (2026-11-01)

Both reports were partly wrong. This is measured from the database and the processes, not from
earlier prose.

## 1. Migration 0055 — ALL intended effects are present

Read directly with `pg_proc`, `pg_class`, `information_schema.column_privileges`.

| 0055 effect | Measured |
|---|---|
| `orbit_share_for`, `orbit_place_for`, `orbit_thankyou_for` | present |
| `orbit_photo_access`, `preview_orbit_share`, `register_orbit_photo` | present |
| `orbit_audience_for`, `draft_orbit_share`, `activate_orbit_alert`, `respond_to_orbit_alert`, `close_orbit_alert`, `orbit_vocab_ok` | present (12/12) |
| PUBLIC EXECUTE revoked | **0 of 12** carry a ``=X/…`` (empty-grantee) entry — only `postgres` and `authenticated` hold EXECUTE |
| Table-level SELECT revoked | holders are **only** `postgres` and `service_role`; `authenticated` and `anon` hold **none** |
| Sensitive column SELECT revoked | `authenticated` holds exactly the **15 safe columns** (`id, child_id, created_by, created_at, status, draft_version, activated_by, activated_at, closed_by, closed_at, close_outcome, job_id, message_hash, sandbox, fixture`); `wear_color, photo_id, minimal_message, last_seen_place_id, last_seen_at, wearing, hair, carrying, distinctive` absent |
| Post-close gate in the accessor | `orbit_share_for` body gates on `status = 'ACTIVE'` **and** `_orbit_is_audience_member` — the post-0055 form, not the 0032 `status`-only form |
| `orbit_place_for` membership gate | present |
| `proof_attacker*` table grants | none left |

**Conclusion: 0055 is fully applied.** The reported "0055 false" came from my own probe asking for a
column `redacted_at` that 0055 never creates — a fabricated check, not a finding.

**Why the dry run fails:** `ops/0055-dry-run.mjs` asserts the **pre-migration** state as a
precondition ("authenticated holds TABLE-level SELECT"). After the migration that is necessarily
false, so the script is not re-runnable against a migrated database. That is a defect in the dry run,
not evidence about the schema.

### Migration-tracking record, and why it disagrees
`supabase_migrations.schema_migrations` stops at **0011** — it has rows for 0001–0011 only. There is
no other migration table in `public`. The `ops/00NN-apply.mjs` scripts execute the SQL file with a
plain client and **write no tracking row** (0055-apply.mjs only runs the file and prints three
post-checks). So 0012 onward — including 0053, 0054 and 0055 — were applied out-of-band and were
never recorded. The tracker is stale by construction, not contradicted by the schema.

**Proposed repair (not applied — Bryan decides):** backfill tracking rows for 0012–0055 after
verifying each migration's effects the way 0055 was verified here, then change the apply scripts to
insert their own row in the same transaction. Do not backfill from "it looks applied".

## 2. Process revisions — HEAD is not proof of loaded code

`405f7a7` is **not on GitHub** (`GET /repos/.../commits/405f7a7` → 422). It is a **local** commit on
branch `deploy/main-238f719` in the deploy checkout, made after the earlier receipt that said
`238f719`.

`git diff --name-only 238f719 405f7a7` → exactly three files:
`docs/evidence/62-orbit-redaction.json`, `docs/handoff/HANDOFF.md`, `ops/orbit-redaction-proof.mjs`.
So it is **not only HANDOFF/evidence** — one ops proof script changed too — but **no runtime source
changed**: nothing under `src/`, `supabase/`, or the router/supergraph configuration.

| Port | PID | Start time | Worktree | Launcher | HEAD | Startup revision evidence |
|---|---|---|---|---|---|---|
| 4008 | 64010 | 14:55:01 | `fridgegraph-deploy-238f719` | `node --import tsx src/main.ts` | `405f7a7` | tsx transpiles at import, no build cache; `src/main.ts` mtime 14:54:03 precedes start |
| 4010 | 63340 | 14:54:44 | same | `router-v2.18.0 --supergraph .runs/supergraph-alt.graphql --config router.yaml` | `405f7a7` | supergraph file mtime 14:54:44 = start |
| 4012 | 63431 | 14:54:49 | same | router + `--config …/fridgegraph-alt-router-6a12e1a.yaml` | `405f7a7` | same supergraph file |
| 4101–4107 | 62199 | 14:54:29 | same | `node --import tsx ops/stack-alt.mjs` (one process, several ports) | `405f7a7` | `ops/stack-alt.mjs` mtime 14:54:03 precedes start |
| **4200** | **20096** | **16:04:07** | `fridgegraph-refresh-539a8b4` | `node --env-file=.env --import tsx src/rosina/server.ts` | **`539a8b4`** | clean tree, code read at start |
| 5051 | 64689 | 14:55:15 | `fridgegraph-deploy-238f719` | `apollo-mcp-server-v2.1.0 …/fridgegraph-alt-mcp-6a12e1a.yaml` | `405f7a7` | config path carries `6a12e1a` |
| 4118 | 73928 | 15:00:32 | `fridgegraph-voice-534b1ca` | `node --env-file=.env ops/voice-turn-server.mjs` | `534b1ca` | plain node, no bundler |
| 5189 | 77769 | Oct 31 18:04:02 | `fridgegraph-signature-village-orbit/web` | `vite --host 127.0.0.1 --port 5189` | `dd14400` | **dev server: HMR can serve code newer than HEAD; HEAD alone is not proof** |

**Hot-reload:** 5189 only. Every node process is plain `node`/`tsx` (no watch flag observed) — code is
loaded at start and does not change afterwards. The two routers and the MCP server read their
supergraph/config file at start.

**Untracked files in the deploy checkout** (dirty=2): `docs/evidence/62b-orbit-redaction-run.jsonl`
and `ops/deploy-verify.mjs`. Neither is imported by any running process.

**What this means for earlier receipts:** "all services at `238f719`" was true when written; the
three-file commit `405f7a7` landed afterwards in the same checkout, and all five processes were
started from it. Both statements describe the same running code — no runtime difference between
`238f719` and `405f7a7`.
