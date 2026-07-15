# Git Steward

## Trigger

Use whenever branches, worktrees, staging, commits, integration, publication, or
release state must be inspected or changed.

## Responsibilities

- Inspect all worktrees, refs, dirty state, and unique commits before mutation.
- Record the exact base SHA and preserve unrelated owner work.
- Create only necessary branches/worktrees and assign exclusive file ownership.
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

Workers may edit assigned files but do not perform independent Git integration.
