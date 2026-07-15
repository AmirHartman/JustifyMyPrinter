# Agent-System Decisions

Only stable, evidence-backed architecture decisions belong here.

## 2026-07-15 — Shared canonical instructions

- **Decision:** Keep long role and workflow instructions under `agent-system/`;
  keep Claude, Codex, and skill wrappers thin.
- **Evidence:** The previous Tester duplicated responsibilities across wrappers
  and shared workflow files, producing contradictory write permissions.
- **Scope:** Repository AI development behavior only.

## 2026-07-15 — Independent verification and curation

- **Decision:** Tester is read-only; Quality Curator owns tests, regression/task
  state, and approved durable knowledge.
- **Evidence:** The previous Tester could author a test, run it, and persist its
  own conclusion in one invocation.
- **Scope:** All repository verification and adaptive learning.

## 2026-07-15 — Conservative delegation

- **Decision:** Normal worker count is zero to two, exceptional maximum three,
  infrastructure ceiling four threads, and maximum depth one.
- **Evidence:** Central frontend, order, tester, and guidance files make broad
  fan-out collision-prone and context-expensive.
- **Scope:** Claude and Codex project orchestration.
