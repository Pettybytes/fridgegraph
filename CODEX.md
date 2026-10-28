# CODEX.md — read me first

Codex: **`CODEX.md` is not auto-discovered.** Codex loads `AGENTS.md` from the working directory automatically, so start by reading that file in full. If you are resuming a session and cannot confirm you have it, open `AGENTS.md` explicitly.

Measured behaviour for the Codex CLI in use (`codex-cli 0.165.0`), verified with `codex debug prompt-input`:

- `AGENTS.md` in the **working directory** is loaded automatically. Verified by marker.
- A **nested** `AGENTS.md` (e.g. `sub/AGENTS.md`) is **not** auto-loaded. Reference it by path if you need it.
- Skills are discovered from **`~/.agents/skills/`** and **`~/.codex/skills/`**. Verified: every skill installed to `~/.agents/skills` appears in the Codex prompt's skills list.
- There is no `codex skills` subcommand in this version. Skills are not installed or managed by Codex — they are read from those two directories.

Required skills for this repo live in `~/.agents/skills/`: `supabase`, `supabase-postgres-best-practices`, `apollo-federation`, `apollo-router`, `graphql-schema`, `graphql-operations`, `apollo-mcp-server`, `playwright-cli`, `frontend-design`.

Rules that bind you: `AGENTS.md` §1. Never merge, never tag, never read `.env`, never invent a test result.
