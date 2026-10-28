# Branch and worktree policy

## 1. The rule

**One task = one branch = one worktree.** Never work on `main`. Never start a second unrelated task in an existing worktree.

## 2. Who may do what

| Action | Agents | Bryan |
| --- | --- | --- |
| Create a branch / worktree | yes | yes |
| Commit on own branch | yes | yes |
| Push own branch | yes | yes |
| Open a **draft** PR | yes | yes |
| Mark PR ready for review | ask first | yes |
| **Merge to `main`** | **never** | yes |
| Tag / release | **never** | yes |
| Force-push a shared branch | **never** | ask |

**No one merges on an agent's say-so.** "All checks pass" is a report. Permission is an explicit sentence from Bryan in that session.

## 3. Naming

```
setup/<topic>      environment, scaffold, tooling       e.g. setup/web-scaffold, setup/agents-contracts
feat/<topic>       one feature, one outcome            e.g. feat/pickup-job-state-machine
docs/<topic>       documentation and contracts only    e.g. docs/agent-governance
fix/<topic>        a defect with a reproducible repro  e.g. fix/shadcn-alias-paths
```

Worktrees are **siblings of the main checkout**, never nested inside it:

```
~/Desktop/bentley/fridgegraph          main (protected, read-only to agents)
~/Desktop/bentley/fridgegraph-web      setup/web-scaffold
~/Desktop/bentley/fridgegraph-gov      setup/agents-contracts
```

## 4. Starting a task

```bash
cd ~/Desktop/bentley/fridgegraph
git fetch origin
git worktree add ../fridgegraph-<task> -b <type>/<topic> origin/main
cd ../fridgegraph-<task>
git rev-parse --abbrev-ref HEAD   # confirm, do not assume
```

A new worktree contains **no `.env`** — it is gitignored. That is intentional: worktree agents are credential-free. If a task genuinely needs a secret, say so and stop.

## 5. Finishing a task

1. `npm run typecheck` and `npm run check` pass.
2. The named proof/test was run by you, with output pasted into the report.
3. `git status` shows only files inside your layer.
4. Commit in small, described steps. No mixed commits (a doc fix hiding inside a code change).
5. Push your branch, open a **draft** PR with a body that states what was proven and what was not.
6. Write a handoff packet (`docs/contracts/agent-handoffs.md` §1).

## 6. Merge discipline

- Draft PRs stay draft until Bryan says otherwise.
- A PR states: what changed, what was proven, what is unproven, and any open risk. A PR that claims "everything works" without evidence is rejected.
- Squash on merge; the PR body becomes the commit message.
- Never merge your own PR as an agent. Never merge someone else's.

## 7. Cleanup

```bash
cd ~/Desktop/bentley/fridgegraph
git worktree remove ../fridgegraph-<task>
git branch -d <type>/<topic>
```

Branch cleanup after merge is Bryan's call, not the agent's — a merged branch is still evidence until someone decides it is not.
