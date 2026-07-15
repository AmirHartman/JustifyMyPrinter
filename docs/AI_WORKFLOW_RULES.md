# AI Workflow Rules

`AGENTS.md` contains repository-wide safety and product invariants.
`agent-system/README.md` is the vendor-neutral source for roles, workflows,
contracts, verification tiers, and durable learning. Claude and Codex wrappers
must remain thin platform adapters to that shared source.

## Lifecycle

1. Ground the request in current code, relevant `docs/PRODUCT_SPEC.md` sections,
   Git state, and owner constraints. Archived plans and memory are context only.
2. Classify affected domains, risks, dependencies, and evidence needed. Resolve
   product or interface conflicts before implementation.
3. Work directly by default. Delegate only when specialization, independent
   review, or genuinely non-overlapping parallel work justifies the briefing and
   integration cost.
4. Give every worker a task contract, exclusive write scope, minimal context
   pack, forbidden actions/files, acceptance criteria, verification, handoff,
   and stop conditions. Workers never spawn agents.
5. Integrate through Git Steward with explicit staging and reviewed diffs, then
   run an independent Tester pass.
6. Route durable regressions, task state, decisions, and lessons to Quality
   Curator after evidence exists.

Normally use zero to two workers; three is exceptional. Parallel work requires
agreed interfaces and non-overlapping writes. Work that depends on an unresolved
contract or touches the same central file proceeds sequentially.

## Verification and learning

Use `agent-system/workflows/verification-matrix.md` and
`testing/test-manifest.json`. Run `npm test` and `npm run tester`, then add
authorized T3-T5 checks in proportion to risk. Report commands, exact outcomes,
evidence tiers, mutation level, skips, proof limits, and unresolved risk. Only
executed check failures affect tester exit status; task reminders and skips do
not.

Tester is strictly read-only. The quality lifecycle is: Tester finding →
Quality Curator regression → specialist fix → independent Tester rerun →
Quality Curator durable-status update. Never persist secrets, raw transcripts,
speculation, or fabricated metrics as project knowledge.

## Git and handoff

Preserve unrelated owner work. Stage explicit paths or hunks, inspect the staged
diff, scan for secrets, and keep commits focused. A local commit is not a push;
a push is not a merge; a merge is not a deployment. Publication, `main`
updates, deployment, destructive operations, and worktree cleanup require their
own authority.

Final reports distinguish changed behavior and files, validation and skips,
remaining assumptions or risks, local commits, remote state, deployment state,
and the next action that needs owner approval.

## Guidance governance

Agents may propose corrections when guidance drifts, but every edit to
`AGENTS.md`, `CLAUDE.md`, this file, or the root `AI_WORKFLOW_RULES.md` pointer
requires explicit owner approval. Approval for other work never implies it.
