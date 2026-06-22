const { getSql } = require('../_db');
const { parseBody, requireAdmin } = require('../_middleware');

const VALID_STATUSES = ['approved', 'rejected', 'pending'];
const VALID_ROLES    = ['admin', 'friend'];

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const { id } = req.query;

  // ── PUT /api/users/:id — update any user field ────────────────
  if (req.method === 'PUT') {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    try {
      const body   = await parseBody(req);
      const sql    = getSql();

      // Build only the fields that were sent
      const updates = {};
      if (body.name     !== undefined) updates.name             = String(body.name).trim();
      if (body.fullName !== undefined) updates.full_name        = String(body.fullName).trim();
      if (body.email    !== undefined) updates.email            = String(body.email).trim().toLowerCase();
      if (body.password !== undefined) updates.password         = String(body.password);
      if (body.role     !== undefined && VALID_ROLES.includes(body.role))    updates.role   = body.role;
      if (body.status   !== undefined && VALID_STATUSES.includes(body.status)) updates.status = body.status;
      if (body.status === 'rejected')  updates.rejection_reason = String(body.rejectionReason ?? '').trim() || null;
      if (body.status !== 'rejected' && body.status !== undefined) updates.rejection_reason = null;

      // At minimum, status must be valid if that's all that was sent
      if (body.status !== undefined && !VALID_STATUSES.includes(body.status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }

      // Build dynamic SET clause — columns are whitelisted above so safe to interpolate
      const cols = Object.keys(updates);
      const vals = Object.values(updates);
      const setClause = cols.map((col, i) => `${col} = $${i + 1}`).join(', ');
      await sql.query(
        `UPDATE users SET ${setClause} WHERE id = $${vals.length + 1}`,
        [...vals, id]
      );

      const result = await sql.query(
        `SELECT id, name, full_name, email, role, status, rejection_reason, password, created_at FROM users WHERE id = $1`,
        [id]
      );
      const rows = result.rows ?? result;
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

  // ── DELETE /api/users/:id ─────────────────────────────────────
  if (req.method === 'DELETE') {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (admin.id === id) return res.status(400).json({ error: 'לא ניתן למחוק את המשתמש שלך.' });
    try {
      const sql = getSql();
      await sql`DELETE FROM sessions WHERE user_id = ${id}`;
      const result = await sql`DELETE FROM users WHERE id = ${id} RETURNING id`;
      if (result.length === 0) return res.status(404).json({ error: 'Not found' });
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).end();
};
