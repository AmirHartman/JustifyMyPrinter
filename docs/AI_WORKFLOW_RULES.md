# AI Workflow Rules

Shared workflow for AI agents working on JustifyMyPrinter. `AGENTS.md` is the
primary operating guide; `docs/PRODUCT_SPEC.md` defines product intent.

## Before work

- Inspect the relevant implementation and nearby conventions.
- Read only the product-spec sections needed for the task.
- Identify authorization, data-ownership, RTL/mobile, schema, and deployment
  implications.
- Treat builder plans, migration narratives, and legacy deployment files as
  historical context, not current instructions.

## During work

- Prefer the smallest coherent change that solves the request.
- Preserve unrelated user changes and established interfaces.
- Enforce trust boundaries in backend handlers, not only in the UI.
- Keep secrets in environment variables and out of logs, code, and responses.
- Use additive, repeatable database migrations.
- Keep technical communication concise; keep product copy Hebrew and RTL.
- Ask before changing architecture, deployment, paid-service usage, destructive
  data behavior, or requirements outside the requested scope.

## Verification and handoff

Choose checks based on the change: syntax checks, focused endpoint requests,
`npm run build`, and browser validation. Verify both allowed and forbidden paths
when permissions change. Report:

1. what changed;
2. which files changed;
3. which checks ran and their results;
4. unresolved risks or assumptions.

## Maintaining AI guidance

Agents should notice when repository evolution makes AI guidance incomplete,
duplicated, or incorrect. They may propose a precise correction, but must ask
the owner and receive explicit approval before each edit to `AGENTS.md`,
`CLAUDE.md`, this file, or the root `AI_WORKFLOW_RULES.md` pointer. Approval for
another task never implies approval to update these files.
