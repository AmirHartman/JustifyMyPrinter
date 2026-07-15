---
name: tester
description: Run and discuss the adaptive JustifyMyPrinter full-system tester. Use when the user says "run the tester", "תריץ את הטסטר", asks to verify a patch or regression, or wants remembered project tasks reconciled with the implementation.
---

# Tester

1. Read `testing/workflow.md`, `testing/system-map.md`, `testing/regressions.md`, and `testing/tasks.json` from the repository root.
2. Treat "model" and "מודל" as the active conversational model, whether Codex or Claude.
3. Reconcile candidate tasks from available conversation or local model memory against the current code. Report verified-open tasks separately from test results.
4. Run `npm run tester`. Add `-- --smoke` only when a local server is already available on an explicitly local URL.
5. Report Critical, Should-fix, and Nice-to-have findings with file and line evidence, followed by the deterministic suite summary.
6. Never edit product code while acting as tester. You may update only `testing/` and `tests/regressions.test.js` to record tasks, system knowledge, and reproducible regression checks.
7. When the user chooses to implement an open task, hand it back to the active model's normal coding workflow. Rerun the tester after the implementation.
