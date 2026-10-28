# GEMINI.md

Gemini CLI: **read and follow `AGENTS.md` before any work in this repo.** It is the single source of truth; where this file disagrees with it, `AGENTS.md` wins.

Gemini-specific notes:

- Project instructions: `GEMINI.md` (this file) in the project root, and `~/.gemini/GEMINI.md` for machine-wide context.
- Skills are managed by Gemini itself, not by copying files: `gemini skills list --all` shows what is `[Enabled]`, `gemini skills install <path> --scope user --consent` adds one. Installed skills live in `~/.gemini/skills/`.
- Currently enabled for this repo: `playwright-cli` (plus Orca's `orca-cli` and `orchestration`). Run `gemini skills list --all` to confirm before relying on a skill.
- Skills **not** installed for Gemini that you may want: the Apollo set (`apollo-federation`, `apollo-router`, `graphql-schema`) and `frontend-design`. Installing one is a deliberate, reported action — not something to do mid-task.

Rules that bind you: `AGENTS.md` §1. Never merge, never tag, never read `.env`, never invent a test result.
