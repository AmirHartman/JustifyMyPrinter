const { getSql } = require('./_db');

// ── Request body parsing ──────────────────────────────────────

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

// ── Session helpers ───────────────────────────────────────────

function parseCookies(cookieHeader = '') {
  const cookies = {};
  cookieHeader.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx < 0) return;
    cookies[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return cookies;
}

async function getSession(req) {
  const token = parseCookies(req.headers.cookie).session;
  if (!token) return null;
  try {
    const sql = getSql();
    const rows = await sql`
      SELECT user_id AS id, user_name AS name, user_role AS role
      FROM sessions
      WHERE token = ${token} AND expires_at > NOW()
    `;
    return rows[0] || null;
  } catch {
    return null;
  }
}

// ── Auth guards ───────────────────────────────────────────────

async function requireAuth(req, res) {
  const user = await getSession(req);
  if (!user) { res.status(401).json({ error: 'Unauthorized' }); return null; }
  return user;
}

async function requireAdmin(req, res) {
  const user = await getSession(req);
  if (!user || user.role !== 'admin') { res.status(403).json({ error: 'Forbidden' }); return null; }
  return user;
}

module.exports = { parseBody, parseCookies, getSession, requireAuth, requireAdmin };
