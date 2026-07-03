# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) and other coding
agents when working with this repository.

> **Full project context:** see `docs/PROJECT_CONTEXT.md` and `docs/PRODUCT_SPEC.md`.
> **Builder sequence and file ownership:** see `docs/BUILDER_PLAN.md`.
> **Deployment notes:** see `docs/RENDER_DEPLOYMENT_NOTES.md`.

---

## Project overview

JustifyMyPrinter (Hebrew: מדפסת חברים) is a Hebrew-language web app for
managing 3D-printed product orders between an admin (the printer owner, Amir)
and "friends" (customers). The UI is entirely in Hebrew (RTL).

This is not a landing page and not a generic shop. It manages catalog, orders,
friends, admin dashboard, costs, revenue, expenses, and eventually filament
inventory.

---

## Running locally

```bash
npm install
cp env.local.example .env.local   # then edit and set DATABASE_URL
npm run dev                        # node --watch --env-file=.env.local server.js
```

App runs at `http://localhost:3000`.

No Vercel CLI needed. No build step for the frontend.

---

## Database setup

On a fresh Neon database, seed tables and initial data:

```bash
curl -X POST http://localhost:3000/api/init   # local
# Production requires INIT_SECRET:
curl -X POST -H "Authorization: Bearer $INIT_SECRET" \
  https://<your-render-url>/api/init
```

This is idempotent — safe to re-run.

---

## Deployment

**Current target: Render (Express server)**

The app runs as `node server.js` (an Express app), not as Vercel serverless
functions. `server.js` routes all `/api/*` calls to the handlers in `api/` and
serves static files (HTML, CSS, JS modules) from the repo root.

Render setup: see `docs/RENDER_DEPLOYMENT_NOTES.md`.

| Script        | Command                                              |
|---------------|------------------------------------------------------|
| `npm start`   | `node server.js` — used by Render in production      |
| `npm run dev` | `node --watch --env-file=.env.local server.js` — local |
| `npm run build` | `node scripts/build.js` — static export (optional) |

**Legacy:** `.vercel/`, `vercel.json`, and `.github/workflows/deploy-pages.yml`
are historical artifacts. Do not add new Vercel serverless functions.

---

## Architecture

### Frontend (no framework, no build)

Plain HTML + vanilla JS ES modules. No bundler, no transpiler.

- `js/state.js` — single shared mutable `store` object; all modules import and
  mutate it by property (never replace the object). `loadData()` fetches all
  API endpoints in parallel and populates the store.
- `js/render.js` — one `render()` function that re-renders every section of
  the UI from `store`. Called after any state mutation.
- `js/app.js` — event wiring and boot. On load: checks session, routes between
  pages, calls `loadData()`, then `render()`.
- `js/api.js` — thin `fetch` wrapper; throws `Error` with the server's `error`
  field on non-OK responses.
- `js/utils.js` — `formatCurrency` (ILS locale), `estimatePlaCost` (₪60/kg PLA),
  `createAiProductDraft`.
- `js/orders.js` — order dialog logic.
- `js/auth.js` — DOM helpers for auth panel, mode toggles.

Pages: `index.html` (landing + login), `welcome.html` (friend home),
`catalog.html` (product catalog), `dashboard.html` (shared dashboard).

Each page has `data-page="<name>"` on `<body>`. `pageName` in `state.js` reads
this to know which page is loaded.

### Backend (Express handlers in `api/`)

The files under `api/` were originally Vercel serverless functions. They now
run via `server.js` which mounts them with `app.all('/api/<name>', require('./api/<name>'))`.
The function signature is identical — each file exports a single `(req, res)` function.

- `api/_db.js` — lazy Neon connection via `DB_JMP_DATABASE_URL` or `DATABASE_URL`.
- `api/_middleware.js` — `parseBody`, `parseCookies`, `getSession`, `requireAuth`, `requireAdmin`.
- `api/_seed.js` — static catalog data and demo users/orders; imported by `api/init.js`.
- `api/auth.js` — `GET` (session check), `POST` with `action: login|register|logout`.
- `api/init.js` — `POST` creates all tables and upserts seed data (idempotent).
- `api/orders.js` — order CRUD. `?id=:id` for single-order ops; `?mine=true` for friend's own.
- `api/products.js` — product CRUD (admin only for write). `?id=:id` for single-product ops.
- `api/users.js` — user management (admin only). `?id=:id` for single-user ops.
- `api/filaments.js` — filament management. `?id=:id` for single-filament ops.
- `api/messages.js` — authenticated compatibility stub returning `410 Gone`.
- `api/notifications.js` — authenticated compatibility stub returning `410 Gone`.
- `api/settings.js` — key/value settings store (admin only). `?key=pricing`.

### Auth & roles

Sessions are cookie-based (`session` cookie, HttpOnly). The `sessions` table
stores `token → user_id, user_name, user_role, expires_at`. Passwords are stored
as scrypt hashes; legacy plaintext values are upgraded after successful login.

Two roles:
- `admin` — sees all orders, manages products/users, reads all data.
- `friend` — sees catalog, places orders, sees own orders.

User statuses: `pending` (awaiting approval), `active` (can order),
`inactive` (deactivated), `rejected` (with reason).

New registrations start as `status: 'pending'` and must be approved by admin.
Pending users can view the catalog but cannot order.

### Database schema (Neon PostgreSQL)

Tables: `users`, `products`, `orders`, `sessions`, `filaments`, `settings`,
`messages` (deprecated), `notifications` (deprecated).

See `api/init.js` for full column definitions. All schema changes use
`ADD COLUMN IF NOT EXISTS` to be safe to re-run.

---

## Implementation status

Builders 2–8 completed the runtime, schema, auth, orders, WhatsApp, categories,
catalog, and UI passes. `docs/BUILDER_PLAN.md` and the gap notes in the original
project-context documents are historical builder instructions; verify current
behavior in code and the Builder 9 QA handoff before release.

---

## General rules for all builders

- Write builder plans, analyses, progress updates, summaries, test results, and
  final handoffs in English unless the user explicitly requests another language.
- No new Vercel serverless functions. The deployment target is Render/Express.
- No paid services or paid add-ons without explicit approval from the owner.
- No architecture replacement without approval.
- Preserve Hebrew RTL UI and mobile usability.
- Store secrets only in env variables. Never expose them.
- Only admin can see admin data. Users see only their own data.
- Prefer extending existing endpoints over creating new API files.
- Keep changes small and focused per builder pass.
- Use `ADD COLUMN IF NOT EXISTS` for all schema changes.
- Do not delete `messages`/`notifications` DB tables yet — just stop using them.
