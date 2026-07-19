# Task Lifecycle

1. Ground the request in current code, relevant product specification, Git
   state, and owner constraints.
2. Classify risk and affected domains; resolve product or interface decisions
   before writing.
3. Before the first tracked-file edit, create or enter a dedicated
   `agent/<task-id>-<slug>` branch and worktree for the task. This applies to the
   active model and every writing worker; a read-only task is exempt.
4. Decide whether delegation provides specialization, coverage, or elapsed-time
   value. If not, work directly.
5. For each delegated unit, create a task contract with exclusive write scope
   and a focused context pack.
6. Implement in dependency order. Workers stop on contract violations or scope
   expansion and return concise handoffs.
7. Integrate through Git Steward and inspect every diff. When the owner says
   branch work is finished, use the branch-closing publish flow in
   `git-integration.md` without asking again for each included boundary.
8. Run an independent Tester pass using the verification matrix.
9. If a durable regression, task, decision, or lesson exists, route it to
   Quality Curator after evidence is available.
10. Report exact outcomes, skipped checks, risks, local and remote Git state, and
   the next action requiring owner authority.

For a confirmed bug, use: Tester reproduces → Quality Curator adds coverage →
specialist fixes → independent Tester reruns → Quality Curator finalizes durable
status.
