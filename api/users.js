const { getSql } = require('./_db');
const { requireAdmin } = require('./_middleware');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET') {
    const user = await requireAdmin(req, res);
    if (!user) return;
    try {
      const sql = getSql();
      const rows = await sql`
        SELECT id, name, full_name, email, role, status, rejection_reason, password, created_at
        FROM users ORDER BY created_at DESC
      `;
      return res.json(rows.map((r) => ({
        id:              r.id,
        name:            r.name,
        fullName:        r.full_name,
        email:           r.email,
        role:            r.role,
        status:          r.status,
        rejectionReason: r.rejection_reason,
        password:        r.password,
        createdAt:       r.created_at,
      })));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).end();
};
