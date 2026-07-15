# AGENTS.md — JustifyMyPrinter

Operating rules for AI coding agents. Product requirements live in
`docs/PRODUCT_SPEC.md`; the current implementation is authoritative for behavior.

## Purpose

JustifyMyPrinter (מדפסת חברים) is a Hebrew, RTL application for running a small
3D-printing service for friends. It combines a public catalog, friend
registration and ordering, order and payment tracking, and admin operations.

## System map

- `server.js` — Express entry point, API routing, health check, and static files.
- `api/` — Express-compatible handlers, authorization, Neon access, and schema
  initialization.
- `js/` — browser ES modules for API access, shared state, UI rendering, auth,
  orders, and WhatsApp actions.
- `*.html`, `styles.css` — Hebrew RTL pages and shared responsive styling.
- `docs/PRODUCT_SPEC.md` — intended product behavior.
- `api/init.js` — canonical database schema and additive migrations.

The production stack is Node.js/Express, plain HTML and JavaScript, Neon
PostgreSQL, and Render. Legacy deployment files are not part of the runtime.

## Working method

1. Read the relevant code before proposing or making changes.
2. Check `docs/PRODUCT_SPEC.md` for product intent; call out conflicts between
   the specification and implementation instead of silently choosing one.
3. Keep changes focused and preserve unrelated work.
4. Reuse existing patterns and endpoints before adding abstractions or files.
5. Validate in proportion to risk. There is no automated test suite, so use
   targeted syntax, API, build, and browser checks.
6. Report the outcome, files changed, checks run, and any remaining risk.

Communicate in English unless the user requests another language. Keep product
copy in Hebrew unless explicitly asked to change it.

When the owner says "model" or "מודל", they mean the active conversational
model, whether Claude or Codex. Any persistent change to agent behavior,
conversation conventions, or project memory must be implemented for both
surfaces and use a shared repository source of truth wherever possible.

## Production constraints

- Do not replace Express, Neon, the vanilla frontend, or Render without owner
  approval.
- Do not introduce paid services or new deployment platforms without approval.
- Never expose or commit secrets or environment values.
- Enforce permissions in the API. Admin data is admin-only; friend data is
  owner-scoped.
- Preserve Hebrew RTL behavior, accessibility, and mobile usability.
- Keep schema changes additive and idempotent; avoid destructive migrations.
- Keep payment tracking manual; do not add online payment processing implicitly.
- Keep communication WhatsApp-based. Legacy message/notification endpoints stay
  disabled and their database tables stay intact unless explicitly requested.
- Treat public catalog visibility and account-status ordering restrictions as
  security/product invariants.

## AI guidance governance

These files govern AI behavior: `AGENTS.md`, `CLAUDE.md`, and
`docs/AI_WORKFLOW_RULES.md` (plus its root pointer). Agents may recommend updates
when repository changes make the guidance inaccurate, but must obtain explicit
owner approval before every edit to any of these files. Approval for ordinary
code or documentation changes does not include approval to edit AI guidance.

## Commands

```bash
npm install
cp env.local.example .env.local
npm run dev
curl -X POST http://localhost:3000/api/init
npm run build
```

Production starts with `npm start`; health is `GET /healthz`.
