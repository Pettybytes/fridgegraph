# Contract — agent handoffs

Every coding agent in FridgeGraph follows this. It defines what a handoff contains, what each agent is for, which skills it must use, and what it may never do.

## 1. Handoff packet

A task is not handed off until all seven are present. A packet missing any line is a **refused handoff** — the receiving agent stops and asks.

```
BRANCH:        <branch name>  WORKTREE: <absolute path>
TASK:          one sentence, one outcome
LAYER:         one of: schema | auth | graph | ops | frontend | docs
TOUCHED:       exact paths expected to change
DONE WHEN:     the command(s) that must pass, with expected output
NOT DOING:     explicit out-of-scope list
BLOCKERS:      what is unknown, and what you already ruled out
```

Rules:

- **One task per packet.** Two outcomes = two packets = two worktrees.
- **`TOUCHED` is a promise, not a guess.** If mid-task you must edit outside it, amend the packet and say so before editing.
- **`DONE WHEN` must be a command**, not an adjective. "Works" is not done. `npm run check && npm run typecheck` is done.
- **Never hand off an unfinished secret.** No credential, token or `.env` value crosses a handoff. Pass the *name* of the variable and let the runtime supply it.

## 2. Receiving a handoff

1. Confirm the branch and worktree: `git rev-parse --abbrev-ref HEAD; pwd`.
2. Read `AGENTS.md`, then the contract for `LAYER`.
3. Re-run `DONE WHEN` yourself **before** changing anything — establish the baseline is actually green or actually red.
4. If the packet contradicts the repo (file gone, section stale), stop and report the contradiction. Do not force the step.

## 3. Agent roles

| Agent | Best at | Definition of done | Forbidden moves |
| --- | --- | --- | --- |
| **Claude Code** | multi-file refactors, auth/authz reasoning, schema work | `npm run typecheck` + `npm run check` + the named proof run and pasted | merging; touching payments without senior review; copying `frontend-design` code verbatim (no upstream LICENSE) |
| **Codex** | focused implementation, test-first patches, surgical diffs | same three, plus a diff review of its own changes | creating worktrees on its own initiative; reaching outside its declared layer |
| **Gemini CLI** | exploration, broad reading, browser checks via Playwright | same three, plus a Playwright run for any visual claim | installing skills or tools mid-task without reporting it |
| **Hermes** | the pickup job's reasoning loop, skill-shaped workflows | same three, plus an explicit statement of which model/provider produced the result | running with `--yolo` on this repo; installing skills mid-task |
| **OpenClaw** | orchestration, long-running ops, evidence runs | same three, plus a durable artifact path for any long run | acting as the authority for merges; editing this contract unilaterally |

**No one merges on an agent's say-so.** An agent reports; Bryan merges. "Tests pass" is a report, not a permission.

## 4. Skills: where each agent finds them

Verified on this machine, 2026-10-28. Discovery differs per agent — copying a file is not the same as installing it.

| Agent | Skills location | How discovery was proven |
| --- | --- | --- |
| Claude Code | `~/.claude/skills/` | invoked as `/skill-name`; documented auto-discovery |
| Codex CLI 0.165.0 | `~/.agents/skills/` + `~/.codex/skills/` | `codex debug prompt-input` lists every skill in `~/.agents/skills`; there is **no** `codex skills` subcommand |
| Gemini CLI 0.26.0 | `~/.gemini/skills/` | `gemini skills list --all` reports `[Enabled]` |
| Hermes 0.22.5 | `~/.hermes/skills/<category>/` | `hermes skills list` reports `enabled` |
| OpenClaw | `~/.agents/skills/` | present in the session's own skill catalog |

Instruction files: Claude auto-detects `CLAUDE.md`; Codex auto-loads `AGENTS.md` **from the working directory only** (nested `AGENTS.md` files are not auto-loaded — verified); Gemini reads `GEMINI.md`; Hermes carries instructions in `SKILL.md` files; OpenClaw reads its agent/workspace context files.

**Therefore:** `AGENTS.md` at the repo root is the one file every agent sees. That is why it holds the rules and the others only point at it.

## 5. Required skills

Installed and verified discoverable:

| Skill | Source | Licence | Why |
| --- | --- | --- | --- |
| `supabase`, `supabase-postgres-best-practices` | github.com/supabase/agent-skills | MIT | every DB read/write, RLS, migrations |
| `apollo-federation`, `apollo-router`, `apollo-server`, `apollo-client`, `apollo-mcp-server`, `apollo-connectors`, `apollo-router-plugin-creator` | github.com/apollographql/skills | MIT | the graph, the router, MCP |
| `graphql-schema`, `graphql-operations` | github.com/apollographql/skills | MIT | SDL and operation authoring |
| `graphos-factory`, `rover` | github.com/apollographql/skills | MIT | composition and registration |
| `playwright-cli` | @playwright/cli 0.1.22 (Microsoft) | Apache-2.0 | every browser/visual verification |
| `frontend-design` | github.com/anthropics/skills | **none upstream** | visual judgement for `web/` |

Notes:

- `frontend-design` ships **no LICENSE file**. Use it as guidance only; do not copy its code into the repo.
- The CLI binary is **`playwright-cli`**, not `playwright`.
- Gemini has only `playwright-cli` from this list. If a Gemini task needs Apollo skills, installing them is a reported action, not a silent one.

## 6. Handoff out

Before you stop, write a handoff packet for whoever is next — including a future you. If the next person cannot start from your packet without reading your transcript, the packet is incomplete.
