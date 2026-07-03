# AGENTS.md — מדפסת חברים / JustifyMyPrinter

Current operating guidance for AI coding agents. Read `docs/PRODUCT_SPEC.md` for
requirements and `CLAUDE.md` for architecture and commands.
`docs/BUILDER_PLAN.md` is an archived implementation plan, not active ownership.

## Current stack

- Plain HTML and vanilla JavaScript ES modules.
- Express (`server.js`) with handlers in `api/`.
- Neon PostgreSQL.
- Render deployment through `npm start`.
- Hebrew, right-to-left product UI.

## Before changing code

1. Inspect the relevant implementation; code is authoritative for current behavior.
2. Check intended behavior in `docs/PRODUCT_SPEC.md`.
3. Treat builder-number references and migration notes as history.
4. Preserve unrelated user changes.

Agent communication should be in English unless the user requests another
language. Product copy remains Hebrew unless explicitly changed.

## Implemented behavior to preserve

- Active products and categories are publicly browsable.
- Registration creates a `pending` friend. Only `active` friends and admins can
  order; `inactive` and `rejected` users cannot.
- User states: `pending`, `active`, `inactive`, `rejected`.
- Order states: `new`, `waiting_approval`, `waiting_print`, `printing`,
  `ready_delivery`, `completed`, `cancelled`. Legacy values are normalized.
- External/custom orders support admin pricing and friend price approval.
- Pre-print cancellation requires a reason.
- Admin can mark one or multiple orders paid.
- Categories are dynamic, admin-managed, and products support multiple categories.
- Internal messages/notifications are disabled (`410 Gone`); WhatsApp links and
  Hebrew templates are used instead. Legacy DB tables remain.
- Passwords use scrypt hashes; legacy plaintext is upgraded after successful login.
- Demo data and production admin bootstrap are opt-in through environment variables.

## Hard constraints

- Do not replace Neon, Express, or the vanilla frontend without approval.
- Do not add Vercel functions; Vercel files are legacy artifacts.
- No paid services without owner approval.
- Never expose or commit secrets or environment values.
- Preserve Hebrew RTL and mobile usability.
- Enforce authorization in APIs, not only in UI.
- Keep admin data admin-only and friend order data owner-scoped.
- No online payment processing in MVP; use manual paid/unpaid state.
- Prefer existing endpoints and small changes.
- Keep schema changes additive and idempotent; avoid destructive migrations.
- Do not drop legacy `messages` or `notifications` tables without an explicit request.

## Commands

```bash
npm install
cp env.local.example .env.local
npm run dev
curl -X POST http://localhost:3000/api/init
```

Production uses `npm start`; health is `GET /healthz`; optional static export is
`npm run build`. There is currently no automated test script, so use targeted
syntax, API, and browser checks.
