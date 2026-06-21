const { getSql } = require('../_db');
const { parseBody, requireAdmin } = require('../_middleware');

const VALID_STATUSES = ['approved', 'rejected', 'pending'];

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const { id } = req.query;

  if (req.method === 'PUT') {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    try {
      const body = await parseBody(req);
      const status = String(body.status ?? '');
      if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });

      const sql = getSql();
      await sql`UPDATE users SET status = ${status} WHERE id = ${id}`;

      const rows = await sql`SELECT id, name, role, status, created_at FROM users WHERE id = ${id}`;
      if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
      const r = rows[0];
      return res.json({ id: r.id, name: r.name, role: r.role, status: r.status, createdAt: r.created_at });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).end();
};
