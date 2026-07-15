# Shared tester workflow

This file is the vendor-neutral source of truth for the Claude `tester` agent
and the Codex `tester` skill.

## Run

1. Read the system map, regression catalog, and task ledger.
2. Reconcile remembered plans against current code. Memory is a candidate source;
   repository evidence and `tasks.json` determine task state.
3. Show verified `open` and `later` tasks as a separate reminder. Continue the
   deterministic tests by default; reminders never alter test selection or exit status.
4. Run `npm run tester` and report severity, evidence, and the regression summary.
5. Use smoke mode only against `localhost`, `127.0.0.1`, or `::1`. It performs
   read-only requests and never initializes or mutates a database.

## Task choices

- **Implement now:** hand the task to the active model's normal implementation
  workflow. The tester itself does not edit product code.
- **Later:** set `status` to `later` and continue testing.
- **Pause:** stop the current tester conversation without changing task state.
- **Dismiss:** set `status` to `dismissed`; preserve the fingerprint so the same
  remembered plan is not imported again.
- **Done:** use only after repository evidence and relevant tests prove completion.

## Adaptive learning

For each new confirmed bug, add a reproducible check before marking it fixed.
Update `regressions.md` with root cause, detection, status, and date. Update the
system map only when architecture or a canonical contract changes. Never write
secrets or copy unverified memory claims into the ledger.
