# Evidence-Based Learning Loop

1. Tester records verification in a read-only handoff.
2. Quality Curator decides whether a durable regression, task, decision, or
   lesson is justified.
3. Add durable knowledge only from repository evidence, a reproduced failure,
   or a confirmed integration outcome.
4. Convert confirmed bugs into regression coverage when practical and retain
   useful static checks with honest tier labels.
5. Store stable architectural decisions in `knowledge/decisions.md`; store
   scoped reusable findings in `knowledge/lessons.md`; keep temporary details in
   task handoffs.
6. Periodically consolidate duplicates and obsolete guidance into one canonical
   source, without loosening safety rules.

Do not persist secrets, raw logs, full conversations, speculative memory,
fabricated metrics, or one-off incidents as broad rules. Repository evidence
overrides memory. Preserve dismissed task fingerprints and prevent duplicate
tasks. Future AI-guidance edits always require explicit owner approval.
