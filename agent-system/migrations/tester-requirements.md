# Tester Requirement Migration

This matrix accounts for every responsibility in the former Tester skill,
Claude agent, and shared workflow. `Tester` now verifies and reports without
writes. `Quality Curator` owns durable quality state, and `Coordinator` routes
implementation.

| Requirement | Former behavior | New owner | Validation evidence |
|---|---|---|---|
| TR01 | Read the system map, regressions, and task ledger before testing | Tester | `agent-system/roles/tester.md`; `.agents/skills/tester/SKILL.md` |
| TR02 | Treat "model" or "מודל" as the active Claude or Codex conversation | Coordinator and platform entry points | `AGENTS.md`; `CLAUDE.md` after guidance integration |
| TR03 | Reconcile remembered task candidates against repository evidence | Tester reports; Quality Curator persists | `agent-system/roles/tester.md`; `agent-system/roles/quality-curator.md` |
| TR04 | Show `open` and `later` tasks separately without affecting test exit | Tester | `scripts/run-tester.js`; `tests/tester-runner.test.js` |
| TR05 | Run the deterministic full-system tester | Tester | `.agents/skills/tester/SKILL.md`; `.claude/agents/tester.md` |
| TR06 | Run optional local-only, read-only smoke checks | Tester | `scripts/run-tester.js`; `testing/test-manifest.json` |
| TR07 | Report severity, evidence, regression results, and skipped tiers | Tester | `agent-system/roles/tester.md`; `agent-system/workflows/verification-matrix.md` |
| TR08 | Hand an accepted implementation task back to normal development | Coordinator | `agent-system/workflows/task-lifecycle.md` |
| TR09 | Change task state for later, dismissed, done, or deduplication | Quality Curator | `agent-system/roles/quality-curator.md`; `testing/workflow.md` |
| TR10 | Add regression coverage for a confirmed bug | Quality Curator | `agent-system/workflows/learning-loop.md`; `testing/workflow.md` |
| TR11 | Record regression root cause, detection, tier, status, and date | Quality Curator | `testing/regressions.md`; `agent-system/roles/quality-curator.md` |
| TR12 | Update the system map only for canonical architecture or contract changes | Quality Curator | `testing/system-map.md`; `agent-system/roles/quality-curator.md` |
| TR13 | Never write secrets or persist unverified memory claims | Tester and Quality Curator | `agent-system/roles/tester.md`; `agent-system/workflows/learning-loop.md` |
| TR14 | Never edit product code while testing | Tester | Read-only Codex and Claude wrappers; `tests/agent-system.test.js` |
| TR15 | Former limited writes to `testing/` and regression tests | Quality Curator only | `agent-system/roles/quality-curator.md`; platform Quality Curator wrappers |
| TR16 | Rerun independently after implementation before marking fixed | Tester, then Quality Curator | `agent-system/workflows/task-lifecycle.md`; `agent-system/workflows/learning-loop.md` |

There are no unmapped former Tester requirements.
