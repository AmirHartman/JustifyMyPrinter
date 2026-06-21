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
      const body            = await parseBody(req);
      const status          = String(body.status ?? '');
      const rejectionReason = status === 'rejected' ? String(body.rejectionReason ?? '').trim() : null;

      if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });

      const sql = getSql();
      await sql`UPDATE users SET status = ${status}, rejection_reason = ${rejectionReason} WHERE id = ${id}`;

      const rows = await sql`
        SELECT id, name, full_name, email, role, status, rejection_reason, password, created_at
        FROM users WHERE id = ${id}
      `;
      if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
      const r = rows[0];
      return res.json({
        id:              r.id,
        name:            r.name,
        fullName:        r.full_name,
        email:           r.email,
        role:            r.role,
        status:          r.status,
        rejectionReason: r.rejection_reason,
        password:        r.password,
        createdAt:       r.created_at,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).end();
};
