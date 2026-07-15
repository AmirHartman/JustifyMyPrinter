# Tester Operations

The canonical role boundary is `agent-system/roles/tester.md`; evidence tiers
are defined in `agent-system/workflows/verification-matrix.md`. This file keeps
the repository-specific commands and quality handoff visible to both platforms.

## Run

1. Read `testing/system-map.md`, `testing/regressions.md`,
   `testing/test-manifest.json`, and `testing/tasks.json`.
2. Run `npm run tester`. Use `npm run --silent tester -- --json` for bounded
   structured output.
3. Add `--smoke` only for an isolated server on literal `127.0.0.1` or `::1`.
   Smoke uses credential-free, timeout-bounded, redirect-free GET requests and
   performs no initialization or database mutation.
4. Report executed checks and their tiers, exact failures, visible skips, proof
   limits, and `open`/`later` task reminders separately.

Only an executed check failure changes exit status. Task reminders and skipped
T3-T5 checks never do.

## Read-only Tester boundary

Tester never edits product code, tests, this directory, task or regression
state, system knowledge, decisions, or lessons. It may propose a reproducible
finding with evidence in its handoff.

Quality Curator alone may:

- add or change tests and regression definitions;
- change `testing/tasks.json` state or dismissed fingerprints;
- update `testing/regressions.md` or `testing/system-map.md`;
- persist evidence-backed decisions or lessons.

The enforced finding lifecycle is: Tester finding → Quality Curator regression
→ specialist fix → independent Tester rerun → Quality Curator durable-status
update. Coordinator routes implementation and resolves task choices.
