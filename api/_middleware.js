const { getSql } = require('./_db');

const USER_STATUSES = ['pending', 'active', 'inactive', 'rejected'];
const ORDER_STATUSES = [
  'new', 'waiting_approval', 'waiting_print', 'printing',
  'ready_delivery', 'completed', 'cancelled',
];

const LEGACY_USER_STATUS = { approved: 'active' };
const LEGACY_ORDER_STATUS = {
  approved: 'waiting_print',
  ready: 'ready_delivery',
  delivered: 'completed',
  rejected: 'cancelled',
};

function normalizeUserStatus(status) {
  return LEGACY_USER_STATUS[status] || status;
}

function normalizeOrderStatus(status) {
  return LEGACY_ORDER_STATUS[status] || status;
}

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

async function requireActiveUser(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return null;
  if (user.role === 'admin') return user;
  try {
    const sql = getSql();
    const rows = await sql`SELECT status FROM users WHERE id = ${user.id}`;
    const status = rows[0] ? normalizeUserStatus(rows[0].status) : null;
    if (status !== 'active') {
      res.status(403).json({ error: 'Only active friends can place orders' });
      return null;
    }
    return { ...user, status };
  } catch {
    res.status(500).json({ error: 'Unable to verify user status' });
    return null;
  }
}

module.exports = {
  USER_STATUSES,
  ORDER_STATUSES,
  normalizeUserStatus,
  normalizeOrderStatus,
  parseBody,
  parseCookies,
  getSession,
  requireAuth,
  requireActiveUser,
  requireAdmin,
};
