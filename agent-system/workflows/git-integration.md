# Git Integration

1. Inspect `status`, unstaged and staged diffs, branches, refs, recent history,
   all worktrees, untracked files, and unique commits.
2. Record the integration base SHA and unrelated owner state.
3. Use branch names such as `agent/<task-id>-<slug>` and create a worktree only
   for genuinely independent writing work.
4. Assign exclusive write scopes. Workers return focused commits or an explicit
   unstaged handoff; they do not integrate themselves.
5. Stage explicit paths or hunks, inspect `git diff --cached`, verify no secrets
   or unrelated work, and create a focused commit.
6. Integrate on a dedicated local branch, resolve conflicts centrally, inspect
   the combined diff, and run the complete verification matrix.
7. Report branch, worktree, commit SHAs, push/PR state, `main` state, deployment
   state, and a recommended next action.

A local commit is not a push; a push is not a merge; a merge is not a
deployment. Updating local `main`, pushing, PR changes, remote `main`, deployment,
history rewriting, and worktree cleanup each require appropriate owner approval.

Never use broad staging, automatic stash, force push, destructive reset/clean,
or commit an unrelated hunk that shares an intended file.
