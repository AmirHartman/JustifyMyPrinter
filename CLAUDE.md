# CLAUDE.md

Repository guidance for Claude Code. Follow `AGENTS.md` for operating rules and
`docs/PRODUCT_SPEC.md` for product requirements.

## Product

JustifyMyPrinter (מדפסת חברים) manages a small 3D-printing service: public
catalog browsing, friend registration and approval, ordering, manual payment
tracking, and admin management. The product UI is Hebrew, right-to-left, and
mobile-friendly.

## Architecture

```text
Browser pages (*.html, styles.css)
        |
Frontend ES modules (js/)
        |
Express routes (server.js -> api/)
        |
Neon PostgreSQL
```

- The frontend is plain HTML and JavaScript with no bundler or framework.
- `js/state.js` owns shared client state; `js/render.js` renders from it;
  `js/app.js` boots the current page; `js/api.js` wraps HTTP requests.
- `server.js` mounts resource handlers from `api/` and serves approved static
  files.
- `api/_middleware.js` contains session and authorization helpers;
  `api/_db.js` connects to Neon; `api/init.js` defines and migrates the schema.
- Sessions use an HttpOnly cookie. Authorization must be enforced server-side.
- Render runs `npm start`.

## Core invariants

- Active catalog data is publicly browsable; ordering requires an eligible
  authenticated account.
- Friends may access only their own orders; administrative data and mutations
  require admin authorization.
- Payment is an independently tracked manual paid/unpaid state.
- Special orders require pricing and customer approval before printing.
- User and order states must use the canonical values in
  `docs/PRODUCT_SPEC.md`; preserve compatibility normalization where present.
- Internal messaging is disabled. Communication uses manually opened WhatsApp
  links with Hebrew templates.
- Database evolution is additive and idempotent.

## Development

```bash
npm install
cp env.local.example .env.local  # configure DATABASE_URL locally
npm run dev                       # http://localhost:3000
npm run build                     # optional static-export check
```

Initialize a fresh database with `POST /api/init`. Production initialization is
protected by `INIT_SECRET`. Never print or commit credentials.

There is no automated test suite. Inspect affected paths and run targeted
syntax, endpoint, build, and browser checks.

When the owner says "model" or "מודל", they mean the active conversational
model, whether Claude or Codex. Any persistent change to agent behavior,
conversation conventions, or project memory must be implemented for both
surfaces and use a shared repository source of truth wherever possible.

## Updating this guidance

If this file or another AI-guidance file becomes inaccurate, explain the needed
change and ask the owner for explicit approval before editing it. Never fold an
AI-guidance edit into an otherwise approved task without separate confirmation.
