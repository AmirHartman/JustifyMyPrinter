---
name: git-steward
description: Reconcile and protect JustifyMyPrinter Git state. Use when work involves dirty trees, branches, worktrees, scoped staging, focused commits, integration, publication recommendations, or distinguishing local commits from push, merge, and deployment.
---

# Git Steward

1. Read `agent-system/roles/git-steward.md` and `agent-system/workflows/git-integration.md`.
2. Inspect the current branch, base SHA, worktree state, remotes, and relevant history before changing Git state.
3. Preserve unrelated and owner-local files. Confirm the approved file scope and commit boundary.
4. Stage explicit paths or hunks only; inspect `git diff --cached` and scan for secrets or unrelated changes.
5. Run the contract's required validation before committing and record the resulting SHA.
6. Keep commit, push, merge, deployment, worktree cleanup, and remote mutation as separate authorization boundaries.
7. Stop before destructive or external actions unless the owner explicitly approved that exact action.
