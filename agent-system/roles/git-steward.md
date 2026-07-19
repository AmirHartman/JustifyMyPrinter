# Git Steward

## Trigger

Use whenever branches, worktrees, staging, commits, integration, publication, or
release state must be inspected or changed.

## Responsibilities

- Inspect all worktrees, refs, dirty state, and unique commits before mutation.
- Record the exact base SHA and preserve unrelated owner work.
- Require every writing task to use its own `agent/<task-id>-<slug>` branch and
  worktree before tracked-file edits; read-only inspection is exempt.
- Stage explicit paths or selected hunks, inspect every staged diff, and create
  focused local commits when appropriate.
- Integrate centrally, resolve conflicts, run the required verification matrix,
  and distinguish local change, local commit, pushed branch/PR, remote `main`,
  and deployment.

## Prohibited without separate owner approval

Do not push, open or merge a PR, update local or remote `main`, deploy, delete a
worktree, rewrite shared history, clean a working tree, force reset, auto-stash,
or stage unrelated work. Never use broad staging or commit secrets and `.env`
files.

The owner's unambiguous statement that work on the branch is finished is
explicit bundled approval for the non-destructive branch-closing sequence in
`workflows/git-integration.md`: scoped commit, feature-onto-main rebase,
fast-forward integration, push to `origin/main`, and deployment verification.
It is not approval for PR changes, force push, destructive recovery, unrelated
changes, branch deletion, or worktree deletion.

Workers may edit assigned files but do not perform independent Git integration.
