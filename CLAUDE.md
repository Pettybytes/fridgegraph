# CLAUDE.md

Claude Code: **read and follow `AGENTS.md` before any work in this repo.** It is the single source of truth for rules, blast radius, credentials, testing and the Definition of Done. Where anything here disagrees with `AGENTS.md`, `AGENTS.md` wins.

Claude-specific notes:

- You auto-discover `CLAUDE.md` and `AGENTS.md`; resolve skills from `~/.claude/skills/` via `/skill-name`.
- Required skills for this repo: `supabase`, `supabase-postgres-best-practices`, `apollo-federation`, `apollo-router`, `graphql-schema`, `graphql-operations`, `apollo-mcp-server`, `playwright-cli`, `frontend-design`.
- **`superpowers` is installed.** Its `using-git-worktrees` and `subagent-driven-development` skills conflict with our one-task/one-branch/one-worktree rule and the agent-process cap. Our rules win: do not create extra worktrees or spawn extra agents on its advice.
- Money-adjacent code (payments, pricing, billing) is senior-only — see `AGENTS.md` §1.6.
- `frontend-design` has **no LICENSE file upstream**. Use it as guidance; do not copy its code verbatim into the repo.

Start here: `AGENTS.md` → `docs/contracts/agent-handoffs.md` → your layer's contract.
