---
name: agent-system
description: Route safe, token-efficient multi-agent work in JustifyMyPrinter. Use when a repository task may benefit from specialized agents, parallel exploration, explicit task contracts, independent verification, or coordinated integration across Claude and Codex.
---

# Agent System

1. Read `agent-system/README.md` and `agent-system/workflows/delegation-policy.md`.
2. Keep work with the coordinator unless delegation has a clear evidence, risk, or parallelism benefit.
3. When delegating, create a complete contract from `agent-system/contracts/task-contract.schema.json`; assign exclusive write scopes and explicit stop conditions.
4. Prefer zero to two workers. Use three only for exceptional, genuinely independent work. Never allow recursive delegation.
5. Give each worker the smallest context pack that preserves the relevant invariants and acceptance criteria.
6. Require a handoff matching `agent-system/contracts/agent-handoff.schema.json`.
7. Route independent verification to Tester, durable quality changes to Quality Curator, and all staging or integration to Git Steward.
