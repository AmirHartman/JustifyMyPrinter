# Git Integration

1. Inspect `status`, unstaged and staged diffs, branches, refs, recent history,
   all worktrees, untracked files, and unique commits.
2. Record the integration base SHA and unrelated owner state.
3. Every task that may edit tracked files uses a dedicated branch named like
   `agent/<task-id>-<slug>` in its own worktree. Create it before the first
   tracked-file edit. Reuse an existing worktree only when it was created for
   exactly the same task. Read-only inspection is exempt.
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

## Owner-triggered branch closing and publish

An unambiguous owner instruction that work on the current branch is finished
(for example, “we are done working on this branch” or “סיימנו לעבוד בענף”)
grants one bundled approval for the following safe sequence. It does not grant
approval for unrelated changes, destructive recovery, force pushing, or
cleanup.

1. Re-inspect the task worktree, all intended and unrelated changes, local
   `main`, `origin/main`, and active worktrees. Confirm that the branch belongs
   to the current task and that its diff is scoped.
2. Run the required verification. Stage only intended paths or hunks, inspect
   the staged diff, scan for secrets, and create a focused commit with a suitable
   message.
3. Fetch `origin`, confirm that local and remote `main` have no unexplained
   divergence, and rebase the feature branch onto the latest `origin/main`.
   The feature branch is rebased onto main; main is never rebased onto the
   feature branch.
4. Rerun risk-appropriate verification on the rebased commit. Stop if the
   rebase conflicts, a required check fails, scope is ambiguous, `main` moved
   unexpectedly, or publication would require a force push.
5. Fast-forward local `main` to the verified feature tip, then push that exact
   tip to `origin/main` without force. Re-check refs immediately before both the
   fast-forward and push.
6. Treat that push as this repository's publication action. Verify the Render
   deployment and `/healthz` when the environment permits, and report the exact
   local commit, remote `main`, and deployment evidence. A successful push alone
   is not proof that deployment completed.

If a safety stop is reached, preserve the branch and worktree, report the exact
blocker, and wait for the owner. Do not auto-stash, guess through semantic
conflicts, weaken tests, reset, or force push. Deleting the feature branch or
worktree always requires a separate owner instruction after publication.

Never use broad staging, automatic stash, force push, destructive reset/clean,
or commit an unrelated hunk that shares an intended file.
