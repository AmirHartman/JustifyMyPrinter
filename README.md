# JustifyMyPrinter — מדפסת חברים

A Hebrew-language web app for managing 3D-printing orders for friends.
Not a landing page; not a generic shop — a small operating system around a
Bambu Lab printer: catalog, orders, friends, admin dashboard, costs, and filament.

> **Full context:** `docs/PROJECT_CONTEXT.md` | **Product spec:** `docs/PRODUCT_SPEC.md`
> **Deployment:** `docs/RENDER_DEPLOYMENT_NOTES.md` | **Builder plan:** `docs/BUILDER_PLAN.md`

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | Plain HTML + vanilla JS ES modules (no framework, no bundler) |
| Backend | Node.js + Express (`server.js`) |
| Database | Neon PostgreSQL (serverless) |
| Deployment | Render (free/Starter tier) |

---

## Local development

```bash
cd JustifyMyPrinter
npm install
cp env.local.example .env.local   # set DATABASE_URL to your Neon connection string
npm run dev                        # http://localhost:3000
```

On a fresh database, seed tables once:

```bash
curl -X POST http://localhost:3000/api/init
```

---

## Deployment (Render)

The app runs as `npm start` → `node server.js`. Point Render at this repo with:

- **Build command:** `npm install`
- **Start command:** `npm start`

Set `DATABASE_URL` (or `DB_JMP_DATABASE_URL`) in the Render environment.
See `docs/RENDER_DEPLOYMENT_NOTES.md` for full setup.

---

## Project structure

```
api/           — Express-compatible API handlers (Neon, auth, orders, products…)
js/            — Frontend ES modules (state, render, app, api, utils…)
docs/          — Canonical project documentation
index.html     — Landing page + login
welcome.html   — Friend home
catalog.html   — Product catalog
dashboard.html — Shared admin/friend dashboard
server.js      — Express entry point
styles.css     — Global styles (Hebrew RTL)
```

---

## Key rules for contributors / agents

- Hebrew RTL UI — preserve it.
- No paid services without owner approval.
- No online payment in MVP — manual paid/unpaid tracking only.
- Internal messaging is removed; WhatsApp links replace it.
- Secrets stay in env variables only.
- See `AGENTS.md` and `docs/BUILDER_PLAN.md` before editing any file.

---

## Legacy notes

`.vercel/`, `vercel.json`, and `.github/workflows/deploy-pages.yml` are
historical artifacts from when the app ran on Vercel/GitHub Pages. The current
runtime is Express on Render.
