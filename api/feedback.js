const { randomUUID } = require('crypto');
const { getSql } = require('./_db');
const { parseBody, getSession, requireAdmin } = require('./_middleware');

const KINDS = ['bug', 'improvement'];
const STATUSES = ['new', 'resolved'];

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const sql = getSql();
  const id = String(req.query.id || '');
  try {
    // ── Submit feedback (public: works signed-out) ──────────────
    if (req.method === 'POST') {
      const body = await parseBody(req);
      const kind = KINDS.includes(body.kind) ? body.kind : 'bug';
      const message = String(body.message || '').trim().slice(0, 2000);
      const page = String(body.page || '').trim().slice(0, 120);
      if (!message) return res.status(400).json({ error: 'Message is required' });

      // Identity comes from the session when logged in; the client-supplied
      // name/phone are ignored in that case and used only for signed-out visitors.
      const session = await getSession(req);
      let userId = null;
      let name = '';
      let phone = '';
      if (session) {
        userId = session.id;
        const rows = await sql`SELECT name, full_name, phone FROM users WHERE id = ${session.id}`;
        const u = rows[0] || {};
        name = String(u.full_name || u.name || session.name || '').trim();
        phone = String(u.phone || '').trim();
      } else {
        name = String(body.name || '').trim().slice(0, 120);
        phone = String(body.phone || '').trim().slice(0, 40);
        if (!name || !phone) return res.status(400).json({ error: 'Name and phone are required' });
      }

      const inserted = await sql`
        INSERT INTO feedback (id, user_id, name, phone, kind, message, page)
        VALUES (${randomUUID()}, ${userId}, ${name}, ${phone}, ${kind}, ${message}, ${page})
        RETURNING *`;
      return res.status(201).json(inserted[0]);
    }

    // ── Admin-only management ───────────────────────────────────
    if (!await requireAdmin(req, res)) return;

    if (req.method === 'GET') {
      return res.json(await sql`SELECT * FROM feedback ORDER BY created_at DESC`);
    }

    if (req.method === 'PUT' && id) {
      const body = await parseBody(req);
      if (!STATUSES.includes(body.status)) return res.status(400).json({ error: 'Invalid status' });
      const rows = await sql`UPDATE feedback SET status = ${body.status} WHERE id = ${id} RETURNING *`;
      return rows.length ? res.json(rows[0]) : res.status(404).json({ error: 'Not found' });
    }

    if (req.method === 'DELETE' && id) {
      await sql`DELETE FROM feedback WHERE id = ${id}`;
      return res.json({ ok: true });
    }

    return res.status(405).end();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
