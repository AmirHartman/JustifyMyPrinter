# JustifyMyPrinter Agent System

This directory is the vendor-neutral source of truth for coordinated AI work in
this repository. Platform wrappers under `.codex/`, `.claude/`, and `.agents/`
must stay thin and point here instead of copying role or workflow text.

## Source order

1. The owner request and approved task contract.
2. `AGENTS.md` for repository-wide safety and product invariants.
3. The applicable role in `agent-system/roles/`.
4. The applicable workflow in `agent-system/workflows/`.
5. `docs/PRODUCT_SPEC.md` for intended product behavior.
6. Current code for implemented behavior.

Archived builder plans and raw model memory are context only. Repository
evidence wins when they disagree.

## Roles

| Role | Use when |
|---|---|
| Coordinator | The active parent needs to classify risk, partition work, and integrate results. |
| Project Mapper | A read-only execution-path or impact map will reduce uncertainty. |
| Backend and Security | API, authorization, sessions, schema, or private DTO boundaries change. |
| Orders, Pricing and Inventory | High-risk order state, price, payment, waste, or material accounting changes. |
| Frontend RTL | Browser flows, HTML, CSS, client state, accessibility, mobile, or RTL behavior changes. |
| Tester | An independent read-only verification run is needed. |
| Quality Curator | Tests, regression state, task state, or durable evidence-based knowledge must change. |
| Git Steward | Branches, worktrees, commits, integration, or publication decisions are involved. |

The Coordinator normally uses zero to two workers. Three workers are reserved
for genuinely independent scopes. Four threads are a ceiling, and workers may
not recursively spawn agents.

## Required workflow

Use `task-lifecycle.md` for the end-to-end sequence, `delegation-policy.md` for
whether to delegate, `context-packs.md` for worker inputs, `git-integration.md`
for repository state, `verification-matrix.md` for evidence, and
`learning-loop.md` for persistent knowledge.

Delegated units use `contracts/task-contract.schema.json`. Workers return a
compact handoff conforming to `contracts/agent-handoff.schema.json`.

## Safety

- Assign exclusive write ownership; never let two agents edit the same file or
  overlapping region concurrently.
- Workers do not merge, push, deploy, update `main`, or expand their scope.
- Tester verifies but does not edit. Quality Curator curates tests and state but
  does not fix product code.
- Do not store secrets, raw transcripts, speculative memory, fabricated token
  counts, elapsed time, or cost claims.
- Future changes to `AGENTS.md`, `CLAUDE.md`, or AI workflow guidance still need
  explicit owner approval.
