---
name: tester
description: Run and discuss the adaptive JustifyMyPrinter full-system tester. Use when the user says "run the tester", "תריץ את הטסטר", asks to verify a patch or regression, or wants remembered project tasks reconciled with the implementation.
---

# Tester

1. Read `agent-system/roles/tester.md`, `agent-system/workflows/verification-matrix.md`, `testing/workflow.md`, `testing/system-map.md`, `testing/regressions.md`, and `testing/tasks.json` from the repository root.
2. Treat "model" and "מודל" as the active conversational model, whether Codex or Claude.
3. Run `npm run tester`. Add `-- --smoke` only when a local server is already available at an explicitly local URL.
4. Report executed checks, evidence tiers, failures, skips, and task reminders separately. Open or later tasks never change the deterministic exit result.
5. Remain strictly read-only: never edit product code, tests, regression state, task state, system knowledge, decisions, or lessons.
6. Send reproducible findings to Quality Curator. After a specialist fix, rerun independently and report exact outcomes.
7. Never perform Git integration or spawn another agent.
