# מדפסת חברים — Project Context

> **Canonical location.** This file in `docs/` is the authoritative version.
> The root-level `PROJECT_CONTEXT.md` is a legacy copy and may be outdated.

## Project names

- Hebrew name: **מדפסת חברים**
- Repo/app name: **JustifyMyPrinter**

## What the app is

"מדפסת חברים" is a real web app for managing 3D-printing requests for friends.
It is not a landing page and not a generic shop.
It is a small operating system around the owner's 3D printer: catalog, orders,
friends, admin dashboard, costs, income/expenses, and eventually filament inventory.

## Main vision

The app helps the admin:
- manage print orders and requests;
- track order status and payments;
- manage products and categories;
- track income, expenses, and profit;
- show transparent support/reinvestment to friends;
- learn whether this can become a public paid business in the future.

## Business model

**Transparent base cost + optional extra support.**

Friends see the base cost and understand that extra support is reinvested into
the project: new filament colors, printer parts, paid models, maintenance,
accessories, and future improvements.

## Users

### Public visitor
Can see the landing/explanation page and public catalog. Cannot order.

### Pending user
Registered but not approved. Can log in and view catalog. Cannot order.

### Active friend
Can log in, view catalog, order, see personal area, order history, statuses,
payments, approve special-order prices, cancel orders before printing, and
contact the admin via WhatsApp.

### Inactive/rejected user
Cannot order.

### Admin
Single admin: the owner (Amir). Can manage users, products, orders, categories,
costs, income, expenses, and WhatsApp communication. Admin can also use the site
as a normal user named Amir and place personal orders so personal prints are
counted in material usage.

## Current project state (updated 2026-07-04)

The codebase already includes:
- **Neon** PostgreSQL database connection (`api/_db.js`);
- registration/login (`api/auth.js`);
- admin user;
- catalog/products (`api/products.js`);
- orders (`api/orders.js`);
- user personal area;
- admin dashboard;
- product management;
- filaments table (`api/filaments.js`);
- settings/pricing config (`api/settings.js`);
- **Express server** (`server.js`) — the app runs as `node server.js`, not as Vercel functions;
- **Render** is the current deployment target (see `docs/RENDER_DEPLOYMENT_NOTES.md`);
- disabled compatibility endpoints for legacy messages and notifications;
- WhatsApp links and Hebrew templates;
- canonical user/order statuses with legacy-value normalization;
- public active catalog/category browsing and active-user order enforcement;
- complete registration metadata and the admin approval flow;
- external/custom price approval and required cancellation reasons;
- single- and multi-order paid actions;
- dynamic, admin-managed, multi-category products;
- scrypt password hashes with upgrade-on-login for legacy plaintext values.

## WhatsApp replaces internal messages

Internal site messaging and automated notifications are **cancelled for MVP**, not just postponed.

The app uses WhatsApp as the main communication channel:
- WhatsApp buttons on friend profiles;
- WhatsApp buttons near orders;
- prefilled message templates (Hebrew) for status updates, price approval,
  delivery coordination, and payment summaries;
- **no WhatsApp API in MVP** — only manual sending through wa.me / WhatsApp Web.

Internal messaging UI/data flows are disabled and replaced with WhatsApp
links/templates. Compatibility endpoints return `410 Gone`; legacy database
tables remain for safe migration.

## Language and UX

- Hebrew-only UI for MVP.
- RTL layout.
- Technical strings, URLs, file names, and identifiers may remain LTR.
- Tone: friendly, personal, a bit funny, professional, clean, transparent,
  community-like, colorful, and fun.
- Mobile-friendly design is required.

## Printer context

When the user says "my printer": **Bambu Lab P2S Combo with AMS 2 Pro**.

## AI prompt preference

When generating prompts for Claude Code, Codex, or other coding/build agents:
- write prompts in English;
- write agent plans, analyses, progress updates, summaries, test results, and
  final handoffs in English unless the user explicitly requests another language;
- keep them token-efficient;
- include only relevant context;
- preserve Hebrew RTL, Neon, Render free-tier constraints, and no paid services
  without approval.
