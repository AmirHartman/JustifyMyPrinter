'use strict';

const express = require('express');
const path    = require('path');
const { getSession } = require('./api/_middleware');

const app = express();

// Parse JSON bodies. The _middleware.js parseBody() fast-path checks
// req.body first, so express.json() here makes all handlers work without
// any changes to the existing API files.
app.use(express.json());

// ── API routes ────────────────────────────────────────────────────────────────
// Each handler exports a single (req, res) function, the same signature
// Express uses. app.all forwards every HTTP method so the handlers can
// branch on req.method internally.
// Query strings (?id=, ?mine=true, ?key=pricing) are part of req.query,
// not the path, so one entry per resource covers all operations.
app.all('/api/auth',          require('./api/auth'));
app.all('/api/orders',        require('./api/orders'));
app.all('/api/products',      require('./api/products'));
app.all('/api/categories',    require('./api/categories'));
app.all('/api/users',         require('./api/users'));
app.all('/api/filaments',     require('./api/filaments'));
app.all('/api/messages',      require('./api/messages'));
app.all('/api/notifications', require('./api/notifications'));
app.all('/api/settings',      require('./api/settings'));
app.all('/api/expenses',      require('./api/expenses'));
app.all('/api/insights',      require('./api/insights'));
app.all('/api/ledger',        require('./api/ledger'));
app.all('/api/goals',         require('./api/goals'));
app.all('/api/transparency',  require('./api/transparency'));
app.all('/api/feedback',      require('./api/feedback'));
app.all('/api/maintenance',   require('./api/maintenance'));
app.all('/api/print-sync',    require('./api/print-sync'));
app.all('/api/print-files',   require('./api/print-files'));
app.all('/api/uploads',       require('./api/uploads'));
app.all('/api/init',          require('./api/init'));

// Unknown /api/* paths → structured 404, never falls through to the HTML catch-all.
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Lightweight runtime check for Render. Does not touch Neon or expose config.
app.get('/healthz', (req, res) => res.json({ status: 'ok' }));

// ── Static frontend ───────────────────────────────────────────────────────────
// Serve only the files the browser needs. Explicit routes prevent directory
// listing and ensure api/, node_modules/, .env*, .git, *.md, and package
// metadata are never reachable.

const ROOT = __dirname;

// Reject dotfiles explicitly instead of letting them reach the HTML fallback.
app.use((req, res, next) => {
  const hasDotfileSegment = req.path.split('/').some((segment) => segment.startsWith('.'));
  if (hasDotfileSegment) return res.sendStatus(404);
  next();
});

// HTML pages
const HTML_PAGES = ['index.html', 'welcome.html', 'dashboard.html'];
app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'index.html')));
app.get('/catalog.html', async (req, res) => {
  const user = await getSession(req);
  if (!user) return res.redirect(302, '/dashboard.html');
  return res.sendFile(path.join(ROOT, 'catalog.html'));
});
for (const page of HTML_PAGES) {
  app.get(`/${page}`, (req, res) => res.sendFile(path.join(ROOT, page)));
}

// Stylesheet
app.get('/styles.css', (req, res) => res.sendFile(path.join(ROOT, 'styles.css')));

// JS modules directory — served as a unit; dotfiles inside are blocked.
app.use('/js', express.static(path.join(ROOT, 'js'), { dotfiles: 'deny' }));

// Unknown non-API paths → main page. Keeps the app working if the browser
// navigates directly to a known URL (e.g. bookmark to /dashboard.html).
app.use((req, res) => res.sendFile(path.join(ROOT, 'index.html')));

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`JustifyMyPrinter running on port ${PORT}`));

// Without this handler a bind failure (most commonly EADDRINUSE from a previous
// `npm run dev` still holding the port) makes the process hang silently instead
// of exiting — the banner prints, then nothing. Surface it and exit non-zero.
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use — another server is still running.`);
    console.error(`Stop it with:  lsof -ti :${PORT} | xargs kill   (or set PORT to a free port), then retry.`);
  } else {
    console.error('Failed to start server:', err);
  }
  process.exit(1);
});
