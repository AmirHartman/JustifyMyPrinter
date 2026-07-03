# AGENTS.md — מדפסת חברים / JustifyMyPrinter

This file provides the builder sequence and ground rules for AI coding agents
working on this repository. It is the short companion to `docs/BUILDER_PLAN.md`,
which has the full task breakdown.

## Start here (every builder)

1. Read `docs/PROJECT_CONTEXT.md` — what this app is and current state.
2. Read `docs/PRODUCT_SPEC.md` — what it must do.
3. Read `docs/BUILDER_PLAN.md` — who owns what; do not edit files owned by
   another builder without coordination.
4. Read `CLAUDE.md` — architecture, local dev, deployment, known gaps.
5. Read `docs/RENDER_DEPLOYMENT_NOTES.md` — Render setup and free-tier rules.

## Builder sequence

| # | Name | Tool | Role |
|---|------|------|------|
| 0 | Documentation Bootstrapper | Claude Code | Docs only ✅ done |
| 1 | Repo Audit / Coordinator | Claude Code | Read-only audit |
| 2 | Render Runtime / Backend | Codex | `server.js`, `package.json` |
| 3 | DB / API / Schema | Codex | `api/init.js`, `api/_db.js`, `api/settings.js` |
| 4 | Auth / Users / Permissions | Claude Code | `api/auth.js`, `api/users.js`, `api/_middleware.js` |
| 5 | Orders / Pricing / Payments | Claude Code | `api/orders.js` |
| 6 | Remove Messages / Add WhatsApp | Codex | `api/messages.js`, `api/notifications.js`, `js/whatsapp.js` |
| 7 | Products / Categories / Catalog | Claude Code | `api/products.js`, `catalog.html` |
| 8 | UI / RTL / Mobile / Dashboard | Claude Code | HTML pages, `styles.css`, `js/render.js`, `js/app.js` |
| 9 | QA / Regression / Release | Codex | Read-only QA |

## Hard constraints (non-negotiable)

- **Database:** Neon PostgreSQL. Do not replace.
- **Deployment:** Render with `npm start` (`node server.js`). No new Vercel functions.
- **No paid services** without owner (Amir) approval.
- **Secrets:** never commit `DATABASE_URL`, API keys, or env values.
- **RTL/Hebrew:** preserve Hebrew UI on all changes.
- **Public catalog:** active products must be visible without login.
- **Pending users:** can view catalog but cannot order.
- **Internal messages:** deprecated — do not expand. Replace with WhatsApp links.
- **No online payment** in MVP — manual paid/unpaid only.
- **Schema changes:** use `ADD COLUMN IF NOT EXISTS`. No destructive migrations.

## Key known gaps (summary)

Full details in `CLAUDE.md` §Known code gaps.

- Order statuses in code don't match the spec → Builder 5.
- User status 'approved' should be 'active' → Builder 4.
- Public catalog requires auth → Builder 7.
- Pending users could order (not blocked in API) → Builders 4/5.
- Internal messaging still live → Builder 6.
- Missing registration fields (phone, etc.) → Builder 4.
- No mark-multiple-orders-paid endpoint → Builder 5.
- No price approval flow → Builder 5.
- No cancellation reason field → Builders 3/5.
- Categories are a text field, not dynamic → Builders 3/7.
- Passwords in plaintext → post-MVP.
