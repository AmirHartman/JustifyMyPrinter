# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

JustifyMyPrinter is a Hebrew-language web app for managing 3D-printed product orders between an admin (the printer owner, Amir) and "friends" (customers). The UI is entirely in Hebrew (RTL).

## Running locally

No build step. Open `index.html` in a browser, or serve statically:

```bash
npx serve .
```

The API routes (`/api/*`) require Vercel's dev server to work locally:

```bash
npm install -g vercel
vercel dev
```

Set `DATABASE_URL` in `.env.local` (see `env.local.example`) before running `vercel dev`.

## Database setup

On a fresh Neon database, seed tables and initial data with:

```bash
curl -X POST https://<your-domain>/api/init
```

This is idempotent — safe to re-run to reset seed data.

## Deployment

- **Vercel** — full app including `/api/*` serverless functions. Push to main or deploy via Vercel CLI.
- **GitHub Pages** — static pages only (no API). Triggered by push to `main` via `.github/workflows/deploy-pages.yml`. The workflow copies `index.html`, `landing.html`, `welcome.html`, `catalog.html`, `styles.css`, `app.js` into `public/`.

## Architecture

### Frontend (no framework, no build)

Plain HTML + vanilla JS ES modules. There is no bundler or transpiler.

- `js/state.js` — single shared mutable `store` object; all modules import and mutate it by property (never replace the object). `loadData()` fetches all API endpoints in parallel and populates the store.
- `js/render.js` — one `render()` function that re-renders every section of the UI from `store`. Called after any state mutation.
- `js/app.js` — event wiring and boot. On load: checks session, routes between pages, calls `loadData()`, then `render()`.
- `js/api.js` — thin `fetch` wrapper; throws `Error` with the server's `error` field on non-OK responses.
- `js/utils.js` — `formatCurrency` (ILS locale), `estimatePlaCost` (₪60/kg PLA), `createAiProductDraft`.
- `js/orders.js` — order dialog logic.
- `js/auth.js` — DOM helpers for auth panel, mode toggles.

Pages: `index.html` (landing + login), `welcome.html` (friend home), `catalog.html` (product catalog), `dashboard.html` (shared dashboard).

Each page has `data-page="<name>"` on `<body>`. `pageName` in `state.js` reads this to know which page is loaded.

### Backend (Vercel serverless functions)

All files under `api/` are Vercel serverless functions (Node.js, CommonJS).

- `api/_db.js` — lazy Neon connection via `DB_JMP_DATABASE_URL` or `DATABASE_URL`.
- `api/_middleware.js` — `parseBody`, `parseCookies`, `getSession`, `requireAuth`, `requireAdmin`.
- `api/_seed.js` — static catalog data and demo users/orders; imported by `api/init.js`.
- `api/auth.js` — `GET` (session check), `POST` with `action: login|register|logout`.
- `api/init.js` — `POST` creates all tables and upserts seed data.
- `api/orders.js`, `api/orders/[id].js` — order CRUD.
- `api/products.js`, `api/products/[id].js` — product CRUD (admin only for write).
- `api/users.js`, `api/users/[id].js` — user management (admin only).
- `api/my-orders.js` — friend's own orders.
- `api/messages.js` — friend↔admin chat thread (scoped to user).
- `api/notifications.js` — per-user inbox notifications.

### Auth & roles

Sessions are cookie-based (`session` cookie, HttpOnly). The `sessions` table stores `token → user_id, user_name, user_role, expires_at`. Passwords are stored in plaintext.

Two roles:
- `admin` — sees all orders, manages products/users, reads all chat threads.
- `friend` — sees catalog, places orders, chats with admin, sees own orders.

New registrations start as `status: 'pending'` (role `friend`) and must be approved by admin.

### Database schema (Neon PostgreSQL)

Tables: `users`, `products`, `orders`, `sessions`, `messages`, `notifications`. See `api/init.js` for full column definitions.

### Product pricing

`cost` = estimated filament cost in ILS. PLA filament rate is ₪60/kg (`PLA_COST_PER_KG` in `utils.js`). Product IDs are derived from the Thingiverse thing number (`prod-<thingId>`). Product images are proxied via `images.weserv.nl` to bypass Thingiverse CDN CORS restrictions.
