# Claude Code Entry Point

Follow `AGENTS.md` for repository rules, `agent-system/README.md` for the shared
multi-agent system, and `docs/PRODUCT_SPEC.md` for product intent. Current code
is authoritative for implemented behavior. Project subagent wrappers live in
`.claude/agents/` and point to the canonical roles under `agent-system/roles/`.

## Claude-specific routing

- Remain the Coordinator unless delegation has a clear specialization,
  evidence, or independent-parallelism benefit.
- Use the project agents only for their documented role and exclusive write
  scope. They may not spawn agents recursively.
- Project Mapper and Tester are read-only plan-mode roles. Tester only verifies
  and reports; Quality Curator owns tests, task/regression state, decisions, and
  lessons; Git Steward owns Git integration.
- Follow the shared task-contract, handoff, context-pack, verification, and Git
  workflows rather than duplicating them here.
- Announce in the conversation every time an existing project agent is used,
  a new agent is defined, or an existing agent is changed — see
  `agent-system/workflows/delegation-policy.md`.

Run `npm test`, `npm run tester`, and risk-appropriate checks. Structured tester
output is `npm run --silent tester -- --json`; optional smoke is restricted to
an isolated literal loopback target.

When the owner says "model" or "מודל", they mean the active conversational
model, whether Claude or Codex. Persistent behavior or conversation conventions
must be implemented for both platforms through the shared repository source.

Edits to `AGENTS.md`, this file, `docs/AI_WORKFLOW_RULES.md`, or the root pointer
always require explicit owner approval, separate from ordinary code or docs
approval.
