# Render Deployment Notes

## Current deployment target

**Render** (free / Starter tier) is the current deployment target.
Vercel was used historically and some legacy files remain (`.vercel/`, `vercel.json`,
`.github/workflows/deploy-pages.yml`). Those files are legacy artifacts.

## How the app runs

The app is an Express server:

```
npm start        →  node server.js
npm run dev      →  node --watch --env-file=.env.local server.js
```

`server.js` serves both the API routes (`/api/*`) and static frontend files
(HTML, CSS, JS modules) from the repo root.

## Render Web Service setup

| Setting            | Value                             |
|--------------------|-----------------------------------|
| Environment        | Node                              |
| Build command      | `npm install`                     |
| Start command      | `npm start`                       |
| Root directory     | `JustifyMyPrinter` (repo subfolder if needed) |
| Port               | Auto-detected from `process.env.PORT` (server.js uses `PORT \|\| 3000`) |
| Health check path  | `/healthz`                        |
| Region             | Any (closest to Israel preferred) |

## Environment variables on Render

Set these in the Render dashboard under **Environment**:

| Variable              | Description                              |
|-----------------------|------------------------------------------|
| `DATABASE_URL`        | Neon connection string (postgres://…)    |
| `DB_JMP_DATABASE_URL` | Alternative — `api/_db.js` checks this first |
| `NODE_ENV`            | `production`                             |
| `PORT`                | Set automatically by Render — do not hardcode |

**Never commit secrets to the repo. Never log DATABASE_URL values.**

## Free-tier constraints

- Render free Web Services **spin down after inactivity** (≈15 min).
  The first request after spin-down has a cold-start delay.
- CPU and RAM are limited on the free tier — avoid heavy in-process work.
- Do not add paid services or paid add-ons without explicit approval.
- Neon free tier has connection and compute limits — use the serverless driver
  (`@neondatabase/serverless`) which is already in place.

## Database

- **Neon** PostgreSQL (serverless). Already connected.
- `api/_db.js` — lazy connection via `DB_JMP_DATABASE_URL` or `DATABASE_URL`.
- `api/init.js` — idempotent POST to create tables and seed data. Run once on a fresh DB:
  ```
  curl -X POST https://<your-render-url>/api/init
  ```
- Do not run destructive migrations. All schema changes use `ADD COLUMN IF NOT EXISTS`.

## Legacy files (do not delete without review)

| File/Directory               | Status  | Notes                                      |
|------------------------------|---------|--------------------------------------------|
| `.vercel/`                   | Legacy  | Vercel project metadata — not needed       |
| `vercel.json`                | Legacy  | `{"framework": null}` — safe to ignore     |
| `.github/workflows/deploy-pages.yml` | Legacy/Optional | Publishes a static preview only; it does not deploy the Express API or replace Render |

Builder 2 (Runtime) should verify whether `deploy-pages.yml` is still intentionally
used or can be disabled. Do not delete it without confirming with the owner.

## Local development

```bash
# Install dependencies
npm install

# Copy env template
cp env.local.example .env.local
# Edit .env.local and set DATABASE_URL

# Run with file-watch reloading
npm run dev

# App is at http://localhost:3000
```

No Vercel CLI needed.

## Render health check

Configure Render's health check path as `/healthz`. It returns a small JSON
response without querying Neon or exposing configuration. The root path also
remains available and returns `index.html`.

## Notes for future builders

- `package.json` already has `express` in dependencies and the correct start script.
  Builder 2 should verify this is sufficient for Render and that no additional
  build step is needed.
- Do not add a `Procfile` — Render uses the `start` script from `package.json`.
- If a `render.yaml` is added for infra-as-code, document it here.
