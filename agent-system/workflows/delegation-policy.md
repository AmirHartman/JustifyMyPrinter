# Delegation Policy

## Do not delegate

Work directly when the task is trivial, one coherent behavior in one file, one
short command, a mechanical follow-up, centered on one unresolved decision or
central file, or when briefing costs more than execution.

## Delegate sequentially

Use sequential roles when architecture or contracts precede implementation, a
failure must be reproduced before a regression is authored, frontend depends on
an unresolved backend interface, integration depends on worker output, or scopes
touch the same high-risk file.

## Delegate in parallel

Parallelize only independent exploration, non-overlapping frontend/backend work
with an agreed contract, independent risk reviews, or isolated tests/docs that
do not guess an unresolved interface. Exclusive worktrees and file ownership
must prevent collisions.

## Limits and spawn gate

- Normally zero to two workers; exceptional maximum three.
- `[agents] max_threads = 4` is infrastructure capacity, not a target.
- Maximum depth is one; workers never spawn children.

Before spawning, the Coordinator must state why delegation is better, why scope
is independent, who owns writes, what concise output is expected, what context
can be omitted, and how the result will be independently checked.

## Announce delegation and agent changes

The Coordinator must tell the owner, in the conversation, every time it:

- Delegates to an existing role or project agent (name which one and why).
- Defines a new agent or role that did not exist before.
- Changes an existing agent or role — its prompt, scope, tools, or wrapper.

This announcement is required regardless of risk tier or delegation size; it is
a communication rule, not a risk gate. It applies on both platforms per
`AGENTS.md` and `CLAUDE.md`.
