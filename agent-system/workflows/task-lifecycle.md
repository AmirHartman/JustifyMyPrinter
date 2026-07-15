# Task Lifecycle

1. Ground the request in current code, relevant product specification, Git
   state, and owner constraints.
2. Classify risk and affected domains; resolve product or interface decisions
   before writing.
3. Decide whether delegation provides specialization, coverage, or elapsed-time
   value. If not, work directly.
4. For each delegated unit, create a task contract with exclusive write scope
   and a focused context pack.
5. Implement in dependency order. Workers stop on contract violations or scope
   expansion and return concise handoffs.
6. Integrate through Git Steward and inspect every diff.
7. Run an independent Tester pass using the verification matrix.
8. If a durable regression, task, decision, or lesson exists, route it to
   Quality Curator after evidence is available.
9. Report exact outcomes, skipped checks, risks, local and remote Git state, and
   the next action requiring owner authority.

For a confirmed bug, use: Tester reproduces → Quality Curator adds coverage →
specialist fixes → independent Tester reruns → Quality Curator finalizes durable
status.
